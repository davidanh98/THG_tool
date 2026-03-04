/**
 * THG Lead Gen — PhantomBuster Integration v2
 * 
 * Replaces Apify for ALL platforms:
 * - Facebook Groups: "Facebook Group Posts Extractor"
 * - Instagram: "Instagram Hashtag Search Export"
 * - TikTok: "TikTok Search Export"
 * 
 * API v2 Flow:
 * 1. POST /agents/launch — start the phantom
 * 2. Poll GET /agents/fetch — wait for completion
 * 3. GET /agents/fetch-output — get results
 * 
 * Header: X-Phantombuster-Key: <apiKey>
 */

const axios = require('axios');
const config = require('../config');

const PB_API = 'https://api.phantombuster.com/api/v2';
const PB_KEY = process.env.PHANTOMBUSTER_API_KEY || config.PHANTOMBUSTER_API_KEY || '';

function headers() {
    return { 'X-Phantombuster-Key': PB_KEY, 'Content-Type': 'application/json' };
}

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════
// Core API: Launch → Poll → Fetch Results
// ═══════════════════════════════════════════════════════

/**
 * Launch a phantom agent with optional arguments override
 */
async function launchPhantom(agentId, args = null) {
    if (!PB_KEY) throw new Error('PHANTOMBUSTER_API_KEY not set');
    if (!agentId) throw new Error('No agent ID provided');

    const payload = { id: agentId };
    if (args) payload.argument = JSON.stringify(args);

    const resp = await axios.post(`${PB_API}/agents/launch`, payload, {
        headers: headers(), timeout: 30000,
    });

    console.log(`[PB] 🚀 Launched agent ${agentId}`);
    return resp.data?.containerId || null;
}

/**
 * Wait for a phantom to finish running
 */
async function waitForCompletion(agentId, timeoutMs = 180000) {
    const start = Date.now();

    while ((Date.now() - start) < timeoutMs) {
        await delay(5000);
        try {
            const resp = await axios.get(`${PB_API}/agents/fetch`, {
                params: { id: agentId },
                headers: headers(),
                timeout: 15000,
            });
            const agent = resp.data;

            // Check various completion indicators
            if (agent?.lastEndMessage && agent.lastEndMessage !== 'running') {
                console.log(`[PB] ✅ Finished: ${agent.lastEndMessage}`);
                return true;
            }
            if (agent?.runningContainers === 0) {
                console.log('[PB] ✅ Agent idle, fetching results...');
                return true;
            }

            console.log('[PB] ⏳ Still running...');
        } catch (err) {
            // 404 or transient errors — keep polling
            if (err.response?.status !== 404) {
                console.warn(`[PB] ⚠️ Poll: ${err.message}`);
            }
        }
    }

    console.warn('[PB] ⏰ Timeout waiting for agent');
    return false;
}

/**
 * Fetch output/results from a phantom's latest run
 */
async function fetchOutput(agentId) {
    if (!PB_KEY || !agentId) return [];

    try {
        const resp = await axios.get(`${PB_API}/agents/fetch-output`, {
            params: { id: agentId },
            headers: headers(),
            timeout: 30000,
        });

        const data = resp.data;

        // Try resultObject URL first (contains JSON data file)
        if (data?.resultObject) {
            try {
                const fileResp = await axios.get(data.resultObject, { timeout: 30000 });
                if (Array.isArray(fileResp.data)) return fileResp.data;
                if (typeof fileResp.data === 'string') {
                    return fileResp.data.split('\n').filter(Boolean).map(line => {
                        try { return JSON.parse(line); } catch { return null; }
                    }).filter(Boolean);
                }
            } catch (e) {
                console.warn(`[PB] ⚠️ Result file: ${e.message}`);
            }
        }

        // Try output field
        if (data?.output) {
            try {
                const parsed = JSON.parse(data.output);
                return Array.isArray(parsed) ? parsed : [parsed];
            } catch {
                return data.output.split('\n').filter(Boolean).map(line => {
                    try { return JSON.parse(line); } catch { return null; }
                }).filter(Boolean);
            }
        }

        return [];
    } catch (err) {
        console.error(`[PB] ❌ Fetch output: ${err.message}`);
        return [];
    }
}

/**
 * Full flow: launch → wait → fetch
 */
async function runPhantom(agentId, args = null) {
    await launchPhantom(agentId, args);
    await waitForCompletion(agentId);
    return await fetchOutput(agentId);
}

// ═══════════════════════════════════════════════════════
// Platform Scrapers
// ═══════════════════════════════════════════════════════

/**
 * FACEBOOK — Group Posts Extractor
 * Phantom scrapes configured groups, returns posts
 */
