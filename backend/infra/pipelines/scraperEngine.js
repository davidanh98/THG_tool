/**
 * THG Lead Gen — Multi-Platform Scraper (Self-Hosted Only)
 *
 * Pipeline: Playwright Stealth → mbasic.facebook.com → FB session cookie → posts
 *
 * SociaVault removed (credits exhausted). This is now the sole scraping engine.
 *
 * [FIX v2.5] RAM Guard: MAX_CONCURRENT_ACCOUNTS = 2
 *   Server có 3.8GB RAM, 4 browser song song = OOM Kill.
 *   Giới hạn 2 browser đồng thời = ~800MB browser RAM, an toàn cho toàn hệ thống.
 */

const config = require('../../config');
const fbScraper = require('../scraper');
const { shadowScrapeGroups } = require('../scraper/shadowApi');
const { contentHash } = require('../../../ai/agents/memoryStore');

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ── RAM Guard — số browser chạy song song tối đa ─────────────────────────────
// 3.8GB total, api+ai+identity ~600MB → còn ~3.2GB cho scraper
// Mỗi Playwright browser ~400-500MB → tối đa 2 browser song song để có buffer
const MAX_CONCURRENT_ACCOUNTS = 2;

// ── Dedup — compound key to prevent storing duplicates ────────────────────────
function dedup(posts) {
    const seen = new Set();
    return posts.filter(p => {
        const h = contentHash((p.content || '').slice(0, 500));
        const key = [
            p.platform,
            p.item_type || 'post',
            p.post_url || '',
            p.author_name || '',
            p.post_created_at || '',
            h,
        ].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ── Facebook ──────────────────────────────────────────────────────────────────

async function scrapeFacebook(_keywords, maxPosts = 30, options = {}) {
    try {
        // Load groups: groups.db (source of truth) > config fallback
        let groups = config.FB_TARGET_GROUPS;
        try {
            const groupDiscovery = require('../../../ai/agents/groupDiscovery');
            const dbGroups = groupDiscovery.getScanRotationList(200);
            if (dbGroups.length > 0) {
                groups = dbGroups;
                console.log(`[Scraper:FB] 📋 Loaded ${groups.length} groups từ Group Discovery DB`);
            }
        } catch (e) {
            console.warn('[Scraper:FB] ⚠️ GroupDB failed, using config fallback');
        }

        // ═══ Phase 1: Try Shadow API (GraphQL HTTP — fast, lightweight) ═══
        const useShadow = process.env.SHADOW_API_ENABLED !== 'false'; // Default: enabled
        if (useShadow) {
            console.log('[Scraper:FB] ⚡ Trying Shadow API (GraphQL mode)...');
            try {
                const shadowPosts = await shadowScrapeGroups(groups, {
                    maxPosts,
                    ...options,
                });
                // shadowScrapeGroups returns null if no valid accounts → fall through to Playwright
                if (shadowPosts !== null && shadowPosts.length > 0) {
                    const deduped = dedup(shadowPosts);
                    console.log(`[Scraper:FB] ✅ Shadow API: ${deduped.length} posts (before dedup: ${shadowPosts.length})`);
                    return deduped;
                }
                if (shadowPosts !== null && shadowPosts.length === 0) {
                    console.log('[Scraper:FB] 📭 Shadow API returned 0 posts — trying Playwright fallback');
                }
            } catch (shadowErr) {
                console.warn(`[Scraper:FB] ⚠️ Shadow API failed: ${shadowErr.message} — falling back to Playwright`);
            }
        }

        // ═══ Phase 2: Fallback to Playwright (browser automation) ═══
        console.log('[Scraper:FB] 🌐 Scraping via Playwright (browser fallback)...');
        const posts = await fbScraper.scrapeFacebookGroups(maxPosts, {
            ...options,
            maxConcurrentAccounts: MAX_CONCURRENT_ACCOUNTS,
        }, groups);
        const deduped = dedup(posts);
        console.log(`[Scraper:FB] ✅ Playwright: ${deduped.length} posts (before dedup: ${posts.length})`);
        return deduped;
    } catch (err) {
        console.error(`[Scraper:FB] ❌ ${err.message}`);
        return [];
    }
}

// ── Instagram ─────────────────────────────────────────────────────────────────
// Placeholder — add Playwright IG scraper when ready
async function scrapeInstagram(_hashtags, _maxPosts = 30) {
    console.log('[Scraper:IG] ⏭ Instagram scraper not yet implemented in self-hosted mode.');
    return [];
}

// ── TikTok ────────────────────────────────────────────────────────────────────
// Placeholder — add Playwright TT scraper when ready
async function scrapeTikTok(_keywords, _maxPosts = 20) {
    console.log('[Scraper:TT] ⏭ TikTok scraper not yet implemented in self-hosted mode.');
    return [];
}

// ── Full Scan Orchestrator ────────────────────────────────────────────────────
const SCRAPERS = {
    facebook: { fn: scrapeFacebook },
    instagram: { fn: scrapeInstagram },
    tiktok: { fn: scrapeTikTok },
};

async function runFullScan(options = {}) {
    const platforms = options.platforms || config.ENABLED_PLATFORMS || ['facebook'];
    const maxPerPlatform = options.maxPosts || config.MAX_POSTS_PER_SCAN || 30;

    console.log(`\n${'═'.repeat(55)}`);
    console.log(`  🤖 THG Lead Gen — Dual Engine Scraper`);
    console.log(`  ⚡ Primary: Shadow API (GraphQL) | Fallback: Playwright`);
    console.log(`  📊 Platforms: ${platforms.join(', ')} | Max: ${maxPerPlatform}/platform`);
    console.log(`${'═'.repeat(55)}\n`);

    const results = {};
    for (const platform of platforms) {
        const scraper = SCRAPERS[platform];
        if (!scraper) {
            console.error(`[Scraper] Unknown platform: ${platform}`);
            continue;
        }
        try {
            results[platform] = await scraper.fn([], maxPerPlatform, options);
            console.log(`[Scraper] ✅ ${platform}: ${results[platform].length} posts\n`);
        } catch (err) {
            console.error(`[Scraper] ❌ ${platform}: ${err.message}`);
            results[platform] = [];
        }
        await delay(2000);
    }

    const total = Object.values(results).reduce((sum, arr) => sum + arr.length, 0);
    console.log(`\n${'═'.repeat(55)}`);
    console.log(`  📊 Total: ${total} posts`);
    Object.entries(results).forEach(([p, r]) => console.log(`     ${p}: ${r.length}`));
    console.log(`${'═'.repeat(55)}\n`);

    return results;
}

module.exports = { scrapeFacebook, scrapeInstagram, scrapeTikTok, runFullScan };
