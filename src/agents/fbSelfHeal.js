/**
 * THG Lead Gen — Facebook Self-Healing Login Module
 * 
 * Strategy: Page No-JS Login → Save Device Confirm → Golden Session
 * 
 * KEY FIXES (from log analysis):
 *   1. Form submit via Enter key didn't POST — now clicks submit button directly
 *   2. After login POST, "Save Device" prompt blocks c_user cookie issuance
 *      → Now loops through all checkpoint prompts until c_user appears
 *   3. Was accepting WEAK sessions (no c_user) as "success"
 *      → Now only returns success if c_user is present
 *   4. Added page content dump for debugging when things fail
 * 
 * Flow:
 *   Phase 1 (No-JS):
 *     1. page.goto facebook.com → datr + noscript login form
 *     2. Fill email/pass → click submit button
 *     3. Handle checkpoint prompts (Save Device, Continue, 2FA)
 *     4. Loop until c_user appears or all prompts exhausted
 *   Phase 2 (JS Desktop):
 *     5. Transfer cookies → /me identity forcing → warm-up
 *     6. ONLY save as Golden Session if c_user + xs present
 * 
 * @module agents/fbSelfHeal
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ═══════════════════════════════════════════════════════
// Built-in TOTP generator
// ═══════════════════════════════════════════════════════
const authenticator = {
    generate(secret) {
        const cleanSecret = secret.replace(/\s/g, '');
        const base32chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let bits = '';
        for (const c of cleanSecret.toUpperCase()) {
            const val = base32chars.indexOf(c);
            if (val === -1) continue;
            bits += val.toString(2).padStart(5, '0');
        }
        const secretBytes = Buffer.alloc(Math.floor(bits.length / 8));
        for (let i = 0; i < secretBytes.length; i++) {
            secretBytes[i] = parseInt(bits.slice(i * 8, (i + 1) * 8), 2);
        }
        const epoch = Math.floor(Date.now() / 1000);
        const counter = Math.floor(epoch / 30);
        const counterBuf = Buffer.alloc(8);
        counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
        counterBuf.writeUInt32BE(counter & 0xFFFFFFFF, 4);
        const hmac = crypto.createHmac('sha1', secretBytes).update(counterBuf).digest();
        const offset = hmac[hmac.length - 1] & 0x0f;
        const code = ((hmac[offset] & 0x7f) << 24 | hmac[offset + 1] << 16 | hmac[offset + 2] << 8 | hmac[offset + 3]) % 1000000;
        return code.toString().padStart(6, '0');
    }
};

// ═══════════════════════════════════════════════════════
// UA Strategies
// ═══════════════════════════════════════════════════════

const UA_STRATEGIES = [
    {
        name: 'Pixel 9 Pro (Android 15)',
        ua: 'Mozilla/5.0 (Linux; Android 15; Pixel 9 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36',
        headers: {
            'sec-ch-ua': '"Not(A:Brand";v="99", "Google Chrome";v="133", "Chromium";v="133"',
            'sec-ch-ua-mobile': '?1',
            'sec-ch-ua-platform': '"Android"',
        },
        viewport: { width: 412, height: 915 },
    },
    {
        name: 'iPhone 15 Pro (Safari)',
        ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        headers: {
            'sec-ch-ua-mobile': '?1',
            'sec-ch-ua-platform': '"iOS"',
        },
        viewport: { width: 393, height: 852 },
    },
    {
        name: 'Galaxy S24 Ultra (Android 14)',
        ua: 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
        headers: {
            'sec-ch-ua': '"Not(A:Brand";v="99", "Samsung Internet";v="24", "Chromium";v="122"',
            'sec-ch-ua-mobile': '?1',
            'sec-ch-ua-platform': '"Android"',
        },
        viewport: { width: 384, height: 854 },
    },
];

const UA_DESKTOP_POOL = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
const BACKUP_DIR = path.join(SESSIONS_DIR, 'backups');

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════
// TOTP / Recovery Code helpers
// ═══════════════════════════════════════════════════════

function getTotpSecret(email) {
    let i = 1;
    while (process.env[`FB_ACCOUNT_${i}_EMAIL`]) {
        if (process.env[`FB_ACCOUNT_${i}_EMAIL`] === email) {
            return process.env[`FB_ACCOUNT_${i}_TOTP_SECRET`] || null;
        }
        i++;
    }
    return null;
}

function getRecoveryCode(accUsername) {
    const codesPath = path.join(DATA_DIR, `recovery_codes_${accUsername}.json`);
    if (!fs.existsSync(codesPath)) return null;
    try {
        const codes = JSON.parse(fs.readFileSync(codesPath, 'utf8'));
        if (!Array.isArray(codes) || codes.length === 0) return null;
        const code = codes.shift();
        fs.writeFileSync(codesPath, JSON.stringify(codes, null, 2));
        console.log(`[SelfHeal] 🎫 Recovery codes remaining for ${accUsername}: ${codes.length}`);
        return code;
    } catch { return null; }
}

// ═══════════════════════════════════════════════════════
// Session Health Check + Cleanup + Backup
// ═══════════════════════════════════════════════════════

function isSessionHealthy(accUsername) {
    const ssPath = path.join(SESSIONS_DIR, `${accUsername}_auth.json`);
    const backupPath = path.join(BACKUP_DIR, `${accUsername}_auth.json`);
    if (!fs.existsSync(ssPath) && fs.existsSync(backupPath)) {
        console.log(`[SelfHeal] 🔄 Restoring ${accUsername} from backup...`);
        fs.mkdirSync(SESSIONS_DIR, { recursive: true });
        fs.copyFileSync(backupPath, ssPath);
    }
    if (fs.existsSync(ssPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(ssPath, 'utf8'));
            const cookies = data.cookies || [];
            const hasCUser = cookies.some(c => c.name === 'c_user');
            const hasXs = cookies.some(c => c.name === 'xs');
            return { healthy: hasCUser && hasXs && cookies.length >= 10, cookieCount: cookies.length, hasCUser, hasXs };
        } catch { }
    }
    const cookiePath = path.join(DATA_DIR, `fb_cookies_${accUsername}.json`);
    if (fs.existsSync(cookiePath)) {
        try {
            const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
            const hasCUser = cookies.some(c => c.name === 'c_user');
            const hasXs = cookies.some(c => c.name === 'xs');
            return { healthy: hasCUser && hasXs && cookies.length >= 10, cookieCount: cookies.length, hasCUser, hasXs };
        } catch { }
    }
    return { healthy: false, cookieCount: 0, hasCUser: false, hasXs: false };
}

function clearInvalidSession(accUsername) {
    const targets = [
        path.join(SESSIONS_DIR, `${accUsername}_auth.json`),
        path.join(DATA_DIR, `fb_cookies_${accUsername}.json`),
    ];
    console.log(`[SelfHeal] 🧹 Clearing old session for ${accUsername}...`);
    for (const fp of targets) {
        try { if (fs.existsSync(fp)) { fs.unlinkSync(fp); console.log(`[SelfHeal]   🗑️ Deleted: ${path.basename(fp)}`); } }
        catch (e) { console.warn(`[SelfHeal]   ⚠️ ${path.basename(fp)}: ${e.message}`); }
    }
}

function backupGoldenSession(accUsername) {
    const source = path.join(SESSIONS_DIR, `${accUsername}_auth.json`);
    const target = path.join(BACKUP_DIR, `${accUsername}_auth.json`);
    try {
        if (fs.existsSync(source)) {
            fs.mkdirSync(BACKUP_DIR, { recursive: true });
            fs.copyFileSync(source, target);
            console.log(`[SelfHeal] 💾 Backed up → backups/${accUsername}_auth.json`);
        }
    } catch (e) { console.warn(`[SelfHeal] ⚠️ Backup error: ${e.message}`); }
}

// ═══════════════════════════════════════════════════════
// Zombie Cleanup (Docker-safe)
// ═══════════════════════════════════════════════════════

function killZombieBrowsers() {
    if (process.platform !== 'linux') return;
    try {
        console.log('[System] 🧛 Zombie Hunter: cleaning up...');
        execSync("ps aux | grep -v grep | grep -E 'chrom' | awk '{print $2}' | xargs -r kill -9 2>/dev/null", { timeout: 5000, stdio: 'ignore' });
        execSync('rm -rf /tmp/playwright_chromiumdev_profile-* 2>/dev/null', { timeout: 5000, stdio: 'ignore' });
        console.log('[System] ✅ Cleanup done');
    } catch { }
}

// ═══════════════════════════════════════════════════════
// Newsfeed Warming
// ═══════════════════════════════════════════════════════

async function interactWithNewsfeed(page, tag) {
    console.log(`${tag} 🎭 Warming: scroll + random Like...`);
    for (let i = 0; i < 3; i++) {
        await page.mouse.wheel(0, Math.floor(Math.random() * 800) + 400);
        await delay(2000 + Math.random() * 3000);
        if (Math.random() < 0.3) {
            try {
                const likeBtn = await page.$('div[role="button"][aria-label="Like"], div[role="button"][aria-label="Thích"]');
                if (likeBtn && (await likeBtn.getAttribute('aria-pressed')) !== 'true') {
                    await likeBtn.scrollIntoViewIfNeeded();
                    await delay(1000);
                    await likeBtn.click();
                    console.log(`${tag} 👍 Random Like!`);
                    await delay(2000 + Math.random() * 3000);
                }
            } catch { }
        }
    }
}

// ═══════════════════════════════════════════════════════
// Helper: dump page state for debugging
// ═══════════════════════════════════════════════════════

async function dumpPageState(page, tag, label) {
    const url = page.url();
    const content = await page.content();
    // Strip scripts and styles, get readable text
    const stripped = content
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    console.log(`${tag} 🔧 [${label}] URL: ${url.substring(0, 100)}`);
    console.log(`${tag} 🔧 [${label}] Text: ${stripped.substring(0, 300)}`);

    // Dump all clickable elements
    const buttons = await page.$$('input[type="submit"], button[type="submit"], input[name="login"], a[role="button"]');
    for (const btn of buttons.slice(0, 5)) {
        const value = await btn.getAttribute('value').catch(() => '');
        const name = await btn.getAttribute('name').catch(() => '');
        const text = await btn.textContent().catch(() => '');
        console.log(`${tag}   🔘 Button: name="${name}" value="${value}" text="${(text || '').trim().substring(0, 30)}"`);
    }
}

// ═══════════════════════════════════════════════════════
// Helper: click any "continue" / "OK" / "Save" button
// ═══════════════════════════════════════════════════════

async function clickAnyPromptButton(page, tag) {
    // Try multiple selectors for checkpoint confirmation buttons
    const selectors = [
        'input[type="submit"][value="Continue"]',
        'input[type="submit"][value="Tiếp tục"]',
        'input[type="submit"][value="OK"]',
        'input[type="submit"][value="Submit"]',
        'input[type="submit"][value="Log In"]',
        'input[type="submit"][value="Đăng nhập"]',
        'input[name="submit[Continue]"]',
        'input[name="submit[This was me]"]',
        'input[name="submit[Đây là tôi]"]',
        'button[type="submit"]',
        'button[name="submit"]',
        'input[type="submit"]', // Catch-all
    ];

    for (const sel of selectors) {
        const btn = await page.$(sel);
        if (btn) {
            const val = await btn.getAttribute('value').catch(() => '');
            const name = await btn.getAttribute('name').catch(() => '');
            console.log(`${tag} 👆 Clicking: "${val || name || sel}"`);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => { }),
                btn.click(),
            ]);
            await delay(3000);
            return true;
        }
    }
    return false;
}

// ═══════════════════════════════════════════════════════
// Try login with one UA strategy (Page No-JS)
// ═══════════════════════════════════════════════════════

async function tryLoginWithStrategy(browser, strategy, accEmail, accPassword, code, tag) {
    let ctx = null;
    try {
        ctx = await browser.newContext({
            userAgent: strategy.ua,
            extraHTTPHeaders: strategy.headers,
            viewport: strategy.viewport,
            isMobile: true,
            javaScriptEnabled: false, // No JS = No Arkose
            locale: 'en-US',
        });

        const page = await ctx.newPage();

        // ─── Step 1: Navigate to facebook.com (datr + noscript form) ───
        console.log(`${tag} 🎣 Loading facebook.com (No-JS mode)...`);
        await page.goto('https://www.facebook.com/', {
            waitUntil: 'load',
            timeout: 60000,
        });
        await delay(3000);

        const cookies0 = await ctx.cookies();
        const hasDatr = cookies0.some(c => c.name === 'datr');
        console.log(`${tag} 🔧 Landing: ${page.url().substring(0, 80)}, datr: ${hasDatr ? '✅' : '❌'}`);

        // ─── Step 2: Find login form ───
        console.log(`${tag} 🔍 Searching for login form...`);

        // Try www.facebook.com first (noscript version)
        let emailInput = await page.$('input[name="email"]');
        let passInput = await page.$('input[name="pass"]');

        if (!emailInput || !passInput) {
            console.log(`${tag} 🔧 No form on www. Trying mbasic...`);
            await page.goto('https://mbasic.facebook.com/login.php', {
                waitUntil: 'load', timeout: 30000,
            });
            await delay(3000);
            emailInput = await page.$('input[name="email"]');
            passInput = await page.$('input[name="pass"]');
        }

        if (!emailInput || !passInput) {
            console.warn(`${tag} ❌ No login form with ${strategy.name}`);
            await dumpPageState(page, tag, 'NO_FORM');
            await ctx.close();
            return null;
        }

        // ─── Step 3: Fill form and CLICK submit button ───
        console.log(`${tag} 📝 Login form found! Filling...`);
        await emailInput.fill(accEmail);
        await delay(500 + Math.random() * 500);
        await passInput.fill(accPassword);
        await delay(500 + Math.random() * 500);

        // Find and CLICK the submit button (not just Enter)
        const loginBtn = await page.$(
            'input[type="submit"][name="login"], ' +
            'input[type="submit"][value="Log In"], ' +
            'input[type="submit"][value="Đăng nhập"], ' +
            'button[name="login"], ' +
            'button[type="submit"], ' +
            'input[type="submit"]'
        );

        if (loginBtn) {
            const btnValue = await loginBtn.getAttribute('value').catch(() => 'submit');
            console.log(`${tag} 🖱️ Clicking login button: "${btnValue}"`);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => { }),
                loginBtn.click(),
            ]);
        } else {
            console.log(`${tag} ⌨️ No button found, pressing Enter...`);
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'load', timeout: 30000 }).catch(() => { }),
                page.keyboard.press('Enter'),
            ]);
        }
        await delay(5000);

        const postLoginUrl = page.url();
        console.log(`${tag} 🔧 Post-login URL: ${postLoginUrl.substring(0, 100)}`);

        // ─── Step 4: Handle ALL checkpoint prompts ───
        // Facebook often shows: Save Device → Review Login → Continue
        // Must click through ALL of them to get c_user cookie
        for (let promptStep = 0; promptStep < 8; promptStep++) {
            // Check if c_user appeared
            const ck = await ctx.cookies();
            if (ck.some(c => c.name === 'c_user')) {
                console.log(`${tag} 🎉 c_user cookie obtained after step ${promptStep}!`);
                break;
            }

            const currentUrl = page.url();

            // ── Handle 2FA checkpoint ──
            if (currentUrl.includes('checkpoint') || currentUrl.includes('two_step') ||
                currentUrl.includes('approvals')) {

                // Look for 2FA code input
                const codeInput = await page.$(
                    'input[name="approvals_code"], ' +
                    'input[type="text"]:not([name="email"]):not([name="lsd"]), ' +
                    'input[type="tel"]'
                );

                if (codeInput && code) {
                    const codeInputName = await codeInput.getAttribute('name').catch(() => 'unknown');
                    console.log(`${tag} 🔐 2FA input found (name="${codeInputName}"), submitting code: ${code}`);
                    await codeInput.fill(code.replace(/\s/g, ''));
                    await delay(1000);

                    // Check "Save device" radio/checkbox
                    const saveDeviceOpt = await page.$(
                        'input[name="name_action_selected"][value="save_device"], ' +
                        'input[name="save_device"][value="1"]'
                    );
                    if (saveDeviceOpt) {
                        try { await saveDeviceOpt.click(); } catch { }
                        console.log(`${tag} 💾 "Save Device" selected`);
                    }

                    // Submit 2FA
                    const clicked = await clickAnyPromptButton(page, tag);
                    if (!clicked) {
                        await Promise.all([
                            page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => { }),
                            page.keyboard.press('Enter'),
                        ]);
                        await delay(3000);
                    }
                    console.log(`${tag} 🔧 Post-2FA URL: ${page.url().substring(0, 100)}`);
                    continue;
                }
            }

            // ── Handle any other prompt (Save Device, Continue, Review Login) ──
            const clicked = await clickAnyPromptButton(page, tag);
            if (clicked) {
                console.log(`${tag} ✅ Prompt step ${promptStep + 1}: ${page.url().substring(0, 80)}`);
                continue;
            }

            // No more buttons to click — check if we're stuck
            if (promptStep === 0) {
                // First iteration after login — dump page to understand what we got
                await dumpPageState(page, tag, 'POST_LOGIN');
            }
            break; // No more prompts
        }

        // ─── Step 5: Verify cookies after all prompts ───
        const phase1Cookies = await ctx.cookies();
        const hasCUser = phase1Cookies.some(c => c.name === 'c_user');
        const hasXs = phase1Cookies.some(c => c.name === 'xs');
        console.log(`${tag} 📥 Phase 1 cookies: ${phase1Cookies.length}, c_user: ${hasCUser ? '✅' : '❌'}, xs: ${hasXs ? '✅' : '❌'}`);

        // ─── Step 6: Golden Session (only if login showed progress) ───
        // Even without c_user, proceed to Phase 2 — identity forcing might generate it
        const allCookies = await ctx.cookies();
        await ctx.close();
        ctx = null;

        // Only proceed to Golden Session if we got MORE than the initial 2 cookies
        // (datr + fr), meaning login had SOME effect
        if (allCookies.length <= 2 && !hasCUser) {
            console.warn(`${tag} ❌ Login had NO effect (still only ${allCookies.length} cookies). Form submit likely failed.`);
            return null;
        }

        const goldenUA = UA_DESKTOP_POOL[Math.floor(Math.random() * UA_DESKTOP_POOL.length)];
        console.log(`${tag} 💎 Phase 2: Golden Session (${allCookies.length} cookies → desktop context)...`);

        const goldenCtx = await browser.newContext({
            userAgent: goldenUA,
            viewport: { width: 1280, height: 720 },
            locale: 'en-US',
        });
        await goldenCtx.addCookies(allCookies);
        const goldenPage = await goldenCtx.newPage();

        try {
            // Identity Forcing
            console.log(`${tag} 🆔 Identity forcing: /me...`);
            await goldenPage.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await delay(5000);
            let meUrl = goldenPage.url();
            console.log(`${tag} 🔧 /me → ${meUrl.substring(0, 100)}`);

            // Handle checkpoint on /me page
            if (meUrl.includes('checkpoint') || meUrl.includes('login')) {
                for (let i = 0; i < 3; i++) {
                    await goldenPage.keyboard.press('Enter');
                    await delay(3000);
                }
                meUrl = goldenPage.url();
            }

            // Warm-up if actually logged in
            if (!meUrl.includes('/login')) {
                console.log(`${tag} 🎢 Warming up...`);
                await goldenPage.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => { });
                await delay(5000);
                await interactWithNewsfeed(goldenPage, tag);
                await goldenPage.goto('https://www.facebook.com/groups/feed/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
                await delay(5000);
            }

            // Final cookie check
            const finalCookies = await goldenCtx.cookies();
            const fbCookies = finalCookies.filter(c => c.domain?.includes('facebook'));
            const finalCUser = finalCookies.some(c => c.name === 'c_user');
            const finalXs = finalCookies.some(c => c.name === 'xs');
            console.log(`${tag} 🍪 Final: ${finalCookies.length} total, ${fbCookies.length} FB, c_user: ${finalCUser ? '✅' : '❌'}, xs: ${finalXs ? '✅' : '❌'}`);

            const accUsername = accEmail.split('@')[0];
            fs.mkdirSync(SESSIONS_DIR, { recursive: true });
            const ssPath = path.join(SESSIONS_DIR, `${accUsername}_auth.json`);
            await goldenCtx.storageState({ path: ssPath });
            fs.writeFileSync(path.join(DATA_DIR, `fb_cookies_${accUsername}.json`), JSON.stringify(fbCookies, null, 2));

            await goldenCtx.close();

            if (finalCUser && finalXs) {
                console.log(`${tag} ✨ GOLDEN SESSION! (${fbCookies.length} cookies) → ${accUsername}`);
                backupGoldenSession(accUsername);
                return ssPath;
            } else if (finalCUser) {
                console.log(`${tag} ⚠️ Got c_user but no xs — session may be partial`);
                return ssPath;
            } else {
                console.warn(`${tag} ❌ Phase 2 failed: no c_user after identity forcing`);
                return null; // DON'T return success without c_user!
            }
        } catch (warmErr) {
            console.warn(`${tag} ⚠️ Phase 2 error: ${warmErr.message}`);
            try { await goldenCtx.close(); } catch { }
            return null;
        }

    } catch (err) {
        console.warn(`${tag} ❌ ${strategy.name} error: ${err.message}`);
        if (ctx) try { await ctx.close(); } catch { }
        return null;
    }
}

// ═══════════════════════════════════════════════════════
// MAIN: Self-Heal Login with UA Rotation
// ═══════════════════════════════════════════════════════

async function selfHealLogin(browser, account, tag) {
    const accEmail = account.email;
    const accPassword = account.password;
    const accUsername = accEmail.split('@')[0];

    if (!accPassword) {
        console.warn(`${tag} ⚠️ No password — cannot self-heal`);
        return null;
    }

    clearInvalidSession(accUsername);

    // Generate 2FA code
    let code = null;
    const totpSecret = getTotpSecret(accEmail);
    console.log(`${tag} 🔧 TOTP: ${totpSecret ? 'YES' : 'NO'}`);
    if (totpSecret) {
        try {
            code = authenticator.generate(totpSecret);
            console.log(`${tag} 🔑 TOTP code: ${code}`);
        } catch (e) { console.warn(`${tag} ⚠️ TOTP error: ${e.message}`); }
    }
    if (!code) {
        code = getRecoveryCode(accUsername);
        if (code) console.log(`${tag} 🎫 Recovery code: ${code}`);
    }

    // ═══ Try each UA strategy ═══
    for (let i = 0; i < UA_STRATEGIES.length; i++) {
        const strategy = UA_STRATEGIES[i];
        console.log(`${tag} 🎭 [${i + 1}/${UA_STRATEGIES.length}] Trying: ${strategy.name}...`);

        const result = await tryLoginWithStrategy(browser, strategy, accEmail, accPassword, code, tag);
        if (result) {
            console.log(`${tag} 🏆 Success with ${strategy.name}!`);
            return result;
        }

        // Refresh TOTP between strategies
        if (totpSecret && i < UA_STRATEGIES.length - 1) {
            try { code = authenticator.generate(totpSecret); console.log(`${tag} 🔄 Refreshed TOTP: ${code}`); }
            catch { }
        }
        await delay(3000);
    }

    console.warn(`${tag} 🚨 All ${UA_STRATEGIES.length} UA strategies failed — no c_user obtained`);
    return null;
}

module.exports = {
    selfHealLogin,
    isSessionHealthy,
    getTotpSecret,
    getRecoveryCode,
    clearInvalidSession,
    backupGoldenSession,
    killZombieBrowsers,
    interactWithNewsfeed,
};
