/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║  Social Scraper — Instagram, TikTok, YouTube via Apify    ║
 * ╚═══════════════════════════════════════════════════════════╝
 */
const { scrape } = require('./apifyClient');

// ─── Instagram ───────────────────────────────────────────────────────────────

async function igProfile(params) {
    const { usernames, maxResults = 20 } = params;
    return scrape('apify/instagram-profile-scraper', {
        usernames,
        resultsLimit: maxResults,
    }, { limit: maxResults });
}

async function igPosts(params) {
    const { urls, maxPosts = 50 } = params;
    return scrape('apify/instagram-post-scraper', {
        directUrls: urls,
        resultsLimit: maxPosts,
    }, { limit: maxPosts });
}

async function igComments(params) {
    const { postUrls, maxComments = 100 } = params;
    return scrape('apify/instagram-comment-scraper', {
        directUrls: postUrls,
        resultsLimit: maxComments,
    }, { limit: maxComments });
}

async function igHashtag(params) {
    const { hashtags, maxPosts = 50 } = params;
    return scrape('apify/instagram-hashtag-scraper', {
        hashtags,
        resultsLimit: maxPosts,
    }, { limit: maxPosts });
}

async function igSearch(params) {
    const { query, maxResults = 30 } = params;
    return scrape('apify/instagram-search-scraper', {
        search: query,
        resultsLimit: maxResults,
    }, { limit: maxResults });
}

const IG_ACTIONS = { profile: igProfile, posts: igPosts, comments: igComments, hashtag: igHashtag, search: igSearch };

// ─── TikTok ──────────────────────────────────────────────────────────────────

async function ttProfile(params) {
    const { profiles, maxResults = 20 } = params;
    return scrape('clockworks/tiktok-profile-scraper', {
        profiles,
        resultsLimit: maxResults,
    }, { limit: maxResults });
}

async function ttVideos(params) {
    const { urls, maxResults = 50 } = params;
    return scrape('clockworks/tiktok-video-scraper', {
        urls,
        resultsLimit: maxResults,
    }, { limit: maxResults });
}

async function ttComments(params) {
    const { postUrls, maxComments = 100 } = params;
    return scrape('clockworks/tiktok-comments-scraper', {
        postURLs: postUrls,
        resultsLimit: maxComments,
    }, { limit: maxComments });
}

async function ttHashtag(params) {
    const { hashtags, maxResults = 50 } = params;
    return scrape('clockworks/tiktok-hashtag-scraper', {
        hashtags,
        resultsLimit: maxResults,
    }, { limit: maxResults });
}

async function ttSearch(params) {
    const { query, maxResults = 30 } = params;
    return scrape('clockworks/tiktok-scraper', {
        searchQueries: [query],
        resultsLimit: maxResults,
    }, { limit: maxResults });
}

const TT_ACTIONS = { profile: ttProfile, videos: ttVideos, comments: ttComments, hashtag: ttHashtag, search: ttSearch };

// ─── YouTube ─────────────────────────────────────────────────────────────────

async function ytChannel(params) {
    const { channelUrls, maxResults = 20 } = params;
    return scrape('streamers/youtube-channel-scraper', {
        startUrls: channelUrls.map(url => ({ url })),
        resultsLimit: maxResults,
    }, { limit: maxResults });
}

async function ytSearch(params) {
    const { query, maxResults = 30 } = params;
    return scrape('streamers/youtube-scraper', {
        searchKeywords: query,
        maxResults,
    }, { limit: maxResults });
}

async function ytComments(params) {
    const { videoUrls, maxComments = 100 } = params;
    return scrape('streamers/youtube-comments-scraper', {
        startUrls: videoUrls.map(url => ({ url })),
        maxComments,
    }, { limit: maxComments });
}

const YT_ACTIONS = { channel: ytChannel, search: ytSearch, comments: ytComments };

// ─── Google Maps ─────────────────────────────────────────────────────────────

async function gmapSearch(params) {
    const { query, location, maxResults = 50 } = params;
    const input = { searchStringsArray: [query], maxCrawledPlaces: maxResults };
    if (location) input.customGeolocation = { lat: 0, lng: 0, zoom: 12, ...location };
    return scrape('compass/crawler-google-places', input, { limit: maxResults });
}

const GMAP_ACTIONS = { search: gmapSearch };

// ─── Platform Router ─────────────────────────────────────────────────────────
const PLATFORMS = {
    instagram: IG_ACTIONS,
    tiktok: TT_ACTIONS,
    youtube: YT_ACTIONS,
    google_maps: GMAP_ACTIONS,
};

/**
 * Route a social scrape action.
 * @param {string} platform - instagram | tiktok | youtube | google_maps
 * @param {string} action   - platform-specific action name
 * @param {object} params   - action-specific params
 */
async function run(platform, action, params) {
    const pActions = PLATFORMS[platform];
    if (!pActions) throw new Error(`[SocialScraper] Unknown platform: ${platform}. Available: ${Object.keys(PLATFORMS).join(', ')}`);
    const fn = pActions[action];
    if (!fn) throw new Error(`[SocialScraper] Unknown action for ${platform}: ${action}. Available: ${Object.keys(pActions).join(', ')}`);
    console.log(`[SocialScraper] 🎯 ${platform}/${action}`);
    return fn(params);
}

module.exports = {
    run,
    PLATFORMS,
    // Direct exports for convenience
    igProfile, igPosts, igComments, igHashtag, igSearch,
    ttProfile, ttVideos, ttComments, ttHashtag, ttSearch,
    ytChannel, ytSearch, ytComments,
    gmapSearch,
};
