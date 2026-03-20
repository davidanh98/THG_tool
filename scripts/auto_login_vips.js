#!/usr/bin/env node
/**
 * Auto-Login VIP Accounts v3 — Mobile-first strategy
 * Uses m.facebook.com (much lighter security) + reCAPTCHA auto-click
 * 
 * Usage:  node scripts/auto_login_vips.js [--no-proxy] [--account 2]
 */
require('dotenv').config();
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Native TOTP Generator ───────────────────────────────────────
function generateTOTP(secret) {
    const B = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let b = '';
    for (let c of secret.replace(/\s+/g, '').toUpperCase()) {
        if (c === '=') continue;
        b += B.indexOf(c).toString(2).padStart(5, '0');
    }
    let hex = [];
    for (let i = 0; i + 8 <= b.length; i += 8) hex.push(parseInt(b.substr(i, 8), 2));
    const k = Buffer.from(hex);
    const tb = Buffer.alloc(8);
    const c = Math.floor(Date.now() / 1000 / 30);
    tb.writeUInt32BE(Math.floor(c / 0x100000000), 0);
    tb.writeUInt32BE(c % 0x100000000, 4);
    const hm = crypto.createHmac('sha1', k).update(tb).digest();
    const o = hm[hm.length - 1] & 0x0f;
    return ((hm.readUInt32BE(o) & 0x7fffffff) % 1000000).toString().padStart(6, '0');
}

chromium.use(StealthPlugin());

const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'fb_sessions');
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

const args = process.argv.slice(2);
const NO_PROXY = args.includes('--no-proxy');
const SINGLE = args.includes('--account') ? parseInt(args[args.indexOf('--account') + 1]) : 0;

function getProxy(email) {
    if (NO_PROXY) return '';
    const accName = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
    return process.env[`PROXY_${accName}`] || process.env[`PROXY_${email.split('@')[0]}`] || '';
}

const sleep = ms => new Promise(r => setTimeout(r, ms + Math.random() * 500));

async function tryClickRecaptcha(page, tag) {
    // Try clicking the reCAPTCHA checkbox
    try {
        const frame = page.frameLocator('iframe[title*="reCAPTCHA"], iframe[src*="recaptcha"]').first();
        const checkbox = frame.locator('#recaptcha-anchor, .recaptcha-checkbox');
        if (await checkbox.isVisible({ timeout: 3000 })) {
            await checkbox.click();
            console.log(`${tag} 🖱️ Clicked reCAPTCHA checkbox!`);
            await sleep(10000);
            return true;
        }
    } catch { }
    // Direct approach — sometimes the checkbox is outside an iframe
    try {
        const cb = page.locator('.recaptcha-checkbox, #recaptcha-anchor');
        if (await cb.isVisible({ timeout: 2000 })) {
            await cb.click();
            console.log(`${tag} 🖱️ Clicked reCAPTCHA (direct)!`);
            await sleep(10000);
            return true;
        }
    } catch { }
    return false;
}