async function scrapeFacebookGroups(maxPosts = 20) {
    const agentId = config.PB_FB_GROUP_AGENT_ID;
    if (!agentId) {
        console.log('[PB:FB] ⚠️ No PB_FB_GROUP_AGENT_ID configured');
        return [];
    }

    console.log('[PB:FB] 📘 Scraping Facebook Groups...');
    const raw = await runPhantom(agentId);

    const posts = raw.map(item => ({
        platform: 'facebook',
        post_url: item.postUrl || item.url || item.permalink || '',
        author_name: item.profileName || item.name || item.authorName || item.userName || 'Unknown',
        author_url: item.profileUrl || item.profileLink || '',
        author_avatar: item.profilePictureUrl || item.imgUrl || '',
        content: item.message || item.postContent || item.text || item.postText || '',
        post_created_at: item.date || item.timestamp || item.postedAt || new Date().toISOString(),
        scraped_at: new Date().toISOString(),
        source: `pb:fb:${item.groupName || 'group'}`,
        likes: item.likeCount || item.likes || 0,
        comments: item.commentCount || item.comments || 0,
    })).filter(p => p.content && p.content.length > 15).slice(0, maxPosts);

    console.log(`[PB:FB] ✅ ${posts.length} posts from Facebook Groups`);
    return posts;
}

/**
 * INSTAGRAM — Hashtag Search Export
 * Phantom scrapes hashtag posts
 */
async function scrapeInstagram(maxPosts = 20) {
    const agentId = config.PB_IG_AGENT_ID;
    if (!agentId) {
        console.log('[PB:IG] ⚠️ No PB_IG_AGENT_ID configured');
        return [];
    }

    console.log('[PB:IG] 📷 Scraping Instagram...');
    const raw = await runPhantom(agentId);

    const posts = raw.map(item => ({
        platform: 'instagram',
        post_url: item.postUrl || item.url || item.permalink ||
            (item.shortcode ? `https://www.instagram.com/p/${item.shortcode}/` : ''),
        author_name: item.profileName || item.username || item.ownerUsername || item.owner?.username || 'Unknown',
        author_url: item.profileUrl ||
            (item.username ? `https://www.instagram.com/${item.username}/` : ''),
        author_avatar: item.profilePictureUrl || '',
        content: item.description || item.caption || item.text || item.postContent || '',
        post_created_at: item.date || item.timestamp || item.postedAt || new Date().toISOString(),
        scraped_at: new Date().toISOString(),
        source: `pb:ig:${item.hashtag || 'search'}`,
        likes: item.likeCount || item.likes || 0,
        comments: item.commentCount || item.comments || 0,
    })).filter(p => p.content && p.content.length > 10).slice(0, maxPosts);

    console.log(`[PB:IG] ✅ ${posts.length} posts from Instagram`);
    return posts;
}

/**
 * TIKTOK — Search Export
 * Phantom scrapes TikTok search/hashtag posts
 */
async function scrapeTikTok(maxPosts = 20) {
    const agentId = config.PB_TT_AGENT_ID;
    if (!agentId) {
        console.log('[PB:TT] ⚠️ No PB_TT_AGENT_ID configured');
        return [];
    }

    console.log('[PB:TT] 🎵 Scraping TikTok...');
    const raw = await runPhantom(agentId);

    const posts = raw.map(item => ({
        platform: 'tiktok',
        post_url: item.postUrl || item.url || item.videoUrl || item.webVideoUrl || '',
        author_name: item.profileName || item.username || item.authorName || item.nickName || 'Unknown',
        author_url: item.profileUrl ||
            (item.username ? `https://www.tiktok.com/@${item.username}` : ''),
        author_avatar: item.profilePictureUrl || item.avatarUrl || '',
        content: item.description || item.text || item.caption || item.desc || '',
        post_created_at: item.date || item.timestamp || item.createTime || new Date().toISOString(),
        scraped_at: new Date().toISOString(),
        source: `pb:tt:${item.hashtag || 'search'}`,
        likes: item.diggCount || item.likeCount || item.likes || 0,
        comments: item.commentCount || item.comments || 0,
        views: item.playCount || item.views || 0,
    })).filter(p => p.content && p.content.length > 10).slice(0, maxPosts);

    console.log(`[PB:TT] ✅ ${posts.length} posts from TikTok`);
    return posts;
}

/**
 * Test API connection
 */
async function testConnection() {
    if (!PB_KEY) return { ok: false, error: 'No API key' };
    try {
        // Try fetching user info or agents list
        const resp = await axios.get(`${PB_API}/agents/fetch-all`, {
            headers: headers(),
            timeout: 10000,
        });
        const agents = Array.isArray(resp.data) ? resp.data.length : 0;
        return { ok: true, agents };
    } catch (err) {
        // Even if this endpoint fails, as long as we got a response, the key works
        if (err.response?.status === 200 || err.response?.status === 404) {
            return { ok: true, note: 'Key valid, endpoint may differ' };
        }
        return { ok: false, error: err.message };
    }
}

module.exports = {
    launchPhantom,
    waitForCompletion,
    fetchOutput,
    runPhantom,
    scrapeFacebookGroups,
    scrapeInstagram,
    scrapeTikTok,
    testConnection,
};
