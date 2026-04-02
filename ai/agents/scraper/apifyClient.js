/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║  Apify Client Wrapper                                     ║
 * ║  Cloud-based scraping — bypass FB checkpoint              ║
 * ╚═══════════════════════════════════════════════════════════╝
 *
 * Thin wrapper around `apify-client` to run Actors, poll status,
 * and fetch dataset results with auto-retry + error handling.
 */
const { ApifyClient } = require('apify-client');

// ─── Singleton client ────────────────────────────────────────────────────────
let _client = null;

function getClient() {
    if (_client) return _client;
    const token = process.env.APIFY_TOKEN;
    if (!token) throw new Error('[ApifyScraper] APIFY_TOKEN not found in .env — get one at https://apify.com → Settings → API Tokens');
    _client = new ApifyClient({ token });
    return _client;
}

/**
 * Run an Apify Actor and wait for it to finish.
 * @param {string} actorId - e.g. 'apify/facebook-groups-scraper'
 * @param {object} input   - Actor-specific input params
 * @param {object} [opts]
 * @param {number} [opts.timeoutSecs=300]  - Max wait time
 * @param {number} [opts.memoryMbytes=512] - Memory allocation
 * @returns {{ runId: string, status: string, datasetId: string }}
 */
async function runActor(actorId, input, opts = {}) {
    const client = getClient();
    const { timeoutSecs = 300, memoryMbytes = 512 } = opts;

    console.log(`[ApifyScraper] 🚀 Starting actor: ${actorId}`);
    console.log(`[ApifyScraper] 📋 Input:`, JSON.stringify(input).substring(0, 300));

    const run = await client.actor(actorId).call(input, {
        timeoutSecs,
        memoryMbytes,
        waitSecs: timeoutSecs, // block until done
    });

    console.log(`[ApifyScraper] ✅ Run finished: ${run.id} — status: ${run.status}`);

    if (run.status !== 'SUCCEEDED') {
        throw new Error(`[ApifyScraper] Actor ${actorId} run ${run.status}: ${run.statusMessage || 'unknown error'}`);
    }

    return {
        runId: run.id,
        status: run.status,
        datasetId: run.defaultDatasetId,
        stats: {
            durationSecs: run.stats?.runTimeSecs || 0,
            computeUnits: run.stats?.computeUnits || 0,
        },
    };
}

/**
 * Fetch dataset items from a completed run.
 * @param {string} datasetId
 * @param {object} [opts]
 * @param {number} [opts.limit=100]
 * @param {number} [opts.offset=0]
 * @returns {object[]}
 */
async function getDataset(datasetId, opts = {}) {
    const client = getClient();
    const { limit = 100, offset = 0 } = opts;

    const { items } = await client.dataset(datasetId).listItems({
        limit,
        offset,
        clean: true,
    });

    console.log(`[ApifyScraper] 📦 Dataset ${datasetId}: ${items.length} items fetched`);
    return items;
}

/**
 * Convenience: run actor + fetch results in one call.
 * @param {string} actorId
 * @param {object} input
 * @param {object} [opts]  - Merged opts for runActor + getDataset
 * @returns {{ items: object[], run: object }}
 */
async function scrape(actorId, input, opts = {}) {
    const { limit = 100, offset = 0, ...runOpts } = opts;
    const run = await runActor(actorId, input, runOpts);
    const items = await getDataset(run.datasetId, { limit, offset });
    return { items, run };
}

/**
 * List available actors (hardcoded catalog — no API call needed).
 */
function listActors() {
    return ACTOR_CATALOG;
}