async function loginAccount(index, email, password, totpSecret) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 [VIP ${index}] ${email}`);

    const proxyUrl = getProxy(email);
    console.log(`🌐 Proxy: ${proxyUrl ? 'YES' : 'DIRECT (VPS IP)'}`);

    const accName = email.split('@')[0];
    const uaPath = path.join(DATA_DIR, `ua_${accName}.txt`);
    // Mobile user-agent — critical for m.facebook.com
    let ua = 'Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';
    if (fs.existsSync(uaPath)) ua = fs.readFileSync(uaPath, 'utf8').trim();

    const contextOpts = {
        userAgent: ua,
        viewport: { width: 412, height: 915 },
        locale: 'vi_VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
        isMobile: true,
        hasTouch: true,
    };

    if (proxyUrl) {
        try {
            const purl = new URL(proxyUrl);
            contextOpts.proxy = {
                server: `${purl.protocol}//${purl.hostname}:${purl.port}`,
                username: purl.username || undefined,
                password: purl.password || undefined,
            };
        } catch { }
    }

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'],
    });
    const context = await browser.newContext(contextOpts);
    const page = await context.newPage();
    const tag = `[VIP ${index}]`;

    try {
        // ─── Phase 1: Navigate (mobile site) ─────────────────────
        console.log(`${tag} 📡 Opening m.facebook.com...`);
        await page.goto('https://m.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await sleep(3000);

        let bodyText = await page.textContent('body').catch(() => '');
        let url = page.url();

        // Check for security challenge
        const hasChallenge = /recaptcha|i.m not a robot|running security|matchkey|checkpoint/i.test(bodyText)
            || /checkpoint/i.test(url);
        if (hasChallenge && !/login_form|email|pass/i.test(bodyText)) {
            console.log(`${tag} 🛡️ Security challenge detected! Attempting auto-solve...`);

            // Try clicking reCAPTCHA
            const clicked = await tryClickRecaptcha(page, tag);
            if (!clicked) {
                // Wait and re-check (Arkose auto-resolves)
                console.log(`${tag} ⏳ Waiting 45s for Arkose auto-resolve...`);
                await sleep(45000);
            }

            bodyText = await page.textContent('body').catch(() => '');
            url = page.url();

            // Still stuck?
            if (/recaptcha|running security|matchkey/i.test(bodyText) && !/login_form|email|pass/i.test(bodyText)) {
                // Try direct URL without proxy
                if (proxyUrl) {
                    console.log(`${tag} 🔄 Retrying WITHOUT proxy...`);
                    await browser.close();
                    // Recursive call without proxy
                    return await loginAccountDirect(index, email, password, totpSecret);
                }
                console.log(`${tag} ❌ Security check persistent. Saving screenshot.`);
                await page.screenshot({ path: path.join(DATA_DIR, `error_vip_${index}.png`) });
                await browser.close();
                return false;
            }
        }

        // ─── Phase 2: Fill Login Form ────────────────────────────
        // m.facebook.com uses simple form
        const emailInput = await page.$('input[name="email"]') || await page.$('#m_login_email');
        const passInput = await page.$('input[name="pass"]') || await page.$('#m_login_password');

        if (!emailInput || !passInput) {
            // Maybe already logged in
            if (await page.$('a[href*="/home"]') || url.includes('home.php')) {
                console.log(`${tag} ✅ Already logged in!`);
            } else {
                console.log(`${tag} ❌ Login form not found! URL: ${url.substring(0, 80)}`);
                await page.screenshot({ path: path.join(DATA_DIR, `error_vip_${index}.png`) });
                await browser.close();
                return false;
            }
        } else {
            console.log(`${tag} 📝 Filling login...`);
            await emailInput.fill(email);
            await sleep(1000);
            await passInput.fill(password);
            await sleep(1000);

            // Submit — m.facebook.com has a login button
            const loginBtn = await page.$('button[name="login"]') || await page.$('input[name="login"]') || await page.$('button[type="submit"]');
            if (loginBtn) {
                await loginBtn.click();
                console.log(`${tag} ⚡ Clicked Login!`);
            } else {
                await passInput.press('Enter');
                console.log(`${tag} ⚡ Pressed Enter!`);
            }

            try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }); } catch { }
            await sleep(5000);
        }

        // ─── Phase 3: Post-login security check ─────────────────
        url = page.url();
        bodyText = await page.textContent('body').catch(() => '');

        if (/recaptcha|running security|matchkey/i.test(bodyText)) {
            console.log(`${tag} 🛡️ Post-login security check...`);
            await tryClickRecaptcha(page, tag);
            await sleep(15000);
            url = page.url();
            bodyText = await page.textContent('body').catch(() => '');
        }

        // ─── Phase 4: Handle 2FA ─────────────────────────────────
        if (url.includes('checkpoint') || url.includes('two_factor') || url.includes('two_step') || /approvals_code|enter.*code|nhập mã/i.test(bodyText)) {
            console.log(`${tag} ⚠️ 2FA detected!`);

            // Try Another Way
            if (/try another way|thử cách khác/i.test(bodyText)) {
                console.log(`${tag} 🔄 Clicking "Try Another Way"...`);
                await page.evaluate(() => {
                    for (const el of document.querySelectorAll('a, button, span, div[role="button"]')) {
                        if (/try another way|thử cách khác/i.test(el.innerText || el.textContent)) { el.click(); break; }
                    }
                });
                await sleep(3000);
                bodyText = await page.textContent('body').catch(() => '');
            }

            // Select "Authentication app"
            if (/authentication app|ứng dụng xác thực|use authentication app/i.test(bodyText)) {
                console.log(`${tag} 📱 Selecting Auth App...`);
                await page.evaluate(() => {
                    for (const el of document.querySelectorAll('a, button, span, div, label')) {
                        if (/authentication app|ứng dụng xác thực/i.test(el.innerText || el.textContent)) { el.click(); break; }
                    }
                });
                await sleep(2000);

                // Click Continue
                await page.evaluate(() => {
                    for (const el of document.querySelectorAll('button, input[type="submit"], div[role="button"]')) {
                        if (/continue|tiếp tục|next|tiếp/i.test(el.innerText || el.value || '')) { el.click(); break; }
                    }
                });
                await sleep(4000);
            }

            // Generate code
            let code = '';
            if (totpSecret) {
                code = generateTOTP(totpSecret);
                console.log(`${tag} 🔑 TOTP: ${code}`);
            } else {
                const recPath = path.join(DATA_DIR, `recovery_codes_${accName}.json`);
                if (fs.existsSync(recPath)) {
                    let codes = JSON.parse(fs.readFileSync(recPath, 'utf8'));
                    if (codes.length > 0) {
                        code = codes.shift();
                        console.log(`${tag} 🔑 Recovery: ${code} (${codes.length} left)`);
                        fs.writeFileSync(recPath, JSON.stringify(codes, null, 2));
                    }
                }
            }

            if (code) {
                // Find & fill code input
                const selectors = ['input[name="approvals_code"]', 'input[autocomplete="one-time-code"]',
                    'input[maxlength="6"]', 'input[maxlength="8"]', 'input[type="tel"]', 'input[type="text"]'];
                let filled = false;
                for (const sel of selectors) {
                    const inp = await page.$(sel);
                    if (inp && await inp.isVisible().catch(() => false)) {
                        await inp.fill(code);
                        console.log(`${tag} ✔️ Code filled (${sel})`);
                        filled = true;
                        break;
                    }
                }
                if (!filled) {
                    console.log(`${tag} ⌨️ Keyboard fallback...`);
                    for (let t = 0; t < 5; t++) await page.keyboard.press('Tab');
                    await page.keyboard.type(code, { delay: 80 });
                }

                // Submit — always use keyboard Enter (submit button is often hidden on mobile FB)
                await page.keyboard.press('Enter');
                console.log(`${tag} ⚡ Submitted code via Enter!`);
                await sleep(8000);

                // Handle "Save Browser" / "This was me"
                bodyText = await page.textContent('body').catch(() => '');
                const saveTexts = ['save browser', 'remember', 'nhớ trình duyệt', 'lưu trình duyệt', 'this was me', 'đây là tôi', 'continue', 'tiếp tục'];
                for (const t of saveTexts) {
                    if (bodyText.toLowerCase().includes(t)) {
                        await page.evaluate((txt) => {
                            for (const el of document.querySelectorAll('button, input[type="submit"], a, div[role="button"]')) {
                                if ((el.innerText || el.value || '').toLowerCase().includes(txt)) { el.click(); break; }
                            }
                        }, t);
                        console.log(`${tag} ✅ Clicked "${t}"`);
                        await sleep(5000);
                        break;
                    }
                }
            } else {
                console.log(`${tag} ❌ No code available!`);
            }
        }

        // ─── Phase 5: Verify & Save Session ──────────────────────
        await sleep(3000);
        const finalUrl = page.url();
        bodyText = await page.textContent('body').catch(() => '');

        const isHome = finalUrl.includes('home') || finalUrl.includes('facebook.com/?') || finalUrl === 'https://m.facebook.com/'
            || await page.$('a[href*="/home"]') || await page.$('a[name="Feed"]');
        const isStuck = finalUrl.includes('checkpoint') || finalUrl.includes('two_step') || finalUrl.includes('two_factor');

        if (isHome && !isStuck) {
            const sessionPath = path.join(SESSIONS_DIR, `${email.replace(/[^a-z0-9]/gi, '_')}.json`);
            await context.storageState({ path: sessionPath });
            fs.writeFileSync(path.join(DATA_DIR, `ua_${accName}.txt`), ua);
            console.log(`${tag} 🎉 SUCCESS! Session → ${path.basename(sessionPath)}`);
            await browser.close();
            return true;
        } else {
            console.log(`${tag} ❌ FAILED. URL: ${finalUrl.substring(0, 100)}`);
            await page.screenshot({ path: path.join(DATA_DIR, `error_vip_${index}.png`) });
            await browser.close();
            return false;
        }

    } catch (e) {
        console.error(`${tag} ❌ Error:`, e.message);
        try { await page.screenshot({ path: path.join(DATA_DIR, `error_vip_${index}.png`) }); } catch { }
        await browser.close();
        return false;
    }
}

