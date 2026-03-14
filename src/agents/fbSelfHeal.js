/**
 * THG Lead Gen — Facebook Self-Healing Login Module
 * 
 * Strategy: mbasic No-JS + Route Interception → Golden Session
 * 
 * Phase 1: Login + 2FA on mbasic.facebook.com with JS OFF
 *   - page.route() intercepts 302 redirects from www → mbasic
 *   - Arkose Labs disabled (no JS = no MatchKey)
 *   - Plain HTML forms: input[name="email"], input[name="approvals_code"]
 *   - Checks "Save Device" radio button to avoid repeated 2FA
 * 
 * Phase 2: Golden Session (JS enabled)
 *   - Transfer cookies to desktop context
 *   - Identity Forcing: /me → forces c_user + xs cookie creation
 *   - Newsfeed warm-up: scroll + random Like (trust score)
 * 
 * @module agents/fbSelfHeal
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ═══════════════════════════════════════════════════════
// Built-in TOTP generator (same as fbScraper — no otplib dep)
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
// Constants
// ═══════════════════════════════════════════════════════

const UA_MOBILE = 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';

const UA_POOL = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0',
];

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════
// TOTP / Recovery Code helpers
// ═══════════════════════════════════════════════════════

/** Get TOTP secret for an account from env vars */
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

/** Get and consume a recovery code (removes used code from file) */
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
// Session Health Check
// ═══════════════════════════════════════════════════════

/**
 * Check if a session has the critical cookies (c_user, xs)
 * @returns {{ healthy: boolean, cookieCount: number, hasCUser: boolean, hasXs: boolean }}
 */
function isSessionHealthy(accUsername) {
    // Check storageState file first
    const ssPath = path.join(SESSIONS_DIR, `${accUsername}_auth.json`);
    if (fs.existsSync(ssPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(ssPath, 'utf8'));
            const cookies = data.cookies || [];
            const hasCUser = cookies.some(c => c.name === 'c_user');
            const hasXs = cookies.some(c => c.name === 'xs');
            return { healthy: hasCUser && hasXs && cookies.length >= 10, cookieCount: cookies.length, hasCUser, hasXs };
        } catch { }
    }
    // Check fb_cookies file
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

// ═══════════════════════════════════════════════════════
// Newsfeed Warming + VIP Interaction
// ═══════════════════════════════════════════════════════

/** Scroll newsfeed + random Like to boost trust score */
async function interactWithNewsfeed(page, tag) {
    console.log(`${tag} 🎭 Warming: scroll + random Like...`);
    for (let i = 0; i < 4; i++) {
        await page.mouse.wheel(0, Math.floor(Math.random() * 800) + 400);
        await delay(2000 + Math.random() * 3000);

        // 30% chance to Like
        if (Math.random() < 0.3) {
            try {
                const likeBtn = await page.$('div[role="button"][aria-label="Like"], div[role="button"][aria-label="Thích"]');
                if (likeBtn) {
                    const isPressed = await likeBtn.getAttribute('aria-pressed');
                    if (isPressed !== 'true') {
                        await likeBtn.scrollIntoViewIfNeeded();
                        await delay(1000);
                        await likeBtn.click();
                        console.log(`${tag} 👍 Random Like!`);
                        await delay(3000 + Math.random() * 3000);
                    }
                }
            } catch { }
        }
    }
}

// ═══════════════════════════════════════════════════════
// MAIN: Self-Heal Login (mbasic No-JS + Golden Session)
// ═══════════════════════════════════════════════════════

/**
 * Self-Healing Login: mbasic No-JS Protocol
 * Phase 1: mbasic login with route interception
 * Phase 2: Golden Session with identity forcing
 * 
 * @param {Browser} browser - Playwright browser instance
 * @param {object} account - { email, password }
 * @param {string} tag - log prefix e.g. "[manyhope0502]"
 * @returns {string|null} path to storageState file, or null
 */
