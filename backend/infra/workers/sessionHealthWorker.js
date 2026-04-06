/**
 * Session Health Worker — Tự động duy trì session Facebook
 *
 * Chạy mỗi 6 giờ:
 * 1. Kiểm tra tất cả account qua Shadow API (không cần browser)
 * 2. Nếu session invalid → tự re-login Playwright + TOTP
 * 3. Cập nhật cookies vào file + DB account status
 * 4. Gửi Telegram báo cáo
 *
 * Mục tiêu: Không bao giờ phải manually refresh cookies
 */

'use strict';

process.on('unhandledRejection', (reason) => {
    const msg = String(reason?.message || reason || '');
    if (msg.includes('Target page') || msg.includes('cdpSession')) return;
    console.error('[SessionHealth] ❌ Unhandled rejection:', msg);
});

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { notifyAlert } = require('../../core/integrations/telegramBot');

chromium.use(StealthPlugin());

// ─── Paths ────────────────────────────────────────────────────────────────────
const SESSIONS_DIR = path.join(__dirname, '..', '..', '..', 'data', 'fb_sessions');
const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const SCRAPER_ACCOUNTS_PATH = path.join(__dirname, '..', '..', 'config', 'scraper_accounts.json');

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

// ─── TOTP Generator (không dùng thư viện ngoài) ───────────────────────────────
function generateTOTP(secret) {
    const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (const c of secret.replace(/\s+/g, '').toUpperCase()) {
        if (c === '=') continue;
        bits += B32.indexOf(c).toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.substr(i, 8), 2));
    const key = Buffer.from(bytes);
    const counter = Buffer.alloc(8);
    const t = Math.floor(Date.now() / 1000 / 30);
    counter.writeUInt32BE(Math.floor(t / 0x100000000), 0);
    counter.writeUInt32BE(t % 0x100000000, 4);
    const hmac = crypto.createHmac('sha1', key).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

// ─── Load accounts ────────────────────────────────────────────────────────────
function loadScraperAccounts() {
    try {
        return JSON.parse(fs.readFileSync(SCRAPER_ACCOUNTS_PATH, 'utf8'));
    } catch {
        return [];
    }
}

function saveScraperAccounts(accounts) {
    fs.writeFileSync(SCRAPER_ACCOUNTS_PATH, JSON.stringify(accounts, null, 2));
}

// ─── Session check via Shadow API (no browser needed) ────────────────────────
async function checkSessionViaShadow(cookieStr, proxyUrl = '') {
    if (!cookieStr || !cookieStr.includes('c_user')) return { valid: false, reason: 'no_cookies' };

    const config = {
        headers: {
            'Cookie': cookieStr,
            'User-Agent': 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP31.240517.005) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.39 Mobile Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
        },
        timeout: 15000,
        maxRedirects: 3,
    };

    if (proxyUrl) {
        try { config.httpsAgent = new HttpsProxyAgent(proxyUrl); } catch { }
    }

    try {
        const res = await axios.get('https://www.facebook.com/', {
            ...config,
            validateStatus: () => true, // không throw trên bất kỳ status nào
        });
        const html = String(res.data || '');
        const status = res.status;

        // Redirect về login → definitely invalid
        if (status === 302 || status === 301) {
            return { valid: false, reason: 'redirect_to_login' };
        }

        // Check nội dung HTML
        if (html.includes('checkpoint') || html.includes('/login/?next')) {
            return { valid: false, reason: 'checkpoint_or_login' };
        }

        // DTSGInitialData chỉ có khi đã login
        const isLoggedIn = html.includes('DTSGInitialData') || html.includes('"USER_ID"');

        // 400 nhưng có DTSGInitialData → session vẫn valid
        if (status === 400 && isLoggedIn) {
            return { valid: true, reason: 'ok_400' };
        }

        // 400 không có login indicator → session hết hạn
        if (status === 400) {
            return { valid: false, reason: 'session_expired_400' };
        }

        return { valid: isLoggedIn, reason: isLoggedIn ? 'ok' : 'not_logged_in' };
    } catch (e) {
        return { valid: false, reason: `network_error: ${e.message.substring(0, 50)}` };
    }
}

