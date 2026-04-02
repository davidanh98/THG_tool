/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║  Scraper Agent — Public API                               ║
 * ║  Universal entry point for all Apify-powered scraping     ║
 * ╚═══════════════════════════════════════════════════════════╝
 *
 * Usage:
 *   const scraper = require('./ai/agents/scraper');
 *   const { items } = await scraper.scrape({ platform: 'facebook', action: 'groups', params: { groupUrls: [...] } });
 */
const facebookScraper = require('./facebookScraper');
const socialScraper = require('./socialScraper');
const { listActors, scrape: rawScrape } = require('./apifyClient');

/**
 * Universal scrape function — routes to the right platform + action.
 *
 * @param {object} opts
 * @param {string} opts.platform - 'facebook' | 'instagram' | 'tiktok' | 'youtube' | 'google_maps'
 * @param {string} opts.action   - platform-specific action (e.g. 'groups', 'posts', 'search')
 * @param {object} opts.params   - action-specific parameters
 * @returns {{ items: object[], run: object }}
 */
async function scrape({ platform, action, params }) {
    if (!platform) throw new Error('[Scraper] platform is required');
    if (!action) throw new Error('[Scraper] action is required');

    console.log(`[Scraper] 🔄 ${platform}/${action} — starting`);
    const start = Date.now();

    let result;
    if (platform === 'facebook') {
        result = await facebookScraper.run(action, params || {});
    } else {
        result = await socialScraper.run(platform, action, params || {});
    }

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[Scraper] ✅ ${platform}/${action} — ${result.items.length} items in ${elapsed}s`);

    return result;
}

/**
 * Run a raw Apify actor by ID (for custom / unlisted actors).
 * @param {string} actorId - e.g. 'apify/facebook-groups-scraper'
 * @param {object} input
 * @param {object} [opts]
 */
async function scrapeRaw(actorId, input, opts) {
    return rawScrape(actorId, input, opts);
}

/**
 * Get available actions for a platform.
 * @param {string} [platform] - optional filter
 */
function getAvailableActions(platform) {
    const result = {};

    if (!platform || platform === 'facebook') {
        result.facebook = Object.keys(facebookScraper.ACTIONS);
    }

    const socialPlatforms = socialScraper.PLATFORMS;
    for (const [p, actions] of Object.entries(socialPlatforms)) {
        if (!platform || platform === p) {
            result[p] = Object.keys(actions);
        }
    }

    return result;
}

/**
 * Check if Apify is configured (APIFY_TOKEN exists).
 */
function isConfigured() {
    return !!process.env.APIFY_TOKEN;
}

module.exports = {
    scrape,
    scrapeRaw,
    listActors,
    getAvailableActions,
    isConfigured,
    // Direct access to sub-modules
    facebook: facebookScraper,
    social: socialScraper,
};
