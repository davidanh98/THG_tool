#!/usr/bin/env node
/**
 * Auto-Login VIP Accounts — Runs ON THE VPS (headless)
 * Handles: reCAPTCHA wait, Arkose security checks, 2FA TOTP/Recovery
 * 
 * Usage on VPS:  node scripts/auto_login_vips.js
 */
require('dotenv').config();
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Native TOTP Generator (zero dependencies) ───────────────────
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

const IS_VPS = !process.env.PLAYWRIGHT_BROWSERS_PATH; // VPS has no custom path

function getProxy(email) {
    const accName = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
    return process.env[`PROXY_${accName}`] || process.env[`PROXY_${email.split('@')[0]}`] || '';
}

async function loginAccount(index, email, password, totpSecret) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚀 [VIP ${index}] Logging in: ${email}`);

    const proxyUrl = getProxy(email);
    console.log(`🌐 Proxy: ${proxyUrl ? 'YES' : 'DIRECT'}`);

    const launchOptions = {
        headless: IS_VPS,  // headless on VPS, headed locally for debug
        args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled'],
    };

    // Load per-account user-agent if available
    const accName = email.split('@')[0];
    const uaPath = path.join(DATA_DIR, `ua_${accName}.txt`);
    let ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    if (fs.existsSync(uaPath)) ua = fs.readFileSync(uaPath, 'utf8').trim();

    const contextOpts = {
        userAgent: ua,
        viewport: { width: 1366, height: 768 },
        locale: 'vi_VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
    };

    if (proxyUrl) {
        try {
            const purl = new URL(proxyUrl);
            contextOpts.proxy = {
                server: `${purl.protocol}//${purl.hostname}:${purl.port}`,
                username: purl.username || undefined,
                password: purl.password || undefined,
            };
        } catch (e) {
            console.warn(`[VIP ${index}] ⚠️ Invalid proxy URL: ${proxyUrl}`);
        }
    }

    const browser = await chromium.launch(launchOptions);
    const context = await browser.newContext(contextOpts);
    const page = await context.newPage();
    const tag = `[VIP ${index}]`;

    try {
        // ─── Phase 1: Navigate & Login ────────────────────────────
        console.log(`${tag} 📡 Opening facebook.com...`);
        await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(3000);

        // Check for reCAPTCHA / security check BEFORE login
        let bodyText = await page.textContent('body').catch(() => '');
        if (/recaptcha|i.m not a robot|running security checks|matchkey/i.test(bodyText)) {
            console.log(`${tag} 🛡️ Security check on landing page! Waiting 30s for auto-resolve...`);
            await page.waitForTimeout(30000);
            bodyText = await page.textContent('body').catch(() => '');
            if (/recaptcha|running security/i.test(bodyText)) {
                console.log(`${tag} ❌ Security check did NOT auto-resolve. Skipping this account.`);
                await page.screenshot({ path: path.join(DATA_DIR, `error_vip_${index}.png`) });
                await browser.close();
                return false;
            }
        }

        // Already logged in?
        if (await page.$('div[role="navigation"]')) {
            console.log(`${tag} ✅ Already logged in!`);
        } else {
            const emailInput = await page.$('input[name="email"]') || await page.$('input[type="text"]');
            const passInput = await page.$('input[name="pass"]') || await page.$('input[type="password"]');

            if (!emailInput || !passInput) {
                console.log(`${tag} ❌ Cannot find login form!`);
                await page.screenshot({ path: path.join(DATA_DIR, `error_vip_${index}.png`) });
                await browser.close();
                return false;
            }

            console.log(`${tag} 📝 Filling login...`);
            await emailInput.fill(email);
            await page.waitForTimeout(800 + Math.random() * 500);
            await passInput.fill(password);
            await page.waitForTimeout(800 + Math.random() * 500);

            console.log(`${tag} ⚡ Submitting...`);
            await passInput.press('Enter');

            // Wait for navigation — could go to home, 2FA, or checkpoint
            try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 20000 }); } catch { }
            await page.waitForTimeout(5000);
        }

        // ─── Phase 2: Handle Security Checks (reCAPTCHA / Arkose) ─
        bodyText = await page.textContent('body').catch(() => '');
        if (/running security checks|matchkey/i.test(bodyText)) {
            console.log(`${tag} 🛡️ Arkose security check detected! Waiting up to 45s...`);
            for (let w = 0; w < 9; w++) {
                await page.waitForTimeout(5000);
                const url = page.url();
                bodyText = await page.textContent('body').catch(() => '');
                if (!url.includes('checkpoint') && !url.includes('two_step') && !url.includes('two_factor') && !(/running security/i.test(bodyText))) {
                    console.log(`${tag} ✅ Security check passed after ${(w + 1) * 5}s!`);
                    break;
                }
            }
        }

        if (/recaptcha|i.m not a robot/i.test(bodyText)) {
            console.log(`${tag} ❌ reCAPTCHA challenge — cannot be automated. Try running ON the VPS.`);
            await page.screenshot({ path: path.join(DATA_DIR, `error_vip_${index}.png`) });
            await browser.close();
            return false;
        }

        // ─── Phase 3: Handle 2FA ──────────────────────────────────
        const currentUrl = page.url();
        if (currentUrl.includes('checkpoint') || currentUrl.includes('two_factor') || currentUrl.includes('two_step')) {
            console.log(`${tag} ⚠️ 2FA/Checkpoint detected!`);
            bodyText = await page.textContent('body').catch(() => '');

            // Step A: Try to navigate past "Approve from another device"
            if (/try another way|thử cách khác/i.test(bodyText)) {
                console.log(`${tag} 🔄 Clicking "Try Another Way"...`);
                try {
                    await page.locator('text=/try another way|thử cách khác/i').first().click({ timeout: 5000 });
                } catch {
                    await page.evaluate(() => {
                        for (const el of document.querySelectorAll('a, span, div[role="button"]')) {
                            if (/try another way|thử cách khác/i.test(el.innerText)) { el.click(); break; }
                        }
                    });
                }
                await page.waitForTimeout(3000);
                bodyText = await page.textContent('body').catch(() => '');
            }

            // Step B: Select "Authentication app" if visible
            if (/authentication app|ứng dụng xác thực/i.test(bodyText)) {
                console.log(`${tag} 📱 Selecting "Authentication app"...`);
                try {
                    await page.locator('text=/authentication app|ứng dụng xác thực/i').first().click({ timeout: 5000 });
                } catch {
                    await page.evaluate(() => {
                        for (const el of document.querySelectorAll('div, span, a')) {
                            if (/authentication app|ứng dụng xác thực/i.test(el.innerText)) { el.click(); break; }
                        }
                    });
                }
                await page.waitForTimeout(2000);

                // Click "Continue" / "Tiếp tục"
                try {
                    await page.locator('button:text-matches("continue|tiếp tục", "i")').first().click({ timeout: 5000 });
                } catch {
                    await page.evaluate(() => {
                        for (const el of document.querySelectorAll('button, div[role="button"]')) {
                            if (/continue|tiếp tục/i.test(el.innerText)) { el.click(); break; }
                        }
                    });
                }
                await page.waitForTimeout(4000);
            }

            // Step C: Generate the 2FA code
            let code = '';
            if (totpSecret) {
                code = generateTOTP(totpSecret);
                console.log(`${tag} 🔑 TOTP Code: ${code}`);
            } else {
                // Try recovery codes
                const recPath = path.join(DATA_DIR, `recovery_codes_${accName}.json`);
                if (fs.existsSync(recPath)) {
                    let codes = JSON.parse(fs.readFileSync(recPath, 'utf8'));
                    if (codes.length > 0) {
                        code = codes.shift();
                        console.log(`${tag} 🔑 Recovery Code: ${code} (${codes.length} left)`);
                        fs.writeFileSync(recPath, JSON.stringify(codes, null, 2));
                    } else {
                        console.log(`${tag} ❌ No recovery codes left!`);
                    }
                } else {
                    console.log(`${tag} ❌ No TOTP secret & no recovery codes for ${accName}`);
                }
            }

            // Step D: Fill the code into ANY visible input
            if (code) {
                // Try multiple selectors for the code input
                const selectors = [
                    'input[name="approvals_code"]',
                    'input[autocomplete="one-time-code"]',
                    'input[maxlength="6"]',
                    'input[maxlength="8"]',
                    'input[type="text"]',
                    'input[type="tel"]',
                ];
                let filled = false;
                for (const sel of selectors) {
                    const inp = await page.$(sel);
                    if (inp && await inp.isVisible()) {
                        await inp.fill(code);
                        await page.waitForTimeout(500);
                        console.log(`${tag} ✔️ Code filled (${sel}). Submitting...`);
                        await inp.press('Enter');
                        filled = true;
                        break;
                    }
                }
                if (!filled) {
                    // Last resort: Tab to focus any input, then type
                    console.log(`${tag} ⌨️ Fallback: Tab + typing code...`);
                    for (let t = 0; t < 5; t++) await page.keyboard.press('Tab');
                    await page.keyboard.type(code, { delay: 100 });
                    await page.keyboard.press('Enter');
                    filled = true;
                }

                await page.waitForTimeout(8000);

                // Handle "Save browser" / "Remember"
                try {
                    const saveBtnTexts = ['save browser', 'remember', 'nhớ trình duyệt', 'lưu trình duyệt', 'this was me'];
                    bodyText = await page.textContent('body').catch(() => '');
                    for (const t of saveBtnTexts) {
                        if (bodyText.toLowerCase().includes(t)) {
                            await page.locator(`button:text-matches("${t}", "i"), div[role="button"]:text-matches("${t}", "i")`).first().click({ timeout: 5000 });
                            console.log(`${tag} ✅ Clicked "${t}"!`);
                            await page.waitForTimeout(5000);
                            break;
                        }
                    }
                } catch { }

                // Handle "Continue" after 2FA
                try {
                    bodyText = await page.textContent('body').catch(() => '');
                    if (/continue|tiếp tục/i.test(bodyText)) {
                        await page.locator('button:text-matches("continue|tiếp tục", "i")').first().click({ timeout: 5000 });
                        await page.waitForTimeout(5000);
                    }
                } catch { }
            }
        }

        // ─── Phase 4: Verify Success ──────────────────────────────
        await page.waitForTimeout(3000);
        const finalUrl = page.url();
        const hasNav = await page.$('div[role="navigation"], div[aria-label="Facebook"], a[aria-label="Home"]');

        if (hasNav && !finalUrl.includes('checkpoint') && !finalUrl.includes('two_step') && !finalUrl.includes('two_factor')) {
            const sessionPath = path.join(SESSIONS_DIR, `${email.replace(/[^a-z0-9]/gi, '_')}.json`);
            await context.storageState({ path: sessionPath });
            fs.writeFileSync(path.join(DATA_DIR, `ua_${accName}.txt`), ua);
            console.log(`${tag} 🎉 SUCCESS! Session → ${path.basename(sessionPath)}`);
            await browser.close();
            return true;
        } else {
            console.log(`${tag} ❌ FAILED. Stuck at: ${finalUrl.substring(0, 100)}`);
            await page.screenshot({ path: path.join(DATA_DIR, `error_vip_${index}.png`) });
            await browser.close();
            return false;
        }

    } catch (e) {
        console.error(`${tag} ❌ Critical Error:`, e.message);
        try { await page.screenshot({ path: path.join(DATA_DIR, `error_vip_${index}.png`) }); } catch { }
        await browser.close();
        return false;
    }
}

async function run() {
    let index = 1;
    let success = 0, failed = 0;
    while (process.env[`FB_ACCOUNT_${index}_EMAIL`]) {
        const email = process.env[`FB_ACCOUNT_${index}_EMAIL`];
        const pass = process.env[`FB_ACCOUNT_${index}_PASSWORD`];
        const totp = process.env[`FB_ACCOUNT_${index}_TOTP_SECRET`];

        const ok = await loginAccount(index, email, pass, totp);
        if (ok) success++; else failed++;
        index++;
    }
    console.log(`\n🏁 Done! ✅ ${success} success, ❌ ${failed} failed (out of ${index - 1} accounts)`);
}

run();
