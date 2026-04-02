/**
 * Orchestrator — Main entry for parallel group scraping
 * Coordinates multi-account scraping with shared browser.
 *
 * [FIX v2.5] RAM Guard
 *   - testPage đóng TRƯỚC khi mở warmPage (không giữ 4 pages cùng lúc)
 *   - Persona sessions chỉ chạy nếu còn đủ RAM (>800MB available)
 *   - MAX_PARALLEL default = 2, có thể override bằng env MAX_PARALLEL
 *   - Node heap capped qua --max-old-space-size trong ecosystem.config.js
 *
 * @module scraper/orchestrator
 */
const { chromium, delay, fs, path, generateFingerprint, extractGroupId } = require('./browserManager');
const accountManager = require('../../../ai/agents/accountManager');
const { bridgeToHub } = require('./hubBridge');
const { runPersonaSession } = require('../../../ai/squad/agents/personaAgent');
const { applyStealthToContext } = require('../proxy/stealthScripts');

// ─── RAM-aware persona guard ──────────────────────────────────────────────────
// Chỉ chạy persona session nếu còn đủ RAM để tránh OOM
function hasEnoughRAMForPersona() {
    try {
        const mem = process.memoryUsage();
        const rssGB = mem.rss / (1024 * 1024 * 1024);
        // Skip persona nếu process đang dùng >600MB (gần giới hạn an toàn)
        if (rssGB > 0.6) {
            console.log('[FBScraper] ⚠️  RAM Guard: Skipping persona session (RSS=' + Math.round(rssGB * 1024) + 'MB)');
            return false;
        }
        return true;
    } catch (e) {
        return true; // Nếu không đọc được, cho chạy bình thường
    }
}

/**
 * Single-browser Facebook scraper with batched contexts.
 * 1 Chromium + max 2 contexts at a time.
 */
async function scrapeFacebookGroups(maxPosts, options, externalGroups) {
    maxPosts = maxPosts || 20;
    options = options || {};
    externalGroups = externalGroups || null;

    const cfg = require('../../config');
    const groups = (externalGroups && externalGroups.length > 0)
        ? externalGroups
        : (cfg.FB_TARGET_GROUPS || []);

    if (groups.length === 0) {
        console.log('[FBScraper] ⚠️ No target groups configured');
        return [];
    }

    const allAccounts = accountManager.getActiveAccounts
        ? accountManager.getActiveAccounts({ forScraping: true })
        : [accountManager.getNextAccount(Object.assign({}, options, { forScraping: true }))].filter(Boolean);

    if (allAccounts.length === 0) {
        console.log('[FBScraper] ❌ No accounts available');
        return [];
    }

    // [FIX] Respect maxConcurrentAccounts from caller (scraperEngine RAM guard)
    const MAX_PARALLEL = options.maxConcurrentAccounts
        || parseInt(process.env.MAX_PARALLEL || '2', 10);

    // Split groups round-robin
    var accountGroupMap = {};
    for (var ai = 0; ai < allAccounts.length; ai++) {
        var acc = allAccounts[ai];
        accountGroupMap[acc.email] = { account: acc, groups: [] };
    }
    groups.forEach(function (group, i) {
        var acc2 = allAccounts[i % allAccounts.length];
        accountGroupMap[acc2.email].groups.push(group);
    });

    console.log('[FBScraper] 🚀 Scraping ' + groups.length + ' groups across ' + allAccounts.length + ' accounts (MAX_PARALLEL=' + MAX_PARALLEL + ')');
    for (var key in accountGroupMap) {
        var entry = accountGroupMap[key];
        console.log('[FBScraper]   📧 ' + entry.account.email + ': ' + entry.groups.length + ' groups');
    }

    var browser = null;
    var allPosts = [];

    try {
        browser = await chromium.launch({
            headless: true,
            executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
            args: [
                '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
                '--disable-blink-features=AutomationControlled', '--disable-extensions',
                '--disable-component-update', '--no-first-run',
                '--js-flags=--max-old-space-size=400',
            ],
        });
        console.log('[FBScraper] 🌐 Browser launched');

        var entries = Object.values(accountGroupMap);
        for (var i = 0; i < entries.length; i += MAX_PARALLEL) {
            var batch = entries.slice(i, i + MAX_PARALLEL);
            console.log('[FBScraper] 🔄 Batch ' + (Math.floor(i / MAX_PARALLEL) + 1) + ': ' +
                batch.map(function (b) { return b.account.email.split('@')[0]; }).join(' + '));
            var tasks = batch.map(function (item) {
                return _scrapeWithContext(browser, item.account, item.groups);
            });
            var results = await Promise.allSettled(tasks);
            for (var ri = 0; ri < results.length; ri++) {
                var r = results[ri];
                if (r.status === 'fulfilled' && Array.isArray(r.value)) {
                    allPosts.push.apply(allPosts, r.value);
                }
            }
            // Brief pause between batches to let browser GC
            if (i + MAX_PARALLEL < entries.length) {
                console.log('[FBScraper] ⏸️  Batch cooldown (5s)...');
                await delay(5000);
            }
        }
    } catch (err) {
        console.error('[FBScraper] 💥 Browser launch failed: ' + err.message);
    } finally {
        try { if (browser) await browser.close(); } catch (e) { }
    }

    console.log('[FBScraper] ✅ Done: ' + allPosts.length + ' posts from ' + groups.length + ' groups');
    // if (allPosts.length > 0) await bridgeToHub(allPosts); // Disabled in SIS v2 
    return allPosts;
}