// ─── Actor Catalog ───────────────────────────────────────────────────────────
const ACTOR_CATALOG = {
    facebook: [
        { id: 'apify/facebook-groups-scraper', name: 'Groups Scraper', desc: 'Scrape group members, posts, info' },
        { id: 'apify/facebook-pages-scraper', name: 'Pages Scraper', desc: 'Scrape page info' },
        { id: 'apify/facebook-page-contact-information', name: 'Page Contacts', desc: 'Extract contact info from pages' },
        { id: 'apify/facebook-posts-scraper', name: 'Posts Scraper', desc: 'Scrape posts from pages/groups' },
        { id: 'apify/facebook-comments-scraper', name: 'Comments Scraper', desc: 'Scrape post comments' },
        { id: 'apify/facebook-likes-scraper', name: 'Likes Scraper', desc: 'Scrape post likes/reactions' },
        { id: 'apify/facebook-reviews-scraper', name: 'Reviews Scraper', desc: 'Scrape page reviews' },
        { id: 'apify/facebook-events-scraper', name: 'Events Scraper', desc: 'Scrape events' },
        { id: 'apify/facebook-ads-scraper', name: 'Ads Scraper', desc: 'Scrape ad library' },
        { id: 'apify/facebook-search-scraper', name: 'Search Scraper', desc: 'Scrape search results' },
        { id: 'apify/facebook-reels-scraper', name: 'Reels Scraper', desc: 'Scrape reels' },
        { id: 'apify/facebook-photos-scraper', name: 'Photos Scraper', desc: 'Scrape photos from pages' },
        { id: 'apify/facebook-marketplace-scraper', name: 'Marketplace Scraper', desc: 'Scrape marketplace listings' },
        { id: 'apify/facebook-followers-following-scraper', name: 'Followers Scraper', desc: 'Scrape followers count' },
    ],
    instagram: [
        { id: 'apify/instagram-profile-scraper', name: 'Profile Scraper', desc: 'Scrape profile info' },
        { id: 'apify/instagram-post-scraper', name: 'Post Scraper', desc: 'Scrape post details' },
        { id: 'apify/instagram-comment-scraper', name: 'Comment Scraper', desc: 'Scrape post comments' },
        { id: 'apify/instagram-hashtag-scraper', name: 'Hashtag Scraper', desc: 'Scrape hashtag posts' },
        { id: 'apify/instagram-reel-scraper', name: 'Reel Scraper', desc: 'Scrape reels' },
        { id: 'apify/instagram-search-scraper', name: 'Search Scraper', desc: 'Scrape IG search results' },
        { id: 'apify/instagram-scraper', name: 'Universal Scraper', desc: 'General-purpose IG scraper' },
    ],
    tiktok: [
        { id: 'clockworks/tiktok-scraper', name: 'Universal Scraper', desc: 'General TikTok scraper' },
        { id: 'clockworks/tiktok-profile-scraper', name: 'Profile Scraper', desc: 'Scrape profile info' },
        { id: 'clockworks/tiktok-video-scraper', name: 'Video Scraper', desc: 'Scrape video details' },
        { id: 'clockworks/tiktok-comments-scraper', name: 'Comments Scraper', desc: 'Scrape video comments' },
        { id: 'clockworks/tiktok-hashtag-scraper', name: 'Hashtag Scraper', desc: 'Scrape hashtag videos' },
        { id: 'clockworks/tiktok-ads-scraper', name: 'Ads Scraper', desc: 'Scrape TikTok ads' },
    ],
    youtube: [
        { id: 'streamers/youtube-scraper', name: 'Universal Scraper', desc: 'General YouTube scraper' },
        { id: 'streamers/youtube-channel-scraper', name: 'Channel Scraper', desc: 'Scrape channel info' },
        { id: 'streamers/youtube-comments-scraper', name: 'Comments Scraper', desc: 'Scrape video comments' },
    ],
    google: [
        { id: 'compass/crawler-google-places', name: 'Google Maps Scraper', desc: 'Scrape Google Maps listings' },
        { id: 'apify/google-search-scraper', name: 'Google Search', desc: 'Scrape Google search results' },
    ],
};

module.exports = {
    getClient,
    runActor,
    getDataset,
    scrape,
    listActors,
    ACTOR_CATALOG,
};
