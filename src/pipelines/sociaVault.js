/**
 * SociaVault API Scraper v3
 * 
 * Strategy:
 * - Facebook: Groups (buyer posts) + Competitor Pages (comment mining)
 * - TikTok: Keyword search (preferred) → Account fallback
 * - Instagram: Hashtag search (preferred) → Account fallback
 * 
 * SociaVault docs: profile-based API
 * Keyword/hashtag search will be tried first for future-proofing
 */

const axios = require('axios');
const config = require('../config');

const SV_API = 'https://api.sociavault.com/v1/scrape';
const SV_KEY = process.env.SOCIAVAULT_API_KEY || config.SOCIAVAULT_API_KEY || '';

function headers() {
    return { 'X-API-Key': SV_KEY };
}

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// 404 health tracking — warn after 3 consecutive failures
const accountHealth = {};
function track404(handle, is404) {
    if (!accountHealth[handle]) accountHealth[handle] = { fails: 0, lastOk: null };
    if (is404) {
        accountHealth[handle].fails++;
        if (accountHealth[handle].fails >= 3) {
            console.warn(`[SV] ⚠️ @${handle} has failed ${accountHealth[handle].fails}x — consider removing or updating this account`);
        }
    } else {
        accountHealth[handle].fails = 0;
        accountHealth[handle].lastOk = new Date().toISOString();
    }
}

/**
 * Generic SociaVault GET request
 */
async function svRequest(endpoint, params = {}) {
    if (!SV_KEY) throw new Error('SOCIAVAULT_API_KEY not set');

    const resp = await axios.get(`${SV_API}/${endpoint}`, {
        headers: headers(),
        params,
        timeout: 60000,
    });

    if (!resp.data?.success) {
        throw new Error(resp.data?.error || `SociaVault ${endpoint} failed`);
    }

    return resp.data?.data || resp.data;
}

// ═══════════════════════════════════════════════════════
// FACEBOOK — Group Posts
// ═══════════════════════════════════════════════════════

async function scrapeFacebookGroups(maxPosts = 30) {
    const groups = config.FB_TARGET_GROUPS || [];
    if (groups.length === 0) { console.log('[SV:FB] ⚠️ No groups configured'); return []; }
    if (!SV_KEY) { console.warn('[SV:FB] ⚠️ No API key'); return []; }

    console.log(`[SV:FB] 📘 Scraping ${groups.length} Facebook groups...`);
    const allPosts = [];

    for (const group of groups) {
        try {
            console.log(`[SV:FB] 📌 ${group.name}...`);
            const data = await svRequest('facebook/group/posts', {
                url: group.url,
                sort_by: 'RECENT_ACTIVITY',
            });

            const postsObj = data.posts || {};
            const postsArr = typeof postsObj === 'object' && !Array.isArray(postsObj)
                ? Object.values(postsObj)
                : (Array.isArray(postsObj) ? postsObj : []);

            const posts = postsArr.map(item => ({
                platform: 'facebook',
                post_url: item.url || '',
                author_name: item.author?.name || item.author?.short_name || 'Unknown',
                author_url: item.author?.id ? `https://www.facebook.com/${item.author.id}` : '',
                content: item.text || item.message || '',
                post_created_at: item.publishTime
                    ? new Date(item.publishTime * 1000).toISOString()
                    : new Date().toISOString(),
                scraped_at: new Date().toISOString(),
                source: `sv:fb:${group.name}`,
                likes: item.reactionCount || 0,
                comments: item.commentCount || 0,
            })).filter(p => p.content && p.content.length > 15);

            allPosts.push(...posts);
            console.log(`[SV:FB] ✅ ${posts.length} posts from ${group.name}`);
            await delay(2000);
        } catch (err) {
            console.warn(`[SV:FB] ⚠️ ${group.name}: ${err.message}`);
        }
    }

    const result = allPosts.slice(0, maxPosts);
    console.log(`[SV:FB] 📊 Total: ${result.length} posts`);
    return result;
}

// ═══════════════════════════════════════════════════════
// INSTAGRAM — Hashtag Search + Account Fallback
// ═══════════════════════════════════════════════════════

