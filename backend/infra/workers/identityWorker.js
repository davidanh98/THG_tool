/**
 * SIS v2 Identity Resolver — Clue-Centric Logic
 * 
 * Instead of just "finding a website", this worker resolves "Identity Clues"
 * into unified Account Cards. 
 * 
 * Logic:
 * 1. Poll post_classifications for Partials (lane='partial_lead' or 'anonymous_signal').
 * 2. Scrape author profiles or follow AI-suggested clues.
 * 3. Update 'accounts' and 'identities' tables.
 * 4. Sync resolution_confidence back to the classification record.
 * 
 * [FIX v2.5]
 *  - browser.close() wrapped in try/catch → prevents isProcessing deadlock
 *  - Checkpoint-blocked accounts are skipped gracefully
 *  - cdpSession crash no longer freezes the worker loop
 *  - [NEW] Signal failure tracking → prevents infinite loop & OOM on unreachable profiles
 */

const { chromium } = require('playwright');
const database = require('../../core/data_store/database');
const accountManager = require('../../../ai/agents/accountManager');
const { getAuthContext } = require('../scraper/authContext');
const { resolveProfile } = require('../scraper/profileScraper');

const POLL_INTERVAL = 60000; // 60s

// ─── Track checkpoint-blocked accounts to skip them ───────────────────────────
const blockedAccounts = new Map();
const BLOCK_COOLDOWN_MS = 60 * 60 * 1000; // Skip blocked accounts for 1 hour

// ─── Track signals that keep failing — prevent infinite loop & OOM ──────────
const signalFailures = new Map();
const MAX_SIGNAL_ATTEMPTS = 3;   // After 3 fails → retire signal
const SKIP_COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

function shouldSkipSignal(signalId) {
    var rec = signalFailures.get(signalId);
    if (!rec) return false;
    if (rec.attempts < MAX_SIGNAL_ATTEMPTS) return false;

    if (Date.now() - rec.firstFailAt > SKIP_COOLDOWN_MS) {
        signalFailures.delete(signalId); // Allow retry after cooldown
        return false;
    }
    return true;
}

function recordSignalFailure(signalId) {
    var rec = signalFailures.get(signalId) || { attempts: 0, firstFailAt: Date.now() };
    rec.attempts++;
    signalFailures.set(signalId, rec);
    console.warn('[SIS Identity] ⚠️  Signal #' + signalId + ' failed ' + rec.attempts + '/' + MAX_SIGNAL_ATTEMPTS);

    if (rec.attempts >= MAX_SIGNAL_ATTEMPTS) {
        try {
            database._db.prepare(
                'UPDATE post_classifications SET resolution_confidence = 90, ' +
                'reason_summary = COALESCE(reason_summary, "") || " [identity_worker: profile_unreachable]" ' +
                'WHERE id = ? AND resolution_confidence < 90'
            ).run(signalId);
            console.warn('[SIS Identity] 🚫 Signal #' + signalId + ' retired (unreachable).');
        } catch (e) {
            console.error('[SIS Identity] DB Update failed: ' + e.message);
        }
    }
}

function isAccountBlocked(account) {
    const key = account.id || account.uid || account.email || String(account);
    const blockedAt = blockedAccounts.get(key);
    if (!blockedAt) return false;
    if (Date.now() - blockedAt > BLOCK_COOLDOWN_MS) {
        blockedAccounts.delete(key);
        return false;
    }
    return true;
}

function markAccountBlocked(account) {
    const key = account.id || account.uid || account.email || String(account);
    console.warn('[SIS Identity] 🚫 Marking account blocked (checkpoint): ' + key);
    blockedAccounts.set(key, Date.now());
}

async function safeBrowserClose(browser) {
    if (!browser) return;
    try {
        await browser.close();
    } catch (e) {
        if (process.env.DEBUG_DB) console.log('[SIS Identity] Browser already closed: ' + e.message);
    }
}

// ─── Main Worker Loop ─────────────────────────────────────────────────────────
let isProcessing = false;