// ─── Re-login via Playwright ──────────────────────────────────────────────────
async function reLoginAccount(account) {
    const tag = `[SessionHealth:${account.email}]`;
    console.log(`\n${tag} 🔐 Starting re-login...`);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-blink-features=AutomationControlled'],
    });

    const contextOpts = {
        userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
        viewport: { width: 412, height: 915 },
        locale: 'vi_VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
        isMobile: true,
        hasTouch: true,
    };

    if (account.proxyUrl) {
        try {
            const purl = new URL(account.proxyUrl);
            contextOpts.proxy = {
                server: `${purl.protocol}//${purl.hostname}:${purl.port}`,
                username: purl.username || undefined,
                password: purl.password || undefined,
            };
        } catch { }
    }

    const context = await browser.newContext(contextOpts);
    const page = await context.newPage();
    const sleep = (ms) => new Promise(r => setTimeout(r, ms + Math.random() * 500));

    try {
        // Navigate to mobile Facebook
        await page.goto('https://m.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 40000 });
        await sleep(3000);

        let url = page.url();

        // Fill login form if present
        const emailInput = await page.$('input[name="email"], #m_login_email');
        const passInput = await page.$('input[name="pass"], #m_login_password');

        if (emailInput && passInput) {
            await emailInput.fill(account.email);
            await sleep(800);
            await passInput.fill(account.password);
            await sleep(800);

            const loginBtn = await page.$('button[name="login"], input[name="login"], button[type="submit"]');
            if (loginBtn) await loginBtn.click();
            else await passInput.press('Enter');

            try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }); } catch { }
            await sleep(5000);
        }

        // Handle 2FA / checkpoint
        url = page.url();
        const bodyText = await page.textContent('body').catch(() => '');

        if (url.includes('checkpoint') || url.includes('two_factor') || url.includes('two_step')
            || /approvals_code|enter.*code|nhập mã/i.test(bodyText)) {

            console.log(`${tag} ⚠️ 2FA detected — generating TOTP...`);
            const totp = account['2fa_secret'] ? generateTOTP(account['2fa_secret']) : null;

            if (!totp) {
                console.warn(`${tag} ❌ No 2FA secret, cannot bypass`);
                await browser.close();
                return { success: false, reason: 'no_2fa_secret' };
            }

            console.log(`${tag} 🔑 TOTP: ${totp}`);

            // "Try another way" then "Auth app"
            for (const text of ['try another way', 'thử cách khác']) {
                if (bodyText.toLowerCase().includes(text)) {
                    await page.evaluate((t) => {
                        for (const el of document.querySelectorAll('a,button,span,div[role="button"]')) {
                            if ((el.innerText || '').toLowerCase().includes(t)) { el.click(); break; }
                        }
                    }, text);
                    await sleep(2000);
                    break;
                }
            }

            const bodyText2 = await page.textContent('body').catch(() => '');
            for (const text of ['authentication app', 'ứng dụng xác thực']) {
                if (bodyText2.toLowerCase().includes(text)) {
                    await page.evaluate((t) => {
                        for (const el of document.querySelectorAll('a,button,span,div,label')) {
                            if ((el.innerText || '').toLowerCase().includes(t)) { el.click(); break; }
                        }
                    }, text);
                    await sleep(2000);
                    // Click continue
                    await page.evaluate(() => {
                        for (const el of document.querySelectorAll('button,input[type="submit"],div[role="button"]')) {
                            if (/continue|tiếp tục|next/i.test(el.innerText || el.value || '')) { el.click(); break; }
                        }
                    });
                    await sleep(3000);
                    break;
                }
            }

            // Fill TOTP
            const codeSelectors = [
                'input[name="approvals_code"]', 'input[autocomplete="one-time-code"]',
                'input[maxlength="6"]', 'input[maxlength="8"]', 'input[type="tel"]',
            ];
            let filled = false;
            for (const sel of codeSelectors) {
                const inp = await page.$(sel);
                if (inp && await inp.isVisible().catch(() => false)) {
                    await inp.fill(totp);
                    filled = true;
                    break;
                }
            }
            if (!filled) await page.keyboard.type(totp, { delay: 80 });

            await page.keyboard.press('Enter');
            await sleep(8000);

            // "Save browser" / "This was me"
            const bodyText3 = await page.textContent('body').catch(() => '');
            for (const t of ['save browser', 'nhớ trình duyệt', 'this was me', 'đây là tôi', 'continue', 'tiếp tục']) {
                if (bodyText3.toLowerCase().includes(t)) {
                    await page.evaluate((txt) => {
                        for (const el of document.querySelectorAll('button,input[type="submit"],a,div[role="button"]')) {
                            if ((el.innerText || el.value || '').toLowerCase().includes(txt)) { el.click(); break; }
                        }
                    }, t);
                    await sleep(4000);
                    break;
                }
            }
        }

        // Verify success
        await sleep(2000);
        const finalUrl = page.url();
        const isLoggedIn = !finalUrl.includes('/login') && !finalUrl.includes('checkpoint')
            && (finalUrl.includes('facebook.com') || await page.$('a[href*="/home"]'));

        if (!isLoggedIn) {
            await page.screenshot({ path: path.join(DATA_DIR, `session_health_fail_${account.email}.png`) }).catch(() => { });
            await browser.close();
            return { success: false, reason: `still_at_login: ${finalUrl.substring(0, 60)}` };
        }

        // Save session
        const sessionFile = path.join(SESSIONS_DIR, `${account.email.replace(/[^a-z0-9]/gi, '_')}.json`);
        await context.storageState({ path: sessionFile });
        console.log(`${tag} 💾 Session saved → ${path.basename(sessionFile)}`);

        // Extract new cookies
        const cookies = await context.cookies();
        const cookieStr = cookies
            .filter(c => c.domain?.includes('facebook'))
            .map(c => `${c.name}=${c.value}`)
            .join('; ');

        await browser.close();
        return { success: true, cookieStr, sessionFile };

    } catch (e) {
        console.error(`${tag} ❌ Re-login error: ${e.message}`);
        try { await browser.close(); } catch { }
        return { success: false, reason: e.message };
    }
}