async function selfHealLogin(browser, account, tag) {
    const accEmail = account.email;
    const accPassword = account.password;
    const accUsername = accEmail.split('@')[0];

    if (!accPassword) {
        console.warn(`${tag} ⚠️ No password — cannot self-heal`);
        return null;
    }

    // Generate 2FA code upfront
    let code = null;
    const totpSecret = getTotpSecret(accEmail);
    console.log(`${tag} 🔧 TOTP: ${totpSecret ? 'YES' : 'NO'}`);
    if (totpSecret) {
        try {
            code = authenticator.generate(totpSecret);
            console.log(`${tag} 🔑 TOTP code: ${code}`);
        } catch (e) {
            console.warn(`${tag} ⚠️ TOTP error: ${e.message}`);
        }
    }
    if (!code) {
        code = getRecoveryCode(accUsername);
        if (code) console.log(`${tag} 🎫 Recovery code: ${code}`);
    }

    let noJsCtx = null;
    try {
        // ═══ PHASE 1: mbasic No-JS Login (Arkose Labs disabled) ═══
        console.log(`${tag} 🛡️ Phase 1: mbasic No-JS login (route interception)...`);
        noJsCtx = await browser.newContext({
            javaScriptEnabled: false,  // CRITICAL: Disables Arkose Labs MatchKey
            userAgent: UA_MOBILE,
            viewport: { width: 390, height: 844 },
        });
        const page = await noJsCtx.newPage();

        // ─── Route Interception: Force www → mbasic ───
        // When FB 302-redirects to www, intercept and rewrite back to mbasic
        let interceptCount = 0;
        const MAX_INTERCEPTS = 15;
        await page.route('**/*', async (route) => {
            const url = route.request().url();
            if (url.includes('www.facebook.com') && interceptCount < MAX_INTERCEPTS) {
                interceptCount++;
                // Rewrite to mbasic + strip redirect params
                const mUrl = url.replace('www.facebook.com', 'mbasic.facebook.com')
                    .replace(/[?&]__mmr=1/g, '')
                    .replace(/[?&]_rdr/g, '')
                    .replace(/[?&]_fb_noscript=1/g, '');
                console.log(`${tag} 🔀 [${interceptCount}] www→mbasic: ...${url.split('/').slice(3).join('/').substring(0, 50)}`);
                await route.continue({ url: mUrl });
            } else {
                await route.continue();
            }
        });

        // Navigate to mbasic login
        await page.goto('https://mbasic.facebook.com/login/', { waitUntil: 'load', timeout: 30000 });
        await delay(3000);

        const landingUrl = page.url();
        console.log(`${tag} 🔧 Landing: ${landingUrl.substring(0, 100)}`);

        // Dump page text for debugging
        const pageContent = await page.content();
        const pageText = pageContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').substring(0, 200);
        console.log(`${tag} 🔧 Page: ${pageText.substring(0, 120)}`);

        // Find login form
        const emailInput = await page.$('input[name="email"]');
        const passInput = await page.$('input[name="pass"]');
        if (!emailInput || !passInput) {
            console.warn(`${tag} ⚠️ No login form found on mbasic!`);
            console.log(`${tag} 🔧 URL: ${page.url()}`);
            await noJsCtx.close();
            return null;
        }

        console.log(`${tag} 📝 Login form found! Filling...`);
        await emailInput.fill(accEmail);
        await delay(500);
        await passInput.fill(accPassword);
        await delay(500);

        // Submit
        const loginBtn = await page.$('input[name="login"], input[type="submit"], button[name="login"]');
        if (loginBtn) {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'load', timeout: 25000 }).catch(() => { }),
                loginBtn.click().catch(() => page.keyboard.press('Enter'))
            ]);
        } else {
            await Promise.all([
                page.waitForNavigation({ waitUntil: 'load', timeout: 25000 }).catch(() => { }),
                page.keyboard.press('Enter')
            ]);
        }
        await delay(5000);
        console.log(`${tag} 🔧 Post-login: ${page.url().substring(0, 100)}`);

        // ─── 2FA HANDLING (mbasic plain HTML forms) ───
        if (page.url().includes('checkpoint') || page.url().includes('two_step') || page.url().includes('approvals')) {
            console.log(`${tag} 🔐 2FA checkpoint detected...`);

            if (!code) {
                console.warn(`${tag} ❌ No 2FA code available!`);
                await noJsCtx.close();
                return null;
            }

            // Dump 2FA page
            const tfaContent = await page.content();
            const tfaText = tfaContent.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').substring(0, 200);
            console.log(`${tag} 🔧 2FA page: ${tfaText.substring(0, 150)}`);

            // Find code input
            let codeInput = await page.$('input[name="approvals_code"]');

            if (!codeInput) {
                // Look for "Try another way" / "Thử cách khác" / login code links
                console.log(`${tag} 🔍 No code input — looking for alternatives...`);
                const links = await page.$$('a');
                for (const link of links) {
                    try {
                        const text = await link.textContent();
                        if (text && /another way|khác|login code|mã xác nhận|code|text message/i.test(text)) {
                            console.log(`${tag} 🔧 Clicking: "${text.trim().substring(0, 40)}"...`);
                            await Promise.all([
                                page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => { }),
                                link.click()
                            ]);
                            await delay(3000);
                            break;
                        }
                    } catch { }
                }

                // Also try checkpoint fallback URL
                if (!await page.$('input[name="approvals_code"]')) {
                    const fallbackLink = await page.$('a[href*="checkpoint/fallback"]');
                    if (fallbackLink) {
                        console.log(`${tag} 🔧 Clicking fallback link...`);
                        await Promise.all([
                            page.waitForNavigation({ waitUntil: 'load', timeout: 15000 }).catch(() => { }),
                            fallbackLink.click()
                        ]);
                        await delay(3000);
                    }
                }

                // Retry finding code input
                codeInput = await page.$('input[name="approvals_code"]') ||
                    await page.$('input[type="text"]:not([name="email"]):not([name="pass"])') ||
                    await page.$('input[type="tel"]');
            }

            if (codeInput) {
                console.log(`${tag} ✅ Code input FOUND — filling ${code}...`);
                await codeInput.fill(code.replace(/\s/g, ''));
                await delay(1000);

                // Check "Save Device" radio (mbasic uses radio buttons)
                const saveRadio = await page.$('input[name="save_device"][value="1"]');
                if (saveRadio) {
                    await saveRadio.check();
                    console.log(`${tag} 💾 "Save Device" checked`);
                }

                // Submit
                const submitBtn = await page.$('input[type="submit"], button[type="submit"]');
                if (submitBtn) {
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => { }),
                        submitBtn.click().catch(() => page.keyboard.press('Enter'))
                    ]);
                } else {
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'load', timeout: 20000 }).catch(() => { }),
                        page.keyboard.press('Enter')
                    ]);
                }
                await delay(5000);
                console.log(`${tag} 🔧 After 2FA: ${page.url().substring(0, 100)}`);
            } else {
                console.warn(`${tag} ❌ No code input found on 2FA page!`);
                const html = await page.content();
                console.log(`${tag} 🔧 HTML: ${html.substring(0, 400)}`);
                await noJsCtx.close();
                return null;
            }

            // Handle "Review Login" steps (keep pressing Enter/submit)
            for (let step = 0; step < 6; step++) {
                const stepUrl = page.url();
                if (!stepUrl.includes('checkpoint') && !stepUrl.includes('two_step') && !stepUrl.includes('approvals')) break;

                // Check "Save Device" on subsequent pages too
                const sr = await page.$('input[name="save_device"][value="1"], input[name="submit[Continue]"]');
                if (sr) await sr.check().catch(() => { });

                const contBtn = await page.$('input[type="submit"], button[type="submit"]');
                if (contBtn) {
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'load', timeout: 10000 }).catch(() => { }),
                        contBtn.click().catch(() => page.keyboard.press('Enter'))
                    ]);
                } else {
                    await Promise.all([
                        page.waitForNavigation({ waitUntil: 'load', timeout: 10000 }).catch(() => { }),
                        page.keyboard.press('Enter')
                    ]);
                }
                await delay(3000);
                console.log(`${tag} ✅ Checkpoint step ${step + 1} → ${page.url().substring(0, 80)}`);
            }
        }

        // ─── Phase 1 Complete: Collect cookies ───
        const phase1Cookies = await noJsCtx.cookies();
        const p1Fb = phase1Cookies.filter(c => c.domain?.includes('facebook'));
        console.log(`${tag} 📥 Phase 1: ${phase1Cookies.length} total, ${p1Fb.length} Facebook cookies`);
        console.log(`${tag} 🔧 Phase 1 final URL: ${page.url().substring(0, 100)}`);
        await noJsCtx.close();
        noJsCtx = null;

        // ═══ PHASE 2: Golden Session (JS enabled + Identity Forcing) ═══
        const goldenUA = UA_POOL[Math.floor(Math.random() * UA_POOL.length)];
        console.log(`${tag} 💎 Phase 2: Golden Session (UA: ${goldenUA.substring(0, 40)}...)...`);

        const goldenCtx = await browser.newContext({
            userAgent: goldenUA,
            viewport: { width: 1280, height: 720 },
        });
        await goldenCtx.addCookies(phase1Cookies);
        const goldenPage = await goldenCtx.newPage();

        try {
            // Identity Forcing: /me forces c_user cookie creation
            console.log(`${tag} 🆔 Identity forcing: /me...`);
            await goldenPage.goto('https://www.facebook.com/me', { waitUntil: 'domcontentloaded', timeout: 60000 });
            await delay(5000);

            let meUrl = goldenPage.url();
            console.log(`${tag} 🔧 /me URL: ${meUrl.substring(0, 100)}`);

            // Handle checkpoint confirmation
            if (meUrl.includes('checkpoint') || meUrl.includes('login')) {
                console.log(`${tag} 🛡️ Checkpoint, confirming...`);
                for (let i = 0; i < 3; i++) {
                    await goldenPage.keyboard.press('Enter');
                    await delay(3000);
                }
                meUrl = goldenPage.url();
            }

            // Newsfeed warm-up + VIP interaction
            if (!meUrl.includes('/login')) {
                console.log(`${tag} 🎢 Warming up newsfeed...`);
                await goldenPage.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
                await delay(5000);

                // Scroll + random Like
                await interactWithNewsfeed(goldenPage, tag);

                // Visit Groups feed
                await goldenPage.goto('https://www.facebook.com/groups/feed/', { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => { });
                await delay(5000);
            }

            // ─── Check Cookie Quality + Save ───
            const cookies = await goldenCtx.cookies();
            const fbCookies = cookies.filter(c => c.domain?.includes('facebook'));
            const hasCUser = cookies.some(c => c.name === 'c_user');
            const hasXs = cookies.some(c => c.name === 'xs');
            console.log(`${tag} 🍪 Total: ${cookies.length}, FB: ${fbCookies.length}, c_user: ${hasCUser ? '✅' : '❌'}, xs: ${hasXs ? '✅' : '❌'}`);

            // Save session files
            fs.mkdirSync(SESSIONS_DIR, { recursive: true });
            const ssPath = path.join(SESSIONS_DIR, `${accUsername}_auth.json`);
            await goldenCtx.storageState({ path: ssPath });

            const cookieJsonPath = path.join(DATA_DIR, `fb_cookies_${accUsername}.json`);
            fs.writeFileSync(cookieJsonPath, JSON.stringify(fbCookies, null, 2));

            if (hasCUser && hasXs) {
                console.log(`${tag} ✨ GOLDEN SESSION! (${fbCookies.length} cookies) → ${accUsername}`);
            } else {
                console.log(`${tag} ⚠️ Session saved but ${hasCUser ? 'missing xs' : 'WEAK (no c_user)'} → ${accUsername}`);
            }

            await goldenCtx.close();
            return ssPath;
        } catch (warmErr) {
            console.warn(`${tag} ⚠️ Phase 2 error: ${warmErr.message}. Saving Phase 1 cookies...`);
            fs.mkdirSync(SESSIONS_DIR, { recursive: true });
            const ssPath = path.join(SESSIONS_DIR, `${accUsername}_auth.json`);
            await goldenCtx.storageState({ path: ssPath });
            await goldenCtx.close();
            return ssPath;
        }

    } catch (err) {
        console.warn(`${tag} ❌ Self-heal error: ${err.message}`);
        if (noJsCtx) try { await noJsCtx.close(); } catch { }
        return null;
    }
}

module.exports = {
    selfHealLogin,
    isSessionHealthy,
    getTotpSecret,
    getRecoveryCode,
    interactWithNewsfeed,
};
