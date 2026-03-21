/**
 * THG Lead Gen — API Server Entry Point (Lightweight)
 * 
 * This process ONLY runs:
 *   1. Express API server (dashboard + webhooks)
 *   2. Cron scheduler that ENQUEUES scan jobs to scan_queue
 * 
 * Heavy work is handled by separate worker processes:
 *   - src/workers/scraperWorker.js  → Playwright scraping + classification
 *   - src/workers/aiWorker.js       → AI classification of raw_leads (CrawBot)
 */
const cron = require('node-cron');
const config = require('./config');
const database = require('./core/data_store/database');
const { startServer } = require('./server');
const websiteScanner = require('../ai/agents/enrichment/websiteScanner');
const predictiveScoring = require('../ai/agents/enrichment/predictiveScoring');

/**
 * Main entry point — API server + cron scheduler
 */
async function main() {
    const args = process.argv.slice(2);

    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  🔍 THG Lead Detection Tool v5.0                    ║');
    console.log('║  3-Tier Architecture: API • Scraper • AI Worker     ║');
    console.log('║  Powered by Groq/Gemini + Playwright + SQLite Queue ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log('');

    // Single scan mode (CLI) — enqueue and exit
    if (args.includes('--scan-once')) {
        console.log('[Main] Enqueueing single scan...');
        database.enqueueScan('MANUAL_SCAN', {
            platforms: config.ENABLED_PLATFORMS,
            maxPosts: config.MAX_POSTS_PER_SCAN || 200,
        });
        console.log('[Main] ✅ Scan enqueued. Start scraperWorker.js to process it.');
        process.exit(0);
    }

    // Start API server (lightweight — no Playwright, no AI)
    startServer();

    // ═══ Initialize Infrastructure Agent ═══
    try {
        const { infraAgent } = require('../ai/infraAgent');
        await infraAgent.init();
        process.on('SIGINT', async () => {
            await infraAgent.shutdown();
            process.exit(0);
        });
    } catch (err) {
        console.warn(`[Main] ⚠️ InfraAgent init skipped: ${err.message}`);
    }

    // ═══ Cron Scheduler — enqueues scan jobs ═══
    // Jobs are picked up by scraperWorker.js (separate process)
    const unifiedCron = config.CRON_UNIFIED_SCAN || '0 8-22 * * *';
    console.log(`[Main] ⏰ Scan schedule: ${unifiedCron} (enqueue to scan_queue)`);

    cron.schedule(unifiedCron, () => {
        console.log(`[Cron] 📡 Enqueueing scan (${config.ENABLED_PLATFORMS.join(', ')})...`);
        database.enqueueScan('FULL_SCAN', {
            platforms: config.ENABLED_PLATFORMS,
            maxPosts: config.MAX_POSTS_PER_SCAN || 200,
        });
        console.log(`[Cron] ✅ Scan job enqueued. Worker will pick it up.`);
    });

    // ═══ Strategy: Fanpage Sharer (Account Farming) ═══
    // Run at 15:00 every 2 days to automate the 4 VIP accounts visiting and sharing the THG Fanpage
    cron.schedule('0 15 */2 * *', () => {
        console.log(`[Cron] 🚜 Khởi động chiến dịch Nuôi Nick (Fanpage Sharer)...`);
        const { runFanpageFarm } = require('../ai/agents/strategies/fanpageSharer');
        runFanpageFarm().catch(console.error);
    });

    // ═══ SIS Phase 3: Growth OS & Deep Enrichment ═══

    // 1. Website Deep Scanner: Chạy mỗi 2 tiếng để mò vào các Domain cào email và Tech Stack
    cron.schedule('0 */2 * * *', () => {
        console.log(`[Cron] 🕵️ Khởi động Sát thủ Công nghệ (Website Deep Scanner)...`);
        websiteScanner.enrichAccountsQueue().catch(console.error);
    });

    // 2. Predictive Scoring (Tuning Loop): Chạy lúc 1:00 AM mỗi ngày để học máy từ các "Won Deals"
    cron.schedule('0 1 * * *', () => {
        console.log(`[Cron] 🧠 Khởi động Vòng lặp Học Máy (Predictive Weights Tuning)...`);
        predictiveScoring.runTuningLoop();
    });

    // Enqueue initial scan on startup
    console.log('[Main] 🚀 Enqueueing initial scan...');
    database.enqueueScan('FULL_SCAN', {
        platforms: config.ENABLED_PLATFORMS,
        maxPosts: config.MAX_POSTS_PER_SCAN || 200,
    });

    console.log(`[Main] 🟢 API Server ready! Platforms: ${config.ENABLED_PLATFORMS.join(', ')}`);
    console.log(`[Main] Dashboard: http://localhost:${config.PORT}`);
    console.log(`[Main] 💡 Start workers: node backend/infra/workers/scraperWorker.js`);
    console.log(`[Main] 💡                 node backend/infra/workers/aiWorker.js`);
    console.log(`[Main] 💡                 node backend/infra/workers/identityWorker.js`);
}

main().catch(err => {
    console.error('[Main] Fatal error:', err);
    process.exit(1);
});

module.exports = {};
