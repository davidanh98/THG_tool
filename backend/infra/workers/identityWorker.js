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
 */

const { chromium } = require('playwright');
const database = require('../../core/data_store/database');
const accountManager = require('../../../ai/agents/accountManager');
const { getAuthContext } = require('../scraper/authContext');
const { resolveProfile } = require('../scraper/profileScraper');

const POLL_INTERVAL = 60000; // 60s

// ─── Track checkpoint-blocked accounts to skip them ───────────────────────────
// Key: account identifier, Value: timestamp blocked
const blockedAccounts = new Map();
const BLOCK_COOLDOWN_MS = 60 * 60 * 1000; // Skip blocked accounts for 1 hour

function isAccountBlocked(account) {
    const key = account.id || account.uid || account.email || String(account);
    const blockedAt = blockedAccounts.get(key);
    if (!blockedAt) return false;
    if (Date.now() - blockedAt > BLOCK_COOLDOWN_MS) {
        blockedAccounts.delete(key); // Cooldown expired, allow retry
        return false;
    }
    return true;
}

function markAccountBlocked(account) {
    const key = account.id || account.uid || account.email || String(account);
    console.warn('[SIS Identity] 🚫 Marking account as blocked (checkpoint): ' + key);
    blockedAccounts.set(key, Date.now());
}

// ─── Safe browser close — never throws ───────────────────────────────────────
async function safeBrowserClose(browser) {
    if (!browser) return;
    try {
        await browser.close();
    } catch (e) {
        // Browser already dead (cdpSession closed, checkpoint crash, etc.)
        // This is expected — swallow silently
        if (process.env.DEBUG_DB) {
            console.log('[SIS Identity] ℹ️  Browser already closed: ' + e.message);
        }
    }
}

// ─── Main Worker Loop ─────────────────────────────────────────────────────────
let isProcessing = false;

async function runSISIdentityWorker() {
    if (isProcessing) return;
    isProcessing = true;

    let browser = null;

    try {
        // 1. Find a Classification that needs more clues
        // Priority: partial_lead > anonymous_signal
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
            return; // Nothing to process
        }

        console.log('[SIS Identity] 🔍 Investigating Clues for: ' + target.author_name + ' (Signal #' + target.id + ')');

        // 2. Get a non-blocked account for scraping
        let account = null;
        let attempts = 0;
        const MAX_ACCOUNT_ATTEMPTS = 5;

        while (attempts < MAX_ACCOUNT_ATTEMPTS) {
            const candidate = accountManager.getNextAccount({ forScraping: true });
            if (!candidate) break;
            if (!isAccountBlocked(candidate)) {
                account = candidate;
                break;
            }
            attempts++;
            console.warn('[SIS Identity] ⏭️  Skipping blocked account, trying next...');
        }

        if (!account) {
            console.warn('[SIS Identity] ⚠️  No unblocked accounts available. Will retry next cycle.');
            isProcessing = false;
            return;
        }

        // 3. Launch browser and resolve profile
        try {
            browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-dev-shm-usage']
            });

            const context = await getAuthContext(account, browser);
            const page = await context.newPage();

            // ── HUNTING PHASE ──
            const resolved = await resolveProfile(page, target.author_profile_url);

            // Detect checkpoint during profile scrape
            if (resolved && resolved.checkpoint) {
                markAccountBlocked(account);
                console.warn('[SIS Identity] 🚨 Checkpoint hit during profile scrape. Account blocked for 1h.');
                try { await page.close(); } catch (e) { }
                isProcessing = false;
                return;
            }

            if (resolved && resolved.ok) {
                // 4. SYNTHESIS PHASE (Transaction)
                database._db.transaction(() => {
                    // a) Find/Create Account Card
                    let accId = database.findAccountByIdentity('fb_profile', target.author_profile_url);
                    if (!accId) {
                        accId = database.insertAccount({
                            brand_name: target.author_name || 'Anonymous Seller',
                            status: 'lead'
                        });
                        database.insertIdentity({
                            account_id: accId,
                            type: 'fb_profile',
                            value: target.author_profile_url,
                            discovered_from: 'signal_scrape'
                        });
                    }

                    // b) Save discovered clues
                    const insertIden = function (type, val) {
                        try {
                            database.insertIdentity({
                                account_id: accId,
                                type: type,
                                value: val,
                                discovered_from: 'identity_worker'
                            });
                        } catch (e) {
                            // Duplicate clue — ignore
                        }
                    };

                    var newClues = 0;
                    (resolved.emails || []).forEach(function (e) { insertIden('email', e); newClues++; });
                    (resolved.websites || []).forEach(function (w) { insertIden('website', w); newClues++; });
                    (resolved.pages || []).forEach(function (p) { insertIden('fb_page', p); newClues++; });
                    (resolved.phones || []).forEach(function (ph) { insertIden('phone', ph); newClues++; });

                    // c) Update resolution score
                    var websiteBonus = (resolved.websites && resolved.websites.length > 0) ? 30 : 0;
                    var newConfidence = Math.min(100, target.resolution_confidence + (newClues * 15) + websiteBonus);
                    var newLane = newConfidence >= 80 ? 'resolved_lead' : target.recommended_lane;

                    database._db.prepare(
                        'UPDATE post_classifications SET resolution_confidence = ?, recommended_lane = ? WHERE id = ?'
                    ).run(newConfidence, newLane, target.id);

                    console.log(
                        '[SIS Identity] ✅ Identity Updated: Confidence ' +
                        target.resolution_confidence + ' -> ' + newConfidence +
                        ' | Lane: ' + newLane
                    );

                    // d) Update Account primary domain if found
                    if (resolved.websites && resolved.websites.length > 0) {
                        database._db.prepare(
                            'UPDATE accounts SET primary_domain = ? WHERE id = ? AND (primary_domain IS NULL OR primary_domain = "")'
                        ).run(resolved.websites[0], accId);
                    }
                })();
            }

            // Close page cleanly
            try { await page.close(); } catch (e) { }

        } catch (innerErr) {
            var msg = innerErr.message || '';

            // Detect checkpoint/session errors from Playwright
            var isCheckpoint = msg.includes('CHECKPOINT') ||
                msg.includes('checkpoint') ||
                msg.includes('Target page') ||
                msg.includes('context') ||
                msg.includes('browser') ||
                msg.includes('cdpSession') ||
                msg.includes('Session invalid') ||
                msg.includes('Target closed');

            if (isCheckpoint) {
                markAccountBlocked(account);
                console.warn('[SIS Identity] 🚨 Session/Checkpoint error — account blocked: ' + msg);
            } else {
                console.error('[SIS Identity] 💥 Task failed: ' + msg);
            }
        }

    } catch (outerErr) {
        console.error('[SIS Identity] ❌ Loop error: ' + outerErr.message);
    } finally {
        // ✅ [FIX] Safe close — never throws, never deadlocks isProcessing
        await safeBrowserClose(browser);
        isProcessing = false;
    }
}

// ─── Start Worker ─────────────────────────────────────────────────────────────
console.log('[SIS Identity] 🚀 SIS v2 Identity Worker Started. Polling every ' + (POLL_INTERVAL / 1000) + 's');
setInterval(runSISIdentityWorker, POLL_INTERVAL);
runSISIdentityWorker();
