/**
 * SIS v2 Scraper Worker — Signal-Centric Pipeline
 * 
 * Refactored to align with SIS v2:
 * 1. POLLS jobs from scan_queue.
 * 2. SCRAPES raw social signals (self-hosted playwright).
 * 3. CLASSIFIES via SIS v2 Intelligence Layer (6-metric rubric).
 * 4. ROUTES into 4 Lanes automatically in DB.
 * 5. NOTIFIES via Telegram for high-intent signals.
 */

process.on('unhandledRejection', (reason) => {
    const msg = String(reason?.message || reason || '');
    if (msg.includes('Target page, context or browser has been closed') || msg.includes('cdpSession.send')) return;
    console.error('[SIS ScraperWorker] ❌ Unhandled rejection:', reason);
});

const config = require('../../config');
const database = require('../../core/data_store/database');
const { runFullScan } = require('../pipelines/scraperEngine');
const { classifyPosts } = require('../../../ai/prompts/leadQualifier');
const { sendMessage } = require('../../core/integrations/telegramBot');

const POLL_INTERVAL = 10000; // 10s
let isProcessing = false;

/**
 * SIS v2 Pipeline: Scrape -> Classify (with auto-DB-save) -> Notify
 */
async function runSISPipeline(options = {}) {
    const startTime = Date.now();
    console.log(`\n[SIS v2 Pipeline] 🚀 Starting scan at ${new Date().toLocaleString()}`);

    // Create Scan Log
    const scanLog = database._db.prepare(`
        INSERT INTO scan_logs (platform, keywords_used, posts_found, leads_detected, status)
        VALUES (?, ?, 0, 0, 'running')
    `).run('all', JSON.stringify(options.platforms || config.ENABLED_PLATFORMS));
    const scanId = scanLog.lastInsertRowid;

    try {
        // Step 1: RAW SCRAPE
        const scraped = await runFullScan(options);
        const allPosts = [];
        for (const [platform, posts] of Object.entries(scraped)) allPosts.push(...posts);

        if (allPosts.length === 0) {
            console.log('[SIS v2 Pipeline] ⚠️ No signals found.');
            database._db.prepare(`UPDATE scan_logs SET status = 'completed' WHERE id = ?`).run(scanId);
            return;
        }

        // Step 2: FRESHNESS FILTER (Last 48h)
        const cutoffMs = Date.now() - (48 * 60 * 60 * 1000);
        const freshPosts = allPosts.filter(p => {
            const date = new Date(p.post_created_at || p.scraped_at);
            return isNaN(date.getTime()) || date.getTime() >= cutoffMs;
        });

        console.log(`[SIS v2 Pipeline] 🔍 Total: ${allPosts.length} | Fresh: ${freshPosts.length}`);

        // Step 3: SIS v2 CLASSIFICATION (The AI Brain)
        // This function handles saving to raw_posts and post_classifications
        const classificationResults = await classifyPosts(freshPosts);

        // Step 4: TELEGRAM NOTIFICATION (Filter for High Intent)
        const highIntent = classificationResults.filter(r =>
            (r.intent_score >= 80 || r.pain_score >= 80) && r.recommended_lane !== 'discard'
        );

        if (highIntent.length > 0) {
            await sendSISAlert(highIntent);
        }

        // Finalize Log
        const duration = Math.round((Date.now() - startTime) / 1000);
        const detectedCount = classificationResults.filter(r => r.recommended_lane !== 'discard').length;

        database._db.prepare(`
            UPDATE scan_logs 
            SET posts_found = ?, leads_detected = ?, status = 'completed', duration_seconds = ?
            WHERE id = ?
        `).run(allPosts.length, detectedCount, duration, scanId);

        console.log(`[SIS v2 Pipeline] ✅ Done. Captured ${detectedCount} signals in ${duration}s.`);

    } catch (err) {
        console.error(`[SIS v2 Pipeline] ❌ Error:`, err.message);
        database._db.prepare(`UPDATE scan_logs SET status = 'error', error = ? WHERE id = ?`).run(err.message, scanId);
    }
}

/**
 * Send a modern SIS v2 alert to Telegram
 */
async function sendSISAlert(signals) {
    const time = new Date().toLocaleTimeString('vi-VN');
    let msg = `🎯 <b>SIS v2: HIGH INTENT DETECTED</b>\n🕐 ${time}\n\n`;

    signals.slice(0, 5).forEach((s, i) => {
        const laneEmoji = { resolved_lead: '✅', partial_lead: '⚡', anonymous_signal: '🕵️', competitor_intel: '🕵️‍♀️' };
        const emoji = laneEmoji[s.recommended_lane] || '📍';
        msg += `<b>${i + 1}.</b> ${emoji} [Intent: ${s.intent_score || 0}] <b>${s.author_name || 'Seller'}</b>\n`;
        msg += `💡 <i>Pain: ${s.pain_score || 0} - ${s.reason_summary?.substring(0, 80)}...</i>\n`;
        if (s.post_url) msg += `🔗 <a href="${s.post_url}">View Signal</a>\n\n`;
    });

    if (signals.length > 5) msg += `<i>...and ${signals.length - 5} more signals on dashboard.</i>`;

    await sendMessage(msg.trim());
}

/**
 * Job Polling Loop
 */
async function pollQueue() {
    if (isProcessing) return;
    const job = database.claimNextScan();
    if (!job) return;

    isProcessing = true;
    console.log(`\n[SIS ScraperWorker] 🔒 Claimed Job #${job.id}`);

    try {
        await runSISPipeline({
            platforms: job.platforms ? job.platforms.split(',') : config.ENABLED_PLATFORMS,
            maxPosts: job.max_posts || 200
        });
        database.completeScan(job.id, { totalLeads: 0 }); // Result ignored in SIS v2
    } catch (err) {
        console.error(`[SIS ScraperWorker] ❌ Failed job #${job.id}:`, err.message);
        database.failScan(job.id, err.message);
    } finally {
        isProcessing = false;
    }
}

// Start
console.log('╔══════════════════════════════════════════════════════╗');
console.log('║  🛡️ SIS v2: Signal-Centric Scraper Worker            ║');
console.log('╚══════════════════════════════════════════════════════╝');

setInterval(pollQueue, POLL_INTERVAL);
pollQueue();
