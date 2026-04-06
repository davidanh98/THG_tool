/**
 * Outreach Worker — Phase 7 Bridge
 *
 * Kết nối SIS v2 pipeline với Squad comment/DM queue.
 *
 * Flow:
 *   post_classifications (intent_score >= 70, comment_queued = 0)
 *     → push 'comment' task vào squadDB
 *     → với resolved_lead có phone/email → push 'dm' task
 *     → mark comment_queued = 1 để tránh duplicate
 *
 * Giới hạn an toàn:
 *   - Chỉ chạy trong giờ hoạt động (8h-22h VN)
 *   - Tối đa MAX_QUEUE_PER_CYCLE task mỗi lần
 *   - Tôn trọng IS_ACTIVE flag từ Risk Agent
 */

'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', '..', '..', 'data', 'leads.db');
const squadDB = require('../../../ai/squad/core/squadDB');

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 phút
const MAX_QUEUE_PER_CYCLE = 10;          // Tối đa 10 task/lần chạy
const MIN_INTENT_SCORE = 70;             // Chỉ queue lead có score >= 70

// ─── DB Setup ────────────────────────────────────────────────────────────────
let _db;
function getDB() {
    if (!_db) {
        _db = new Database(DB_PATH);
        _db.pragma('journal_mode = WAL');

        // Thêm cột tracking nếu chưa có
        try {
            _db.exec(`ALTER TABLE post_classifications ADD COLUMN comment_queued INTEGER DEFAULT 0`);
            console.log('[OutreachWorker] ✅ Added comment_queued column');
        } catch { /* already exists */ }

        try {
            _db.exec(`ALTER TABLE post_classifications ADD COLUMN dm_queued INTEGER DEFAULT 0`);
        } catch { /* already exists */ }
    }
    return _db;
}

// ─── Time Window Check ───────────────────────────────────────────────────────
function isInActiveWindow() {
    // VN time = UTC+7
    const vnHour = (new Date().getUTCHours() + 7) % 24;
    return vnHour >= 8 && vnHour <= 22;
}

// ─── Main Worker ─────────────────────────────────────────────────────────────
async function runOutreachWorker() {
    // 1. Check Risk Agent pause
    try {
        const { getConfig } = require('../../../ai/agents/riskAgent');
        if (getConfig('IS_ACTIVE') === '0') {
            console.log('[OutreachWorker] ⏸️ Paused by Risk Agent — skipping');
            return;
        }
    } catch { /* riskAgent not loaded */ }

    // 2. Check active time window
    if (!isInActiveWindow()) {
        console.log('[OutreachWorker] 🌙 Outside active hours (8h-22h VN) — skipping');
        return;
    }

    const db = getDB();

    // 3. Fetch high-intent leads not yet queued
    const candidates = db.prepare(`
        SELECT
            pc.id,
            pc.raw_post_id,
            pc.intent_score,
            pc.pain_score,
            pc.recommended_lane,
            pc.identity_clues,
            pc.reason_summary,
            pc.comment_queued,
            pc.dm_queued,
            rp.post_url,
            rp.author_name,
            rp.content
        FROM post_classifications pc
        JOIN raw_posts rp ON pc.raw_post_id = rp.id
        WHERE pc.recommended_lane != 'discard'
          AND pc.comment_queued = 0
          AND rp.post_url IS NOT NULL
          AND rp.post_url != ''
          AND (pc.intent_score >= ? OR pc.pain_score >= ?)
        ORDER BY pc.intent_score DESC
        LIMIT ?
    `).all(MIN_INTENT_SCORE, MIN_INTENT_SCORE, MAX_QUEUE_PER_CYCLE);

    if (candidates.length === 0) {
        console.log('[OutreachWorker] 📭 No new high-intent leads to queue');
        return;
    }

    console.log(`[OutreachWorker] 🎯 Found ${candidates.length} leads to queue`);

    let commentQueued = 0;
    let dmQueued = 0;

    for (const lead of candidates) {
        // ── Queue comment task ──
        const taskId = squadDB.pushTask('comment', lead.post_url, {
            leadId: lead.id,
            keyword: lead.recommended_lane,
        });

        if (taskId) {
            commentQueued++;
            console.log(`[OutreachWorker] 💬 Queued comment for "${(lead.author_name || 'Unknown').substring(0, 30)}" (intent=${lead.intent_score})`);
        }

        // ── Queue DM task for resolved leads with contact info ──
        if (
            lead.recommended_lane === 'resolved_lead' &&
            lead.dm_queued === 0 &&
            lead.identity_clues
        ) {
            try {
                const clues = JSON.parse(lead.identity_clues);
                const hasContact = (clues.phones && clues.phones.length > 0) ||
                    (clues.emails && clues.emails.length > 0);

                if (hasContact && lead.post_url) {
                    const dmTaskId = squadDB.pushTask('dm', lead.post_url, {
                        leadId: lead.id,
                        keyword: 'resolved_lead',
                    });

                    if (dmTaskId) {
                        dmQueued++;
                        console.log(`[OutreachWorker] 📩 Queued DM for resolved lead #${lead.id}`);

                        // Mark dm_queued
                        db.prepare(`UPDATE post_classifications SET dm_queued = 1 WHERE id = ?`).run(lead.id);
                    }
                }
            } catch { /* invalid JSON in identity_clues */ }
        }

        // Mark comment_queued regardless (to prevent re-queuing)
        db.prepare(`UPDATE post_classifications SET comment_queued = 1 WHERE id = ?`).run(lead.id);
    }

    console.log(`[OutreachWorker] ✅ Done: ${commentQueued} comments + ${dmQueued} DMs queued`);
}

// ─── Start Daemon ─────────────────────────────────────────────────────────────
console.log('╔══════════════════════════════════════════════════════╗');
console.log('║  🚀 Outreach Worker — Phase 7 Bridge                 ║');
console.log('║  SIS v2 Signals → Squad Comment/DM Queue             ║');
console.log('╚══════════════════════════════════════════════════════╝');

// Run immediately, then every 5 min
runOutreachWorker().catch(e => console.error('[OutreachWorker] ❌', e.message));
setInterval(() => {
    runOutreachWorker().catch(e => console.error('[OutreachWorker] ❌', e.message));
}, POLL_INTERVAL_MS);
