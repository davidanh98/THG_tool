/**
 * THG Lead Gen — Multi-Platform Scraper v6 (PhantomBuster Only)
 * 
 * All scraping powered by PhantomBuster:
 * - Facebook: Group Posts Extractor
 * - Instagram: Hashtag Search Export
 * - TikTok: Search Export
 * 
 * No more Apify or RapidAPI — clean, single-source pipeline.
 */

const config = require('../config');
const pb = require('./phantomBuster');

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════
// Dedup helper
// ═══════════════════════════════════════════════════════
function dedup(posts) {
    const seen = new Set();
    return posts.filter(p => {
        const key = p.post_url || p.content?.substring(0, 100);
        if (!key || seen.has(key)) return false;
        seen.add(key); return true;
    });
}

// ═══════════════════════════════════════════════════════
// Platform scrapers — all PhantomBuster
// ═══════════════════════════════════════════════════════

async function scrapeFacebook(_keywords, maxPosts = 20) {
    console.log('[Scraper:FB] 📘 Scraping Facebook via PhantomBuster...');
    try {
        const posts = await pb.scrapeFacebookGroups(maxPosts);
        console.log(`[Scraper:FB] ✅ ${posts.length} posts`);
        return dedup(posts);
    } catch (err) {
        console.error(`[Scraper:FB] ❌ ${err.message}`);
        return [];
    }
}

async function scrapeInstagram(_hashtags, maxPosts = 30) {
    console.log('[Scraper:IG] 📷 Scraping Instagram via PhantomBuster...');
    try {
        const posts = await pb.scrapeInstagram(maxPosts);
        console.log(`[Scraper:IG] ✅ ${posts.length} posts`);
        return dedup(posts);
    } catch (err) {
        console.error(`[Scraper:IG] ❌ ${err.message}`);
        return [];
    }
}

async function scrapeTikTok(_keywords, maxPosts = 20) {
    console.log('[Scraper:TT] 🎵 Scraping TikTok via PhantomBuster...');
    try {
        const posts = await pb.scrapeTikTok(maxPosts);
        console.log(`[Scraper:TT] ✅ ${posts.length} posts`);
        return dedup(posts);
    } catch (err) {
        console.error(`[Scraper:TT] ❌ ${err.message}`);
        return [];
    }
}

// ═══════════════════════════════════════════════════════
// Full Scan Orchestrator
// ═══════════════════════════════════════════════════════
const SCRAPERS = {
    facebook: { fn: scrapeFacebook, getKeywords: () => [] },
    instagram: { fn: scrapeInstagram, getKeywords: () => config.SEARCH_KEYWORDS?.instagram || [] },
    tiktok: { fn: scrapeTikTok, getKeywords: () => config.SEARCH_KEYWORDS?.tiktok || [] },
};

async function runFullScan(options = {}) {
    const platforms = options.platforms || ['facebook', 'tiktok', 'instagram'];
    const maxPerPlatform = options.maxPosts || 20;

    console.log(`\n${'═'.repeat(55)}`);
    console.log(`  🟣 PhantomBuster — All platforms`);
    console.log(`  📊 Max per platform: ${maxPerPlatform} posts`);
    console.log(`${'═'.repeat(55)}\n`);

    const results = {};
    for (const platform of platforms) {
        const scraper = SCRAPERS[platform];
        if (!scraper) { console.error(`[Scraper] Unknown platform: ${platform}`); continue; }
        try {
            const keywords = scraper.getKeywords();
            results[platform] = await scraper.fn(keywords, maxPerPlatform);
            console.log(`[Scraper] ✅ ${platform}: ${results[platform].length} posts\n`);
        } catch (err) {
            console.error(`[Scraper] ❌ ${platform}: ${err.message}`);
            results[platform] = [];
        }
        await delay(3000);
    }

    const total = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`\n${'═'.repeat(55)}`);
    console.log(`  📊 Total: ${total} posts`);
    Object.entries(results).forEach(([p, r]) => console.log(`     ${p}: ${r.length}`));
    console.log(`${'═'.repeat(55)}\n`);

    return results;
}

module.exports = {
    scrapeFacebook, scrapeInstagram,
    scrapeTikTok, runFullScan,
};