/**
 * Scrape groups for ONE account using a context in the shared browser.
 */
async function _scrapeWithContext(browser, account, groups) {
    var accEmail = account.email;
    var tag = '[' + accEmail.split('@')[0] + ']';
    console.log('\n' + tag + ' ═══ Starting (' + groups.length + ' groups) ═══');

    var fp = generateFingerprint({ region: 'US', accountId: accEmail });
    var context = null;
    var posts = [];

    // UA Sync
    var accUsername = accEmail.split('@')[0];
    var uaPath = path.join(__dirname, '..', '..', '..', 'data', 'ua_' + accUsername + '.txt');
    var syncedUA = fp.userAgent;
    if (fs.existsSync(uaPath)) {
        syncedUA = fs.readFileSync(uaPath, 'utf8').trim();
        console.log(tag + ' 🔑 UA Synced: ' + syncedUA.substring(0, 60) + '...');
    }

    try {
        // ═══ Proxy Injection ═══
        // Priority: 1) account.proxy_url (from DB)  2) env var PROXY_<username>
        var proxyEnvKey = 'PROXY_' + accUsername;
        var proxyUrl = account.proxy_url || process.env[proxyEnvKey] || '';
        var proxyConfig = undefined;

        if (proxyUrl) {
            try {
                var parsed = new URL(proxyUrl);
                proxyConfig = {
                    server: parsed.protocol + '//' + parsed.hostname + ':' + parsed.port,
                    username: decodeURIComponent(parsed.username),
                    password: decodeURIComponent(parsed.password),
                };
                console.log(tag + ' 🌐 Proxy: ' + parsed.hostname + ':' + parsed.port);
            } catch (e) {
                console.warn(tag + ' ⚠️ Invalid proxy URL: ' + e.message);
            }
        } else {
            console.log(tag + ' 🏠 No proxy (using local IP)');
        }

        context = await browser.newContext({
            userAgent: syncedUA,
            viewport: fp.viewport,
            locale: 'en-US',
            timezoneId: 'America/New_York',
            ...(proxyConfig ? { proxy: proxyConfig } : {}),
        });

        // ═══ Stealth Scripts Injection ═══
        try {
            await applyStealthToContext(context, fp);
        } catch (stealthErr) {
            console.warn(tag + ' ⚠️ Stealth injection partial: ' + stealthErr.message);
        }

        // Load cookies
        var cookieJsonPath = path.join(__dirname, '..', '..', '..', 'data', 'fb_cookies_' + accUsername + '.json');
        var sessionDir = path.join(__dirname, '..', '..', '..', 'data', 'fb_sessions');
        var sessionPath = path.join(sessionDir, accEmail.replace(/[@.]/g, '_') + '.json');
        var loaded = false;

        if (fs.existsSync(cookieJsonPath)) {
            try {
                var raw = JSON.parse(fs.readFileSync(cookieJsonPath, 'utf8'));
                var pwc = raw.filter(function (c) { return c.name && c.value && c.domain; }).map(function (c) {
                    return {
                        name: c.name, value: c.value, domain: c.domain, path: c.path || '/',
                        httpOnly: !!c.httpOnly, secure: c.secure !== false,
                        sameSite: c.sameSite === 'no_restriction' ? 'None' : c.sameSite === 'lax' ? 'Lax' : c.sameSite === 'strict' ? 'Strict' : 'None',
                        ...(c.expirationDate ? { expires: c.expirationDate } : {}),
                    };
                });
                await context.addCookies(pwc);
                loaded = true;
                console.log(tag + ' 🍪 Cookies from ' + path.basename(cookieJsonPath) + ' (' + pwc.length + ')');
                try { if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath); } catch (e) { }
            } catch (e) { console.warn(tag + ' ⚠️ Cookie error: ' + e.message); }
        }
        if (!loaded && fs.existsSync(sessionPath)) {
            try {
                var saved = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
                var targetCookies = [];
                if (Array.isArray(saved) && saved[0] && saved[0].cookies) {
                    targetCookies = saved[0].cookies;
                } else if (saved.cookies) {
                    targetCookies = saved.cookies;
                } else if (Array.isArray(saved)) {
                    targetCookies = saved;
                }
                if (targetCookies.length > 0) {
                    await context.addCookies(targetCookies);
                    loaded = true;
                    console.log(tag + ' 📂 Session fallback (' + targetCookies.length + ' cookies)');
                }
            } catch (e) {
                console.warn(tag + ' ⚠️ Session parse error: ' + e.message);
            }
        }
        if (!loaded) {
            var env = process.env.FB_COOKIES || '';
            if (env.includes('c_user=')) {
                var pwc2 = env.split(';').map(function (s) { return s.trim(); }).filter(Boolean).map(function (pair) {
                    var parts = pair.split('=');
                    var n = parts[0];
                    var v = parts.slice(1).join('=');
                    return { name: n.trim(), value: v.trim(), domain: '.facebook.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' };
                });
                await context.addCookies(pwc2);
                console.log(tag + ' 🍪 Cookies from .env (' + pwc2.length + ')');
            }
        }

        // ═══ [FIX] Validate session — testPage đóng TRƯỚC khi warmPage mở ═══
        var testPage = await context.newPage();
        var sessionValid = false;

        for (var attempt = 1; attempt <= 2; attempt++) {
            try {
                if (attempt === 1) {
                    await testPage.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 25000 });
                } else {
                    console.log(tag + ' 🔄 Retry validation (attempt 2)...');
                    await testPage.reload({ waitUntil: 'domcontentloaded', timeout: 25000 });
                }
                var hasNav = await testPage.waitForSelector(
                    'div[role="navigation"], div[aria-label="Facebook"], a[aria-label="Facebook"]',
                    { timeout: 10000 }
                ).catch(function () { return null; });
                var testUrl = testPage.url();
                if (hasNav && !testUrl.includes('/login') && !testUrl.includes('checkpoint')) {
                    sessionValid = true;
                    break;
                }
                if (testUrl.includes('checkpoint')) {
                    console.warn(tag + ' 🚨 Checkpoint detected');
                    accountManager.reportCheckpoint(account.id);
                    break;
                }
                if (testUrl.includes('/login')) {
                    console.warn(tag + ' 🔒 Redirected to login (attempt ' + attempt + ')');
                    if (attempt === 2) accountManager.reportCheckpoint(account.id);
                }
            } catch (e) {
                console.warn(tag + ' ⚠️ Validation attempt ' + attempt + ' error: ' + e.message.substring(0, 60));
            }
            if (attempt < 2) await delay(3000);
        }

        // [FIX KEY] Đóng testPage NGAY sau validate — TRƯỚC khi mở warmPage
        try { await testPage.close(); } catch (e) { }
        testPage = null;

        if (!sessionValid) {
            // Screenshot debug (nhẹ — không mở page mới, dùng context info)
            console.warn(tag + ' ❌ Session invalid after 2 attempts. Please extract cookies manually via Desktop.');
            accountManager.reportCheckpoint(account.id);
            await context.close();
            return [];
        }

        console.log(tag + ' ✅ Session valid!');

        // AUTO-RENEW cookies
        try {
            var freshCookies = await context.cookies();
            fs.mkdirSync(sessionDir, { recursive: true });
            fs.writeFileSync(sessionPath, JSON.stringify(freshCookies, null, 2));
            if (fs.existsSync(cookieJsonPath)) {
                var fbCookies = freshCookies.filter(function (c) { return c.domain && c.domain.includes('facebook'); });
                if (fbCookies.length > 0) {
                    fs.writeFileSync(cookieJsonPath, JSON.stringify(fbCookies, null, 2));
                    console.log(tag + ' 🔄 Cookies auto-renewed (' + fbCookies.length + ')');
                }
            }
            var ssDir = path.join(__dirname, '..', '..', '..', 'data', 'sessions');
            var ssPath = path.join(ssDir, accUsername + '_auth.json');
            fs.mkdirSync(ssDir, { recursive: true });
            await context.storageState({ path: ssPath });
            console.log(tag + ' 🔑 StorageState saved → ' + accUsername + '_auth.json');
        } catch (e) { console.warn(tag + ' ⚠️ Cookie save error: ' + e.message); }

        // 🎭 Persona Warm-up — [FIX] chỉ chạy nếu còn đủ RAM
        if (hasEnoughRAMForPersona()) {
            var warmPage = await context.newPage();
            try {
                console.log(tag + ' 🎭 Warm-up (medium)...');
                await runPersonaSession(warmPage, accUsername, 'medium');
            } catch (e) { console.warn(tag + ' ⚠️ Warm-up error: ' + e.message); }
            finally {
                // [FIX] Đóng warmPage TRƯỚC khi bắt đầu scrape
                try { await warmPage.close(); } catch (e) { }
                await delay(2000 + Math.random() * 3000);
            }
        } else {
            await delay(2000);
        }

        // Scrape each group — mở 1 page duy nhất, tái sử dụng
        var page = await context.newPage();
        page.on('console', function (msg) {
            var text = msg.text();
            if (text.includes('Loại khỏi vòng quét post')) console.log(tag + ' ⏭️ ' + text);
        });

        for (var gi = 0; gi < groups.length; gi++) {
            var group = groups[gi];
            var groupId = extractGroupId(group.url);
            if (!groupId) continue;

            try {
                if (gi > 0) {
                    var jitter = 8000 + Math.random() * 12000;
                    console.log(tag + ' 😴 Jitter: ' + (jitter / 1000).toFixed(1) + 's');
                    await delay(jitter);

                    // [FIX] Break persona — [FIX] đóng breakPage ngay sau dùng
                    if (gi % 5 === 0 && hasEnoughRAMForPersona()) {
                        var breakTime = 15000 + Math.random() * 15000;
                        console.log(tag + ' ☕ Break persona...');
                        try {
                            var breakPage = await context.newPage();
                            await runPersonaSession(breakPage, accUsername, 'light');
                            // [FIX] Đóng ngay trong cùng try block
                            await breakPage.close();
                            breakPage = null;
                        } catch (e) {
                            console.warn(tag + ' ⚠️ Break persona error: ' + e.message);
                        }
                        await delay(breakTime);
                    }
                }

                console.log(tag + ' [' + (gi + 1) + '/' + groups.length + '] 📥 ' + group.name);
                await page.goto(
                    'https://www.facebook.com/groups/' + groupId + '?sorting_setting=CHRONOLOGICAL',
                    { waitUntil: 'domcontentloaded', timeout: 30000 }
                );
                await delay(3000 + Math.random() * 2000);

                var url = page.url();
                if (url.includes('checkpoint')) {
                    console.warn(tag + ' 🚨 ' + group.name + ': checkpoint — stopping account');
                    accountManager.reportCheckpoint(account.id);
                    break;
                }
                if (url.includes('/login')) {
                    console.log(tag + ' 🔒 ' + group.name + ': login redirect — skipping');
                    continue;
                }

                var hasFeed = false;
                try {
                    await page.waitForSelector('div[role="feed"]', { timeout: 12000 });
                    hasFeed = true;
                } catch (e) {
                    var pageText = await page.evaluate(function () { return document.body ? document.body.innerText.substring(0, 500) : ''; });
                    var isJoinPage = pageText.toLowerCase().includes('join group') || pageText.includes('Tham gia nh');
                    if (isJoinPage) {
                        console.log(tag + ' 🚪 ' + group.name + ': NOT A MEMBER — joining...');
                        try {
                            var joinBtn = await page.$('div[role="button"]:has-text("Join"), div[role="button"]:has-text("Tham gia")');
                            if (joinBtn) {
                                await joinBtn.click();
                                await delay(3000);
                                var afterText = await page.evaluate(function () { return document.body ? document.body.innerText.substring(0, 300) : ''; });
                                if (afterText.includes('Pending') || afterText.includes('pending') || afterText.includes('Chờ')) {
                                    console.log(tag + ' ⏳ ' + group.name + ': pending approval');
                                    continue;
                                }
                                await page.goto('https://www.facebook.com/groups/' + groupId + '?sorting_setting=CHRONOLOGICAL', { waitUntil: 'domcontentloaded', timeout: 25000 });
                                await delay(3000);
                                try { await page.waitForSelector('div[role="feed"]', { timeout: 8000 }); hasFeed = true; } catch (e2) { }
                            }
                        } catch (joinErr) { console.warn(tag + ' ⚠️ Join failed: ' + joinErr.message.substring(0, 50)); }
                    } else {
                        console.log(tag + ' ⚠️ ' + group.name + ': no feed visible');
                    }
                }
                if (!hasFeed) continue;

                // Dynamic scrolling
                var MAX_AGE_DAYS = 3;
                var noGrowth = 0, prevCnt = 0;
                for (var s = 0; s < 35; s++) {
                    try {
                        var clicked = await page.evaluate(function () {
                            var count = 0;
                            var els = Array.from(document.querySelectorAll('div[role="button"], span'));
                            for (var i2 = 0; i2 < els.length; i2++) {
                                var t = els[i2].innerText && els[i2].innerText.trim().toLowerCase();
                                if (t === 'see more' || t === 'xem thêm') {
                                    try { els[i2].click(); count++; } catch (e3) { }
                                }
                            }
                            return count;
                        });
                        if (clicked > 0) await delay(500);
                    } catch (e) { }

                    await page.evaluate(function () { window.scrollBy(0, 1000 + Math.random() * 500); });
                    await delay(1200 + Math.random() * 800);

                    var scrollStatus = await page.evaluate(function (maxDays) {
                        var feed = document.querySelector('div[role="feed"]');
                        if (!feed) return { cnt: 0, stopEarly: false, timeLog: '' };
                        var articles = feed.querySelectorAll(':scope > div');
                        var cnt = 0, lastValidTime = '';
                        for (var ii = articles.length - 1; ii >= 0; ii--) {
                            var a = articles[ii];
                            if (a.innerText && a.innerText.length > 50) {
                                cnt++;
                                if (!lastValidTime) {
                                    var abbr = a.querySelector('abbr');
                                    if (abbr) lastValidTime = abbr.textContent && abbr.textContent.trim() || abbr.getAttribute('title') || '';
                                    if (!lastValidTime) {
                                        var spans = a.querySelectorAll('span');
                                        for (var si = 0; si < spans.length; si++) {
                                            var t2 = spans[si].textContent && spans[si].textContent.trim();
                                            if (t2 && t2.match(/^\d+[mhdw]$|^just now$|^yesterday$|^hôm qua$|^\d+\s*(phút|giờ|ngày|tuần|năm|tháng)/i)) {
                                                lastValidTime = t2; break;
                                            }
                                        }
                                    }
                                }
                            }
                        }
                        var stopEarly = false;
                        if (lastValidTime) {
                            var sv = lastValidTime.toLowerCase();
                            if (sv.match(/w\b|wk|week|tuần|tháng|month|năm|year/)) stopEarly = true;
                            if (sv.match(/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i)) stopEarly = true;
                            if (sv.match(/\b(20[12]\d)\b/)) stopEarly = true;
                            var dayMatch = sv.match(/(\d+)\s*(d\b|day|ngày)/);
                            if (dayMatch && parseInt(dayMatch[1]) > maxDays) stopEarly = true;
                        }
                        return { cnt: cnt, stopEarly: stopEarly, timeLog: lastValidTime };
                    }, MAX_AGE_DAYS);

                    if (scrollStatus.cnt >= 40) { console.log(tag + ' 🎯 ' + group.name + ': Đạt 40 bài.'); break; }
                    if (scrollStatus.stopEarly) { console.log(tag + ' 🛑 ' + group.name + ': Bài cũ [' + scrollStatus.timeLog + ']. Cắt sớm!'); break; }
                    if (scrollStatus.cnt === prevCnt) {
                        noGrowth++;
                        if (noGrowth >= 3) { console.log(tag + ' 🔚 ' + group.name + ': Kịch đáy.'); break; }
                    } else { noGrowth = 0; }
                    prevCnt = scrollStatus.cnt;
                }

                // Final "See More" sweep
                try {
                    await page.evaluate(function () {
                        var els = Array.from(document.querySelectorAll('div[role="button"], span'));
                        for (var i3 = 0; i3 < els.length; i3++) {
                            var t3 = els[i3].innerText && els[i3].innerText.trim().toLowerCase();
                            if (t3 === 'see more' || t3 === 'xem thêm') {
                                try { els[i3].click(); } catch (e4) { }
                            }
                        }
                    });
                    await delay(500);
                } catch (e) { }

                // Extract posts
                var gPosts = await page.evaluate(function (params) {
                    var gName = params.gName, gUrl = params.gUrl, maxAgeDays = params.maxAgeDays;

                    function parseRelativeTime(timeStr) {
                        if (!timeStr) return null;
                        var s = timeStr.trim().toLowerCase();
                        if (s.includes('just now') || s.includes('vừa xong') || s === 'now') return 0;
                        var m;
                        m = s.match(/(\d+)\s*(m\b|min|mins|minute|minutes|phút)/);
                        if (m) return parseInt(m[1]) / 60;
                        m = s.match(/(\d+)\s*(h\b|hr|hrs|hour|hours|giờ)/);
                        if (m) return parseInt(m[1]);
                        m = s.match(/(\d+)\s*(d\b|day|days|ngày)/);
                        if (m) return parseInt(m[1]) * 24;
                        m = s.match(/(\d+)\s*(w\b|wk|wks|week|weeks|tuần)/);
                        if (m) return parseInt(m[1]) * 24 * 7;
                        m = s.match(/(\d+)\s*(tháng|month|months|mo\b)/);
                        if (m) return parseInt(m[1]) * 24 * 30;
                        m = s.match(/(\d+)\s*(năm|year|years|yr|yrs)/);
                        if (m) return parseInt(m[1]) * 24 * 365;
                        if (s.includes('yesterday') || s.includes('hôm qua')) return 24;
                        return null;
                    }

                    var feed = document.querySelector('div[role="feed"]');
                    if (!feed) return [];
                    var articles = feed.querySelectorAll(':scope > div');
                    var res = [];
                    var seenUrls = new Set();
                    var now = Date.now();

                    articles.forEach(function (a) {
                        var txt = a.innerText || '';
                        if (txt.length < 50) return;
                        var links = Array.from(a.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]'));
                        var rawUrl = links[0] ? links[0].href : '';
                        var postUrl = rawUrl.split('?')[0];
                        if (postUrl && seenUrls.has(postUrl)) return;
                        if (postUrl) seenUrls.add(postUrl);

                        var timeStr = '';
                        for (var li = 0; li < links.length; li++) {
                            var lt = links[li].innerText && links[li].innerText.trim();
                            if (lt && lt.match(/^\d+[mhdw]$|^just now$|^yesterday$/i)) { timeStr = lt; break; }
                        }
                        if (!timeStr) { var ab = a.querySelector('abbr'); if (ab) timeStr = ab.textContent && ab.textContent.trim() || ab.getAttribute('title') || ''; }

                        var ageHours = parseRelativeTime(timeStr);
                        var ageDays = ageHours !== null ? ageHours / 24 : null;
                        if (ageDays !== null && ageDays > maxAgeDays) return;

                        var author = '', authorUrl = '';
                        var hl2 = a.querySelectorAll('a[href*="/user/"], a[href*="profile.php"], a[href*="facebook.com/"][role="link"]');
                        for (var hli = 0; hli < hl2.length; hli++) {
                            var name2 = hl2[hli].innerText && hl2[hli].innerText.trim();
                            if (name2 && name2.length > 1 && name2.length < 60 && !name2.match(/^\d+[mhdw]$/)) {
                                author = name2; authorUrl = hl2[hli].href.split('?')[0]; break;
                            }
                        }

                        res.push({
                            platform: 'facebook',
                            group_name: gName, group_url: gUrl, post_url: postUrl,
                            author_name: author || 'Unknown', author_url: authorUrl,
                            content: txt.substring(0, 2000),
                            post_created_at: ageHours !== null ? new Date(now - ageHours * 3600 * 1000).toISOString() : '',
                            scraped_at: new Date().toISOString(), source_group: gName, item_type: 'post'
                        });
                    });
                    return res;
                }, { gName: group.name, gUrl: group.url, maxAgeDays: MAX_AGE_DAYS });

                posts.push.apply(posts, gPosts);
                console.log(tag + ' ✅ ' + group.name + ': ' + gPosts.length + ' posts');
                accountManager.reportSuccess(account.id, gPosts.length);

            } catch (err) {
                console.warn(tag + ' ❌ ' + group.name + ': ' + err.message.substring(0, 80));
            }

            if (gi < groups.length - 1) await delay(5000 + Math.random() * 5000);

            // RAM log every 5 groups
            if (gi > 0 && gi % 5 === 0) {
                var m2 = process.memoryUsage();
                console.log(tag + ' 💾 RSS=' + Math.round(m2.rss / 1024 / 1024) + 'MB');
            }
        }

        // [FIX] Đóng scraping page trước cool-down
        try { await page.close(); } catch (e) { }
        page = null;

        // 🎭 Cool-down persona — [FIX] chỉ chạy nếu còn RAM
        if (hasEnoughRAMForPersona()) {
            var coolPage = await context.newPage();
            try {
                console.log(tag + ' 🎭 Cool-down...');
                await runPersonaSession(coolPage, accUsername, 'medium');
            } catch (e) { console.warn(tag + ' ⚠️ Cool-down error: ' + e.message); }
            finally { try { await coolPage.close(); } catch (e) { } }
        }

    } catch (err) {
        console.error(tag + ' 💥 Fatal: ' + err.message);
    } finally {
        try { if (context) await context.close(); } catch (e) { }
        console.log(tag + ' 🏁 Done: ' + posts.length + ' posts');
    }
    return posts;
}

module.exports = { scrapeFacebookGroups };