// Fallback: login without proxy (VPS direct IP)
async function loginAccountDirect(index, email, password, totpSecret) {
    console.log(`[VIP ${index}] 🔄 Retrying with VPS direct IP (no proxy)...`);
    const origProxy = NO_PROXY;
    // Temporarily force no-proxy
    const saved = process.env[`PROXY_${email.split('@')[0]}`];
    process.env[`PROXY_${email.split('@')[0]}`] = '';
    const accName = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
    process.env[`PROXY_${accName}`] = '';

    const result = await loginAccount(index, email, password, totpSecret);

    // Restore
    if (saved) {
        process.env[`PROXY_${email.split('@')[0]}`] = saved;
        process.env[`PROXY_${accName}`] = saved;
    }
    return result;
}

async function run() {
    let index = 1;
    let success = 0, failed = 0;
    while (process.env[`FB_ACCOUNT_${index}_EMAIL`]) {
        if (SINGLE && SINGLE !== index) { index++; continue; }
        const email = process.env[`FB_ACCOUNT_${index}_EMAIL`];
        const pass = process.env[`FB_ACCOUNT_${index}_PASSWORD`];
        const totp = process.env[`FB_ACCOUNT_${index}_TOTP_SECRET`];

        const ok = await loginAccount(index, email, pass, totp);
        if (ok) success++; else failed++;
        index++;
    }
    console.log(`\n🏁 Done! ✅ ${success} success, ❌ ${failed} failed`);
}

run();
