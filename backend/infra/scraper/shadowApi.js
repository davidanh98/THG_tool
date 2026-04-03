/**
 * Shadow API Client — Facebook GraphQL Scraper
 * 
 * Replaces Playwright browser-based scraping with direct HTTP requests
 * to Facebook's internal GraphQL API, mimicking mobile app behavior.
 * 
 * Benefits:
 * - ~5MB RAM vs ~400MB for Playwright browser
 * - 1-2s per group vs 30-60s with Playwright
 * - Much harder for Facebook to detect (looks like mobile app)
 * - No Chromium dependency
 * 
 * Requires: Valid Facebook cookies (c_user, xs, datr, fr)
 * 
 * @module scraper/shadowApi
 */

'use strict';

const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const accountManager = require('../../../ai/agents/accountManager');

// ─── Constants ──────────────────────────────────────────────────────────────────
const FB_GRAPHQL_URL = 'https://www.facebook.com/api/graphql/';

// Known doc_ids for Facebook GraphQL queries (may need periodic updates)
// These are reverse-engineered from Facebook's web client
const DOC_IDS = {
    // GroupsCometFeedRegularStoriesPaginationQuery — feeds group posts
    GROUP_FEED: '9452786491414987',
    // GroupsCometMembersQuery — list group members
    GROUP_MEMBERS: '6098256330226498',
    // CometFeedStoryQuery — single post detail
    STORY_DETAIL: '8024818524207448',
};

// Mobile User-Agents for stealth
const MOBILE_UAS = [
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro Build/AP31.240517.005) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.39 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; SM-S928B Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.6834.79 Mobile Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
];

// ─── Token Extraction ───────────────────────────────────────────────────────────

/**
 * Extract fb_dtsg and lsd tokens from Facebook homepage
 * These tokens are required for GraphQL API calls
 * @param {string} cookieString - Facebook cookies
 * @param {string} proxyUrl - Optional proxy
 * @returns {{ fb_dtsg: string, lsd: string, jazoest: string }}
 */
async function extractTokens(cookieString, proxyUrl = '') {
    const ua = MOBILE_UAS[Math.floor(Math.random() * MOBILE_UAS.length)];
    const config = {
        headers: {
            'Cookie': cookieString,
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
        },
        timeout: 20000,
        maxRedirects: 5,
    };

    if (proxyUrl) {
        try {
            config.httpsAgent = new HttpsProxyAgent(proxyUrl);
        } catch (e) {
            console.warn('[ShadowAPI] ⚠️ Proxy config failed:', e.message);
        }
    }

    try {
        const res = await axios.get('https://www.facebook.com/', config);
        const html = res.data;

        // Extract fb_dtsg
        const dtsgMatch = html.match(/"DTSGInitialData".*?"token":"([^"]+)"/);
        const dtsg = dtsgMatch ? dtsgMatch[1] : '';

        // Extract lsd 
        const lsdMatch = html.match(/"LSD".*?"token":"([^"]+)"/);
        const lsd = lsdMatch ? lsdMatch[1] : '';

        // Extract jazoest
        const jazoestMatch = html.match(/jazoest=(\d+)/);
        const jazoest = jazoestMatch ? jazoestMatch[1] : '';

        // Check for checkpoint
        if (html.includes('checkpoint') || html.includes('/login')) {
            return { fb_dtsg: '', lsd: '', jazoest: '', checkpoint: true };
        }

        if (!dtsg) {
            console.warn('[ShadowAPI] ⚠️ Could not extract fb_dtsg — session may be invalid');
            return { fb_dtsg: '', lsd: '', jazoest: '', checkpoint: false };
        }

        console.log(`[ShadowAPI] 🔑 Tokens extracted (dtsg: ${dtsg.substring(0, 8)}..., lsd: ${lsd.substring(0, 6)}...)`);
        return { fb_dtsg: dtsg, lsd, jazoest, checkpoint: false };
    } catch (e) {
        console.error('[ShadowAPI] ❌ Token extraction failed:', e.message);
        return { fb_dtsg: '', lsd: '', jazoest: '', checkpoint: false };
    }
}

// ─── GraphQL Client ─────────────────────────────────────────────────────────────

/**
 * Make a GraphQL request to Facebook's API
 * @param {object} params
 * @param {string} params.cookieString - Facebook cookies
 * @param {string} params.fb_dtsg - DTSG token
 * @param {string} params.lsd - LSD token
 * @param {string} params.docId - GraphQL doc_id
 * @param {object} params.variables - Query variables
 * @param {string} params.proxyUrl - Optional proxy
 * @returns {object} GraphQL response
 */