// ─── Update DB account status ─────────────────────────────────────────────────
function updateAccountDB(email, status, trustBonus = 0) {
    try {
        const Database = require('better-sqlite3');
        const db = new Database(path.join(DATA_DIR, 'leads.db'));
        db.prepare(`
            UPDATE fb_accounts
            SET status = ?, trust_score = MIN(trust_score + ?, 100), last_used = datetime('now')
            WHERE email = ?
        `).run(status, trustBonus, email);
        db.close();
    } catch (e) {
        console.warn(`[SessionHealth] ⚠️ DB update failed for ${email}: ${e.message}`);
    }
}

// ─── Main Health Check Cycle ──────────────────────────────────────────────────
let _isRunning = false;

async function runHealthCheck() {
    if (_isRunning) return;
    _isRunning = true;

    console.log('\n╔══════════════════════════════════════════════════════╗');
    console.log('║  🏥 Session Health Check                             ║');
    console.log(`║  ${new Date().toLocaleString('vi-VN').padEnd(52)}║`);
    console.log('╚══════════════════════════════════════════════════════╝\n');

    const accounts = loadScraperAccounts();
    if (accounts.length === 0) {
        console.log('[SessionHealth] ⚠️ No accounts in scraper_accounts.json');
        _isRunning = false;
        return;
    }

    const results = { ok: [], renewed: [], failed: [] };
    const updatedAccounts = [...accounts];

    for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i];
        const tag = `[${account.email}]`;

        // 1. Quick check via HTTP (Shadow API style)
        console.log(`${tag} 🔍 Checking session...`);
        const check = await checkSessionViaShadow(account.cookieStr || '', account.proxyUrl || '');

        if (check.valid) {
            console.log(`${tag} ✅ Session VALID`);
            updateAccountDB(account.email, 'active', 5);
            results.ok.push(account.email);
            continue;
        }

        console.log(`${tag} ❌ Session INVALID (${check.reason}) — attempting re-login...`);

        // 2. Attempt re-login
        const loginResult = await reLoginAccount(account);

        if (loginResult.success) {
            console.log(`${tag} 🎉 Re-login SUCCESS`);

            // Update cookieStr in scraper_accounts.json
            if (loginResult.cookieStr) {
                updatedAccounts[i] = { ...account, cookieStr: loginResult.cookieStr };
            }

            updateAccountDB(account.email, 'active', 30);
            results.renewed.push(account.email);
        } else {
            console.log(`${tag} 💀 Re-login FAILED: ${loginResult.reason}`);
            updateAccountDB(account.email, 'checkpoint', 0);
            results.failed.push({ email: account.email, reason: loginResult.reason });
        }

        // Cooldown giữa các lần login (tránh trigger security)
        if (i < accounts.length - 1) {
            const wait = 30000 + Math.random() * 30000;
            console.log(`[SessionHealth] ⏳ Cooling ${Math.round(wait / 1000)}s before next account...`);
            await new Promise(r => setTimeout(r, wait));
        }
    }

    // Save updated cookies
    if (results.renewed.length > 0) {
        saveScraperAccounts(updatedAccounts);
        console.log(`[SessionHealth] 💾 Updated scraper_accounts.json (${results.renewed.length} renewed)`);
    }

    // Build Telegram report
    const total = accounts.length;
    const icon = results.failed.length > 0 ? '⚠️' : '✅';
    let report = `${icon} <b>Session Health Report</b>\n`;
    report += `🕐 ${new Date().toLocaleString('vi-VN')}\n\n`;
    report += `✅ OK (${results.ok.length}): ${results.ok.map(e => e.substring(0, 12)).join(', ') || 'none'}\n`;
    report += `🔄 Renewed (${results.renewed.length}): ${results.renewed.map(e => e.substring(0, 12)).join(', ') || 'none'}\n`;

    if (results.failed.length > 0) {
        report += `❌ Failed (${results.failed.length}):\n`;
        for (const f of results.failed) {
            report += `  • ${f.email.substring(0, 12)}: ${f.reason?.substring(0, 60)}\n`;
        }
        report += `\n⚠️ <b>Cần xử lý thủ công ${results.failed.length} account!</b>`;
    } else {
        report += `\n🟢 Tất cả ${total} accounts hoạt động bình thường.`;
    }

    try {
        await notifyAlert(report.trim());
    } catch (e) {
        console.warn('[SessionHealth] ⚠️ Telegram alert failed:', e.message);
    }

    console.log(`\n[SessionHealth] 📊 Done: ${results.ok.length} ok | ${results.renewed.length} renewed | ${results.failed.length} failed`);
    _isRunning = false;
}

// ─── Daemon ───────────────────────────────────────────────────────────────────
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 giờ

console.log('╔══════════════════════════════════════════════════════╗');
console.log('║  🏥 Session Health Worker                            ║');
console.log('║  Auto-renew Facebook cookies every 6h               ║');
console.log('╚══════════════════════════════════════════════════════╝');

// Chạy ngay lần đầu sau 2 phút (để các worker khác khởi động trước)
setTimeout(() => {
    runHealthCheck().catch(e => console.error('[SessionHealth] ❌ Cycle error:', e.message));
}, 2 * 60 * 1000);

// Sau đó mỗi 6 giờ
setInterval(() => {
    runHealthCheck().catch(e => console.error('[SessionHealth] ❌ Cycle error:', e.message));
}, CHECK_INTERVAL_MS);
