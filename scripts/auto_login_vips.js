#!/usr/bin/env node
require('dotenv').config();
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');

chromium.use(StealthPlugin());

const SESSIONS_DIR = path.join(__dirname, '..', 'data', 'fb_sessions');
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

function getProxy(email) {
    const accName = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
    return process.env[`PROXY_${accName}`] || process.env[`PROXY_${email.split('@')[0]}`] || '';
}

async function loginAccount(index, email, password, totpSecret) {
    console.log(`\n========================================================`);
    console.log(`🚀 [VIP ${index}] Log in to Official Account: ${email}`);

    const proxyUrl = getProxy(email);
    console.log(`🌐 Proxy: ${proxyUrl ? 'YES (Static)' : 'NO'}`);

    const browserArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-setuid-sandbox'];
    const launchOptions = { headless: false, args: browserArgs }; // headless: false for local observation

    const browser = await chromium.launch(launchOptions);

    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    const contextOpts = {
        userAgent: ua,
        viewport: { width: 1366, height: 768 },
        locale: 'en-US',
        timezoneId: 'America/New_York',
    };

    if (proxyUrl) {
        const purl = new URL(proxyUrl);
        contextOpts.proxy = {
            server: `${purl.protocol}//${purl.hostname}:${purl.port}`,
            username: purl.username || undefined,
            password: purl.password || undefined,
        };
    }

    const context = await browser.newContext(contextOpts);
    const page = await context.newPage();

    const tag = `[VIP ${index}]`;
    const accName = email.split('@')[0];

    try {
        console.log(`${tag} 📡 Navigating to facebook.com...`);
        await page.goto('https://www.facebook.com/', { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Check if already logged in
        if (await page.$('div[role="navigation"]')) {
            console.log(`${tag} ✅ Already logged in via cookies!`);
        } else {
            console.log(`${tag} 📝 Filling login form...`);
            const emailInput = await page.$('input[name="email"]') || await page.$('input[type="text"]');
            const passInput = await page.$('input[name="pass"]') || await page.$('input[type="password"]');

            if (emailInput && passInput) {
                await emailInput.fill(email);
                await page.waitForTimeout(500);
                await passInput.fill(password);
                await page.waitForTimeout(500);

                console.log(`${tag} ⚡ Submitting...`);
                await passInput.press('Enter');

                console.log(`${tag} ⏳ Waiting for redirect...`);
                try {
                    await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15000 });
                } catch { }
                await page.waitForTimeout(5000);
            }
        }

        // Deal with Checkpoint / 2FA
        const currentUrl = page.url();
        if (currentUrl.includes('checkpoint') || currentUrl.includes('two_factor')) {
            console.log(`${tag} ⚠️ Checkpoint/2FA Detected! Attempting Auto-Bypass...`);

            // Bypass "Check your notifications on another device"
            const bodyText = await page.textContent('body');
            const hasAnotherWay = /try another way|thử cách khác|another way/i.test(bodyText);

            if (hasAnotherWay) {
                console.log(`${tag} 🔄 Found "Try Another Way". Attempting keyboard/click bypass...`);
                // 1. Try explicit click via Playwright locators
                try {
                    const btn = page.locator('text="Try Another Way"').or(page.locator('text="Thử cách khác"')).first();
                    await btn.click({ force: true, timeout: 5000 });
                    console.log(`${tag} 🔄 Clicked Try Another Way!`);
                } catch (e) {
                    console.log(`${tag} 🔄 Fallback DOM click...`);
                    await page.evaluate(() => {
                        Array.from(document.querySelectorAll('div, span, a, button[type="button"]')).some(el => {
                            if (/try another way|thử cách khác/i.test(el.innerText)) {
                                el.click();
                                return true;
                            }
                        });
                    });
                }
                await page.waitForTimeout(3000);

                // 2. Select Authentication App
                try {
                    const btn = page.locator('text="Authentication app"').or(page.locator('text="Ứng dụng xác thực"')).first();
                    await btn.click({ force: true, timeout: 5000 });
                } catch (e) {
                    await page.evaluate(() => {
                        Array.from(document.querySelectorAll('div, span')).some(el => {
                            if (/authentication app/i.test(el.innerText)) { el.click(); return true; }
                        });
                    });
                }
                await page.waitForTimeout(2000);

                // 3. Click Continue
                try {
                    const btn = page.locator('button:has-text("Continue"), button:has-text("Tiếp tục")').first();
                    await btn.click({ force: true, timeout: 5000 });
                } catch (e) {
                    await page.evaluate(() => {
                        Array.from(document.querySelectorAll('button')).some(el => {
                            if (/continue|tiếp tục/i.test(el.innerText)) { el.click(); return true; }
                        });
                    });
                }
                await page.waitForTimeout(4000); // Wait for the code input field to appear
            }

            // Fill OTP or Recovery Code
            console.log(`${tag} 🔢 Getting 2FA Code...`);
            let code = '';

            if (totpSecret) {
                console.log(`${tag} 🔑 Using TOTP Secret from .env...`);
                const { authenticator } = await import('otplib');
                code = authenticator.generate(totpSecret.replace(/\s+/g, ''));
                console.log(`${tag} 🔑 Generated Code: ${code}`);
            } else {
                console.log(`${tag} 🔑 No TOTP in .env! Looking for recovery codes in data/recovery_codes_${accName}.json...`);
                const recPath = path.join(DATA_DIR, `recovery_codes_${accName}.json`);
                if (fs.existsSync(recPath)) {
                    let codes = JSON.parse(fs.readFileSync(recPath, 'utf8'));
                    if (codes.length > 0) {
                        code = codes.shift();
                        console.log(`${tag} 🔑 Plucked Recovery Code: ${code} (${codes.length} remaining)`);
                        fs.writeFileSync(recPath, JSON.stringify(codes, null, 2));
                    } else {
                        console.log(`${tag} ❌ Out of recovery codes!`);
                    }
                } else {
                    console.log(`${tag} ❌ No recovery codes found at ${recPath}`);
                }
            }

            if (code) {
                const codeInput = await page.$('input[maxlength="6"], input[maxlength="8"], input[type="text"], input[name="approvals_code"]');
                if (codeInput) {
                    await codeInput.fill(code);
                    await page.waitForTimeout(1000);
                    console.log(`${tag} ✔️ Code filled. Hitting Enter...`);
                    await codeInput.press('Enter');

                    await page.waitForTimeout(5000);

                    // Check "Remember browser" checkbox
                    const rememberBtn = await page.locator('button:has-text("Remember"), button:has-text("Save browser"), button:has-text("Nhớ trình duyệt")').first();
                    if (await rememberBtn.isVisible()) {
                        await rememberBtn.click();
                        console.log(`${tag} ✅ Browser remembered!`);
                        await page.waitForTimeout(5000);
                    }
                } else {
                    console.log(`${tag} ❌ Could not find 2FA code input field.`);
                }
            }
        }

        // Verify Success
        await page.waitForTimeout(5000);
        const finalUrl = page.url();
        const hasNav = await page.$('div[role="navigation"], div[aria-label="Facebook"]');

        if (hasNav && !finalUrl.includes('checkpoint')) {
            const authPath = path.join(SESSIONS_DIR, `${accName}_auth.json`); // Must be _auth.json? No, accountManager expects email.json!
            const legitPath = path.join(SESSIONS_DIR, `${email.replace(/[^a-z0-9]/gi, '_')}.json`);

            await context.storageState({ path: legitPath });
            fs.writeFileSync(path.join(DATA_DIR, `ua_${accName}.txt`), ua);
            console.log(`${tag} 🎉 SUCCESS! Session saved to ${legitPath}`);
        } else {
            console.log(`${tag} ❌ FAILED to login. Stuck at: ${finalUrl}`);
            await page.screenshot({ path: path.join(DATA_DIR, `error_vip_${index}.png`) });
        }

    } catch (e) {
        console.error(`${tag} ❌ Critical Error:`, e.message);
    } finally {
        await browser.close();
    }
}

async function run() {
    let index = 1;
    while (process.env[`FB_ACCOUNT_${index}_EMAIL`]) {
        const email = process.env[`FB_ACCOUNT_${index}_EMAIL`];
        const pass = process.env[`FB_ACCOUNT_${index}_PASSWORD`];
        const totp = process.env[`FB_ACCOUNT_${index}_TOTP_SECRET`];

        await loginAccount(index, email, pass, totp);
        index++;
    }
    console.log(`\n🏁 Auto-Login Finished for ${index - 1} VIP Accounts.`);
}

run();
