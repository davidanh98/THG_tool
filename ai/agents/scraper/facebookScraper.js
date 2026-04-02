/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║  Facebook Scraper — Apify Cloud Actors                    ║
 * ║  Bypass checkpoint / block bằng cloud infrastructure      ║
 * ╚═══════════════════════════════════════════════════════════╝
 *
 * Pre-configured wrappers cho 14 Facebook actors.
 * Mỗi function nhận params đơn giản, transform thành Apify actor input.
 */
const { scrape } = require('./apifyClient');

// ─── Group Scraping ──────────────────────────────────────────────────────────

/**
 * Scrape Facebook group posts & members.
 * @param {object} params
 * @param {string[]} params.groupUrls - ['https://facebook.com/groups/xxx']
 * @param {number}   [params.maxPosts=50]  - max posts per group
 * @param {number}   [params.maxResults=100]
 * @returns {{ items: object[], run: object }}
 */
async function scrapeGroups(params) {
    const { groupUrls, maxPosts = 50, maxResults = 100 } = params;
    return scrape('apify/facebook-groups-scraper', {
        startUrls: groupUrls.map(url => ({ url })),
        maxPosts,
        resultsLimit: maxResults,
    }, { limit: maxResults });
}

/**
 * Scrape Facebook page info.
 * @param {object} params
 * @param {string[]} params.pageUrls - page URLs or usernames
 * @param {number}   [params.maxResults=20]
 */
async function scrapePages(params) {
    const { pageUrls, maxResults = 20 } = params;
    return scrape('apify/facebook-pages-scraper', {
        startUrls: pageUrls.map(url => ({ url })),
        resultsLimit: maxResults,
    }, { limit: maxResults });
}

/**
 * Scrape posts from pages/profiles.
 * @param {object} params
 * @param {string[]} params.urls - page/profile URLs
 * @param {number}   [params.maxPosts=50]
 */
async function scrapePosts(params) {
    const { urls, maxPosts = 50 } = params;
    return scrape('apify/facebook-posts-scraper', {
        startUrls: urls.map(url => ({ url })),
        resultsLimit: maxPosts,
    }, { limit: maxPosts });
}

/**
 * Scrape comments from a post URL.
 * @param {object} params
 * @param {string[]} params.postUrls - post URLs
 * @param {number}   [params.maxComments=100]
 */
async function scrapeComments(params) {
    const { postUrls, maxComments = 100 } = params;
    return scrape('apify/facebook-comments-scraper', {
        startUrls: postUrls.map(url => ({ url })),
        resultsLimit: maxComments,
    }, { limit: maxComments });
}

/**
 * Scrape Facebook Marketplace listings.
 * @param {object} params
 * @param {string}   params.searchQuery - search term (e.g. "furniture")
 * @param {string}   [params.location] - location name
 * @param {number}   [params.maxResults=50]
 */
async function scrapeMarketplace(params) {
    const { searchQuery, location, maxResults = 50 } = params;
    const input = {
        searchQuery,
        resultsLimit: maxResults,
    };
    if (location) input.location = location;
    return scrape('apify/facebook-marketplace-scraper', input, { limit: maxResults });
}

/**
 * Scrape Facebook search results.
 * @param {object} params
 * @param {string}   params.query - search term
 * @param {string}   [params.searchType='posts'] - 'posts' | 'people' | 'pages' | 'groups'
 * @param {number}   [params.maxResults=50]
 */
async function scrapeSearch(params) {
    const { query, searchType = 'posts', maxResults = 50 } = params;
    return scrape('apify/facebook-search-scraper', {
        searchQueries: [query],
        searchType,
        resultsLimit: maxResults,
    }, { limit: maxResults });
}

/**
 * Scrape Facebook page reviews.
 * @param {object} params
 * @param {string[]} params.pageUrls
 * @param {number}   [params.maxResults=50]
 */
async function scrapeReviews(params) {
    const { pageUrls, maxResults = 50 } = params;
    return scrape('apify/facebook-reviews-scraper', {
        startUrls: pageUrls.map(url => ({ url })),
        resultsLimit: maxResults,
    }, { limit: maxResults });
}

/**
 * Scrape Facebook Ads Library.
 * @param {object} params
 * @param {string}   params.searchQuery - advertiser or keyword
 * @param {string}   [params.country='VN']
 * @param {number}   [params.maxResults=50]
 */
async function scrapeAds(params) {
    const { searchQuery, country = 'VN', maxResults = 50 } = params;
    return scrape('apify/facebook-ads-scraper', {
        searchQuery,
        country,
        resultsLimit: maxResults,
    }, { limit: maxResults });
}

/**
 * Extract contact information from Facebook pages.
 * @param {object} params
 * @param {string[]} params.pageUrls
 */
async function scrapePageContacts(params) {
    const { pageUrls } = params;
    return scrape('apify/facebook-page-contact-information', {
        startUrls: pageUrls.map(url => ({ url })),
    });
}

// ─── Action Router ───────────────────────────────────────────────────────────
const ACTIONS = {
    groups: scrapeGroups,
    pages: scrapePages,
    posts: scrapePosts,
    comments: scrapeComments,
    marketplace: scrapeMarketplace,
    search: scrapeSearch,
    reviews: scrapeReviews,
    ads: scrapeAds,
    contacts: scrapePageContacts,
};

/**
 * Route a Facebook scrape action.
 * @param {string} action - one of: groups, pages, posts, comments, marketplace, search, reviews, ads, contacts
 * @param {object} params - action-specific params
 */
async function run(action, params) {
    const fn = ACTIONS[action];
    if (!fn) throw new Error(`[FacebookScraper] Unknown action: ${action}. Available: ${Object.keys(ACTIONS).join(', ')}`);
    console.log(`[FacebookScraper] 🎯 Running action: ${action}`);
    return fn(params);
}

module.exports = {
    run,
    scrapeGroups,
    scrapePages,
    scrapePosts,
    scrapeComments,
    scrapeMarketplace,
    scrapeSearch,
    scrapeReviews,
    scrapeAds,
    scrapePageContacts,
    ACTIONS,
};