async function graphqlRequest({ cookieString, fb_dtsg, lsd, docId, variables, proxyUrl = '' }) {
    const ua = MOBILE_UAS[Math.floor(Math.random() * MOBILE_UAS.length)];

    const payload = new URLSearchParams({
        'fb_dtsg': fb_dtsg,
        'lsd': lsd,
        'doc_id': docId,
        'variables': JSON.stringify(variables),
        'fb_api_caller_class': 'RelayModern',
        'fb_api_req_friendly_name': 'GroupsCometFeedRegularStoriesPaginationQuery',
        'server_timestamps': 'true',
    });

    const config = {
        headers: {
            'Cookie': cookieString,
            'User-Agent': ua,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'Sec-Fetch-Dest': 'empty',
            'Sec-Fetch-Mode': 'cors',
            'Sec-Fetch-Site': 'same-origin',
            'X-FB-Friendly-Name': 'GroupsCometFeedRegularStoriesPaginationQuery',
            'X-FB-LSD': lsd,
            'Origin': 'https://www.facebook.com',
            'Referer': 'https://www.facebook.com/',
        },
        timeout: 30000,
    };

    if (proxyUrl) {
        try {
            config.httpsAgent = new HttpsProxyAgent(proxyUrl);
        } catch (e) { }
    }

    const res = await axios.post(FB_GRAPHQL_URL, payload.toString(), config);
    return res.data;
}

// ─── Group Feed Scraper ─────────────────────────────────────────────────────────

/**
 * Scrape posts from a Facebook group via Shadow API
 * @param {object} account - Account from DB (email, proxy_url, etc.)
 * @param {string} groupId - Facebook group ID
 * @param {object} tokens - { fb_dtsg, lsd } pre-extracted tokens
 * @param {object} options - { maxPosts, maxAgeDays }
 * @returns {object[]} Array of post objects
 */
async function scrapeGroupFeed(account, groupId, tokens, options = {}) {
    const maxPosts = options.maxPosts || 20;
    const maxAgeDays = options.maxAgeDays || 3;
    const tag = `[Shadow:${account.email.split('@')[0]}]`;

    // Build cookie string from account
    const cookieString = await getAccountCookies(account);
    if (!cookieString) {
        console.warn(`${tag} ❌ No cookies for account`);
        return [];
    }

    const posts = [];
    let cursor = null;
    let page = 0;

    while (posts.length < maxPosts && page < 5) {
        try {
            const variables = {
                groupID: groupId,
                count: 10,
                cursor: cursor,
                feedLocation: 'GROUP',
                focusCommentID: null,
                scale: 1,
                sortingSetting: 'CHRONOLOGICAL',
                stream_initial_count: 10,
                useDefaultActor: false,
                __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false,
                __relay_internal__pv__IsWorkUserrelayprovider: false,
                __relay_internal__pv__IsMergQAPollsrelayprovider: false,
            };

            const data = await graphqlRequest({
                cookieString,
                fb_dtsg: tokens.fb_dtsg,
                lsd: tokens.lsd,
                docId: DOC_IDS.GROUP_FEED,
                variables,
                proxyUrl: account.proxy_url || '',
            });

            // Parse response — Facebook returns multi-line JSON
            const parsed = parseGroupFeedResponse(data, groupId, maxAgeDays);
            if (!parsed || parsed.posts.length === 0) {
                console.log(`${tag} 📭 No more posts from group ${groupId}`);
                break;
            }

            posts.push(...parsed.posts);
            cursor = parsed.nextCursor;
            page++;

            if (!cursor) break;

            // Micro jitter between pages
            const jitter = 1000 + Math.random() * 2000;
            await new Promise(r => setTimeout(r, jitter));

        } catch (e) {
            if (e.response && (e.response.status === 401 || e.response.status === 403)) {
                console.warn(`${tag} 🚨 Auth failed for group ${groupId} — checkpoint likely`);
                accountManager.reportCheckpoint(account.id || account.email);
                return posts;
            }
            console.warn(`${tag} ⚠️ Request error for group ${groupId}: ${e.message}`);
            break;
        }
    }

    if (posts.length > 0) {
        accountManager.reportSuccess(account.id || account.email, posts.length);
    }

    console.log(`${tag} ✅ Group ${groupId}: ${posts.length} posts via Shadow API`);
    return posts;
}

// ─── Response Parser ────────────────────────────────────────────────────────────

/**
 * Parse Facebook's GraphQL response into normalized post objects
 * Facebook returns multi-line JSON (each line is a separate JSON object)
 */