async function runSISIdentityWorker() {
    if (isProcessing) return;
    isProcessing = true;

    let browser = null;

    try {
        const target = database._db.prepare(`
      SELECT pc.*, rp.author_profile_url, rp.author_name, rp.source_platform AS platform
      FROM post_classifications pc
      JOIN raw_posts rp ON pc.raw_post_id = rp.id
      WHERE pc.recommended_lane IN ('partial_lead', 'anonymous_signal')
        AND pc.resolution_confidence < 90
        AND rp.author_profile_url IS NOT NULL
        AND rp.author_profile_url != ''
      ORDER BY pc.intent_score DESC
      LIMIT 1
    `).get();

        if (!target) {
            isProcessing = false;
            return;
        }

        if (shouldSkipSignal(target.id)) {
            isProcessing = false;
            return;
        }

        console.log('[SIS Identity] 🔍 Investigating: ' + target.author_name + ' (Signal #' + target.id + ')');

        let account = null;
        let attempts = 0;
        while (attempts < 5) {
            const candidate = accountManager.getNextAccount({ forScraping: true });
            if (!candidate) break;
            if (!isAccountBlocked(candidate)) { account = candidate; break; }
            attempts++;
        }

        if (!account) {
            console.warn('[SIS Identity] ⚠️ No unblocked accounts.');
            isProcessing = false;
            return;
        }

        try {
            browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
            const context = await getAuthContext(account, browser);
            const page = await context.newPage();

            const resolved = await resolveProfile(page, target.author_profile_url);

            if (resolved && resolved.checkpoint) {
                markAccountBlocked(account);
                await page.close().catch(() => { });
                isProcessing = false;
                return;
            }

            if (resolved && resolved.ok) {
                database._db.transaction(() => {
                    let accId = database.findAccountByIdentity('fb_profile', target.author_profile_url);
                    if (!accId) {
                        accId = database.insertAccount({ brand_name: target.author_name || 'Anonymous', status: 'lead' });
                        database.insertIdentity({ account_id: accId, type: 'fb_profile', value: target.author_profile_url, discovered_from: 'signal_scrape' });
                    }

                    const insertIden = (type, val) => {
                        try { database.insertIdentity({ account_id: accId, type: type, value: val, discovered_from: 'identity_worker' }); } catch (e) { }
                    };

                    let newClues = 0;
                    (resolved.emails || []).forEach(e => { insertIden('email', e); newClues++; });
                    (resolved.websites || []).forEach(w => { insertIden('website', w); newClues++; });
                    (resolved.pages || []).forEach(p => { insertIden('fb_page', p); newClues++; });
                    (resolved.phones || []).forEach(ph => { insertIden('phone', ph); newClues++; });

                    let websiteBonus = (resolved.websites && resolved.websites.length > 0) ? 30 : 0;
                    let newConfidence = Math.min(100, target.resolution_confidence + (newClues * 15) + websiteBonus);
                    let newLane = newConfidence >= 80 ? 'resolved_lead' : target.recommended_lane;

                    database._db.prepare('UPDATE post_classifications SET resolution_confidence = ?, recommended_lane = ? WHERE id = ?').run(newConfidence, newLane, target.id);
                    console.log('[SIS Identity] ✅ Updated Signal #' + target.id + ' | Conf: ' + newConfidence);
                })();
            } else {
                console.warn('[SIS Identity] ⚠️ resolveProfile failed for Signal #' + target.id);
                recordSignalFailure(target.id);
            }
            await page.close().catch(() => { });

        } catch (innerErr) {
            const msg = innerErr.message || '';
            if (msg.includes('CHECKPOINT') || msg.includes('Target closed') || msg.includes('cdpSession')) {
                markAccountBlocked(account);
            } else {
                console.error('[SIS Identity] 💥 Task failed: ' + msg);
                recordSignalFailure(target.id);
            }
        }

    } catch (outerErr) {
        console.error('[SIS Identity] ❌ Loop error: ' + outerErr.message);
    } finally {
        await safeBrowserClose(browser);
        isProcessing = false;
    }
}

console.log('[SIS Identity] Started. Polling 60s.');
setInterval(runSISIdentityWorker, POLL_INTERVAL);
runSISIdentityWorker();