function parseIGPost(node, source) {
    const rawCap = node.caption;
    const content = (typeof rawCap === 'string' ? rawCap : rawCap?.text)
        || node.text || node.description
        || (node.edge_media_to_caption?.edges?.[0]?.node?.text) || '';
    const contentStr = String(content);
    return {
        platform: 'instagram',
        post_url: (node.code || node.shortcode)
            ? `https://www.instagram.com/p/${node.code || node.shortcode}/`
            : (node.url || node.link || ''),
        author_name: node.user?.username || source,
        author_url: `https://www.instagram.com/${node.user?.username || source}/`,
        content: contentStr.includes('[object') ? '' : contentStr,
        post_created_at: (node.taken_at || node.taken_at_timestamp)
            ? new Date((node.taken_at || node.taken_at_timestamp) * 1000).toISOString()
            : (node.date || node.timestamp || new Date().toISOString()),
        scraped_at: new Date().toISOString(),
        source: `sv:ig:${source}`,
        likes: node.like_count || node.edge_liked_by?.count || node.likes || 0,
        comments: node.comment_count || node.edge_media_to_comment?.count || node.comments || 0,
    };
}

async function scrapeInstagram(maxPosts = 30) {
    if (!SV_KEY) { console.warn('[SV:IG] ⚠️ No API key'); return []; }
    const allPosts = [];
    let hashtagSupported = true;

    // --- Strategy 1: Hashtag search ---
    const hashtags = config.IG_SEARCH_HASHTAGS || [];
    if (hashtags.length > 0) {
        console.log(`[SV:IG] 📷 Trying hashtag search (${hashtags.length} tags)...`);
        for (const tag of hashtags.slice(0, 5)) {
            if (!hashtagSupported) break;
            try {
                const resp = await axios.get(`${SV_API}/instagram/hashtag`, {
                    headers: headers(),
                    params: { hashtag: tag },
                    timeout: 15000,
                });
                if (resp.data?.success && resp.data?.data) {
                    const raw = resp.data.data.posts || resp.data.data.items || resp.data.data;
                    const items = Array.isArray(raw) ? raw : Object.values(raw);
                    const posts = items.map(item => parseIGPost(item.node || item, `#${tag}`))
                        .filter(p => p.content && p.content.length > 10);
                    allPosts.push(...posts);
                    console.log(`[SV:IG] ✅ #${tag}: ${posts.length} posts`);
                }
                await delay(2000);
            } catch (err) {
                if (err.response?.status === 404) {
                    console.log(`[SV:IG] ℹ️  Hashtag search not supported — switching to account fallback`);
                    hashtagSupported = false;
                } else {
                    console.warn(`[SV:IG] ⚠️ #${tag}: ${err.message}`);
                }
            }
        }
    }

    // --- Strategy 2: Account fallback ---
    const accounts = config.IG_TARGET_ACCOUNTS || [];
    if (allPosts.length === 0 && accounts.length > 0) {
        console.log(`[SV:IG] 📷 Account fallback: ${accounts.length} accounts...`);
        for (const handle of accounts.slice(0, 5)) {
            try {
                console.log(`[SV:IG] @${handle}...`);
                const data = await svRequest('instagram/posts', { handle });
                const postsRaw = data.posts || data.items || data.edges || [];
                const postsArr = Array.isArray(postsRaw) ? postsRaw : Object.values(postsRaw);
                const posts = postsArr.map(item => parseIGPost(item.node || item, handle))
                    .filter(p => p.content && p.content.length > 10);
                allPosts.push(...posts);
                console.log(`[SV:IG] ✅ ${posts.length} posts from @${handle}`);
                track404(handle, false);
                await delay(2000);
            } catch (err) {
                console.warn(`[SV:IG] ⚠️ @${handle}: ${err.message}`);
                if (err.message?.includes('404')) track404(handle, true);
            }
        }
    }

    if (allPosts.length === 0) {
        console.log('[SV:IG] ⚠️ No IG data scraped (hashtags not supported + no accounts configured)');
    }

    const result = allPosts.slice(0, maxPosts);
    console.log(`[SV:IG] 📊 Total: ${result.length} posts`);
    return result;
}

// ═══════════════════════════════════════════════════════
// TIKTOK — Keyword Search + Account Fallback
// ═══════════════════════════════════════════════════════