function parseGroupFeedResponse(rawData, groupId, maxAgeDays = 3) {
    const posts = [];
    let nextCursor = null;

    try {
        // Response may be string (multi-line JSON) or object
        const lines = typeof rawData === 'string'
            ? rawData.split('\n').filter(l => l.trim())
            : [rawData];

        for (const line of lines) {
            let json;
            try {
                json = typeof line === 'string' ? JSON.parse(line) : line;
            } catch { continue; }

            // Navigate deep into Facebook's nested response structure
            const edges = deepGet(json, 'data.node.group_feed.edges')
                || deepGet(json, 'data.group.group_feed.edges')
                || [];

            for (const edge of edges) {
                const node = edge?.node;
                if (!node) continue;

                // Extract cursor for pagination
                if (edge.cursor) nextCursor = edge.cursor;

                // Extract post data
                const story = node.comet_sections?.content?.story
                    || node.story || node;

                const text = extractStoryText(story);
                if (!text || text.length < 50) continue;

                // Extract timestamp
                const timestamp = story?.creation_time
                    || node?.creation_time
                    || deepGet(story, 'comet_sections.context_layout.story.comet_sections.metadata.0.story.creation_time');

                // Filter by age
                if (timestamp) {
                    const ageMs = Date.now() - (timestamp * 1000);
                    const ageDays = ageMs / (1000 * 60 * 60 * 24);
                    if (ageDays > maxAgeDays) continue;
                }

                // Extract author
                const author = story?.actors?.[0]
                    || deepGet(story, 'comet_sections.context_layout.story.comet_sections.actor_photo.story.actors.0');
                const authorName = author?.name || 'Unknown';
                const authorUrl = author?.url || author?.profile_url || '';

                // Extract post URL
                const postUrl = story?.url
                    || deepGet(story, 'wwwURL')
                    || `https://www.facebook.com/groups/${groupId}`;

                posts.push({
                    platform: 'facebook',
                    group_name: `Group ${groupId}`,
                    group_url: `https://www.facebook.com/groups/${groupId}`,
                    post_url: postUrl,
                    author_name: authorName,
                    author_profile_url: authorUrl,
                    content: text.substring(0, 2000),
                    post_created_at: timestamp ? new Date(timestamp * 1000).toISOString() : '',
                    scraped_at: new Date().toISOString(),
                    source_group: `Group ${groupId}`,
                    item_type: 'post',
                    scrape_method: 'shadow_api',
                });
            }
        }
    } catch (e) {
        console.warn(`[ShadowAPI] ⚠️ Parse error: ${e.message}`);
    }

    return { posts, nextCursor };
}

/**
 * Extract text content from a Facebook story object
 */
function extractStoryText(story) {
    if (!story) return '';

    // Try multiple paths where text content lives
    const paths = [
        'message.text',
        'comet_sections.content.story.message.text',
        'comet_sections.content.story.comet_sections.message_container.story.message.text',
        'comet_sections.message.story.message.text',
        'attachments.0.styles.attachment.all_subattachments.nodes.0.description.text',
    ];

    for (const p of paths) {
        const val = deepGet(story, p);
        if (val && typeof val === 'string' && val.length > 10) return val;
    }

    // Fallback: concatenate all text-like properties
    return JSON.stringify(story).replace(/"[^"]*":/g, ' ').substring(0, 2000);
}

/**
 * Safely access deeply nested object properties
 */
function deepGet(obj, path) {
    return path.split('.').reduce((o, k) => {
        if (o === null || o === undefined) return undefined;
        if (Array.isArray(o) && !isNaN(k)) return o[parseInt(k)];
        return o[k];
    }, obj);
}

// ─── Cookie Management ──────────────────────────────────────────────────────────

/**
 * Get cookie string for an account
 * Tries: 1) Raw cookie file  2) Session file  3) scraper_accounts.json cookieStr
 */
async function getAccountCookies(account) {
    const fs = require('fs');
    const path = require('path');
    const accName = account.email.split('@')[0];
    const dataDir = path.join(__dirname, '..', '..', '..', 'data');

    // 1. Raw cookie text file
    const rawPath = path.join(dataDir, `fb_cookies_raw_${accName}.txt`);
    if (fs.existsSync(rawPath)) {
        return fs.readFileSync(rawPath, 'utf8').trim();
    }

    // 2. JSON cookie file → convert to string
    const jsonPath = path.join(dataDir, `fb_cookies_${accName}.json`);
    if (fs.existsSync(jsonPath)) {
        try {
            const cookies = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            return cookies
                .filter(c => c.name && c.value)
                .map(c => `${c.name}=${c.value}`)
                .join('; ');
        } catch { }
    }

    // 3. Session file → convert to string
    const sessionPath = path.join(dataDir, 'fb_sessions', `${account.email.replace(/[@.]/g, '_')}.json`);
    if (fs.existsSync(sessionPath)) {
        try {
            const saved = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
            const cookies = Array.isArray(saved) && saved[0]?.cookies
                ? saved[0].cookies
                : (saved.cookies || saved);
            if (Array.isArray(cookies)) {
                return cookies
                    .filter(c => c.name && c.value && c.domain?.includes('facebook'))
                    .map(c => `${c.name}=${c.value}`)
                    .join('; ');
            }
        } catch { }
    }

    // 4. Inline cookieStr from scraper_accounts.json
    try {
        const scrapersPath = path.join(__dirname, '..', '..', 'config', 'scraper_accounts.json');
        if (fs.existsSync(scrapersPath)) {
            const scrapers = JSON.parse(fs.readFileSync(scrapersPath, 'utf8'));
            const match = scrapers.find(s => s.email === account.email);
            if (match?.cookieStr) return match.cookieStr;
        }
    } catch { }

    return '';
}

// ─── Orchestration ──────────────────────────────────────────────────────────────

/**
 * High-level: Scrape multiple groups using Shadow API
 * Drop-in replacement for Playwright orchestrator
 * 
 * @param {object[]} groups - Array of { url, name } group objects
 * @param {object} options - { maxPosts, maxAgeDays, maxConcurrentAccounts }
 * @returns {object[]} Array of all scraped posts
 */
async function shadowScrapeGroups(groups, options = {}) {
    const maxPosts = options.maxPosts || 20;
    const allAccounts = accountManager.getActiveAccounts
        ? accountManager.getActiveAccounts({ forScraping: true })
        : [accountManager.getNextAccount({ forScraping: true })].filter(Boolean);

    if (allAccounts.length === 0) {
        console.log('[ShadowAPI] ❌ No active accounts for Shadow API');
        return [];
    }

    console.log(`[ShadowAPI] 🚀 Shadow scraping ${groups.length} groups with ${allAccounts.length} accounts`);

    // Extract tokens for each account
    const accountTokens = new Map();
    for (const acc of allAccounts) {
        const cookies = await getAccountCookies(acc);
        if (!cookies) {
            console.warn(`[ShadowAPI] ⚠️ No cookies for ${acc.email} — skipping`);
            continue;
        }
        const tokens = await extractTokens(cookies, acc.proxy_url || '');
        if (tokens.checkpoint) {
            console.warn(`[ShadowAPI] 🚨 ${acc.email} checkpointed`);
            accountManager.reportCheckpoint(acc.id || acc.email);
            continue;
        }
        if (!tokens.fb_dtsg) {
            console.warn(`[ShadowAPI] ⚠️ ${acc.email} — no fb_dtsg, session invalid`);
            continue;
        }
        accountTokens.set(acc.email, { account: acc, tokens, cookies });
    }

    if (accountTokens.size === 0) {
        console.log('[ShadowAPI] ❌ No accounts with valid tokens — falling back');
        return null; // Signal to caller to use Playwright fallback
    }

    // Round-robin groups across accounts
    const allPosts = [];
    const accountList = [...accountTokens.values()];
    const extractGroupId = (url) => {
        const m = url.match(/groups\/([^/?]+)/);
        return m ? m[1] : null;
    };

    for (let i = 0; i < groups.length; i++) {
        const group = groups[i];
        const gid = extractGroupId(group.url);
        if (!gid) continue;

        const { account, tokens } = accountList[i % accountList.length];
        const tag = `[Shadow:${account.email.split('@')[0]}]`;

        try {
            console.log(`${tag} [${i + 1}/${groups.length}] 📥 ${group.name}`);
            const posts = await scrapeGroupFeed(account, gid, tokens, {
                maxPosts: Math.ceil(maxPosts / groups.length) + 5,
                maxAgeDays: 3,
            });

            // Tag group name
            for (const p of posts) {
                p.group_name = group.name;
                p.group_url = group.url;
                p.source_group = group.name;
            }

            allPosts.push(...posts);

            // Macro jitter between groups
            if (i < groups.length - 1) {
                const jitter = 3000 + Math.random() * 7000;
                await new Promise(r => setTimeout(r, jitter));
            }
        } catch (e) {
            console.warn(`${tag} ❌ ${group.name}: ${e.message}`);
        }
    }

    console.log(`[ShadowAPI] ✅ Done: ${allPosts.length} posts from ${groups.length} groups`);
    return allPosts;
}

module.exports = {
    extractTokens,
    graphqlRequest,
    scrapeGroupFeed,
    shadowScrapeGroups,
    getAccountCookies,
    DOC_IDS,
};