function parseTTVideo(item, source) {
    return {
        platform: 'tiktok',
        post_url: item.share_url || item.video_url || item.url ||
            (item.aweme_id ? `https://www.tiktok.com/@${source}/video/${item.aweme_id}` : ''),
        author_name: item.author?.nickname || item.author?.unique_id || source,
        author_url: `https://www.tiktok.com/@${item.author?.unique_id || source}`,
        author_avatar: item.author?.avatar_thumb?.url_list?.[0] || '',
        content: item.desc || item.description || item.text || item.caption || '',
        post_created_at: item.create_time
            ? new Date(item.create_time * 1000).toISOString()
            : (item.date || new Date().toISOString()),
        scraped_at: new Date().toISOString(),
        source: `sv:tt:${source}`,
        likes: item.statistics?.digg_count || item.stats?.diggCount || 0,
        comments: item.statistics?.comment_count || item.stats?.commentCount || 0,
        views: item.statistics?.play_count || item.stats?.playCount || 0,
    };
}

async function scrapeTikTok(maxPosts = 20) {
    if (!SV_KEY) { console.warn('[SV:TT] ⚠️ No API key'); return []; }
    const allPosts = [];
    let keywordSupported = true;

    // --- Strategy 1: Keyword search ---
    const keywords = config.TT_SEARCH_KEYWORDS || [];
    if (keywords.length > 0) {
        console.log(`[SV:TT] 🎵 Trying keyword search (${keywords.length} keywords)...`);
        for (const kw of keywords.slice(0, 5)) {
            if (!keywordSupported) break;
            try {
                const resp = await axios.get(`${SV_API}/tiktok/search`, {
                    headers: headers(),
                    params: { keyword: kw },
                    timeout: 15000,
                });
                if (resp.data?.success && resp.data?.data) {
                    const raw = resp.data.data.aweme_list || resp.data.data.videos || resp.data.data.items || resp.data.data;
                    const items = Array.isArray(raw) ? raw : Object.values(raw);
                    const videos = items.map(item => parseTTVideo(item, `kw:${kw.substring(0, 20)}`))
                        .filter(p => p.content && p.content.length > 5);
                    allPosts.push(...videos);
                    console.log(`[SV:TT] ✅ "${kw}": ${videos.length} videos`);
                }
                await delay(2000);
            } catch (err) {
                if (err.response?.status === 404) {
                    console.log(`[SV:TT] ℹ️  Keyword search not supported — switching to account fallback`);
                    keywordSupported = false;
                } else {
                    console.warn(`[SV:TT] ⚠️ "${kw}": ${err.message}`);
                }
            }
        }
    }

    // --- Strategy 2: Account fallback ---
    const accounts = config.TT_TARGET_ACCOUNTS || [];
    if (allPosts.length === 0 && accounts.length > 0) {
        console.log(`[SV:TT] 🎵 Account fallback: ${accounts.length} accounts...`);
        for (const handle of accounts.slice(0, 4)) {
            try {
                console.log(`[SV:TT] @${handle}...`);
                const data = await svRequest('tiktok/videos', { handle });
                const videosRaw = data.aweme_list || data.videos || data.items || data.itemList || [];
                const videosArr = Array.isArray(videosRaw) ? videosRaw : Object.values(videosRaw);
                const videos = videosArr.map(item => parseTTVideo(item, handle))
                    .filter(p => p.content && p.content.length > 5);
                allPosts.push(...videos);
                console.log(`[SV:TT] ✅ ${videos.length} videos from @${handle}`);
                track404(handle, false);
                await delay(2000);
            } catch (err) {
                console.warn(`[SV:TT] ⚠️ @${handle}: ${err.message}`);
                if (err.message?.includes('404')) track404(handle, true);
            }
        }
    }

    if (allPosts.length === 0) {
        console.log('[SV:TT] ⚠️ No TT data scraped (keywords not supported + no accounts configured)');
    }

    const result = allPosts.slice(0, maxPosts);
    console.log(`[SV:TT] 📊 Total: ${result.length} videos`);
    return result;
}

/**
 * Test API connection
 */
async function testConnection() {
    if (!SV_KEY) return { ok: false, error: 'No SOCIAVAULT_API_KEY' };
    try {
        const resp = await axios.get(`${SV_API}/tiktok/profile`, {
            headers: headers(),
            params: { handle: 'tiktok' },
            timeout: 15000,
        });
        return { ok: resp.data?.success === true, credits_used: resp.data?.credits_used };
    } catch (err) {
        return { ok: false, error: err.response?.data?.error || err.message };
    }
}

module.exports = {
    scrapeFacebookGroups,
    scrapeInstagram,
    scrapeTikTok,
    testConnection,
    svRequest,
};
