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
 */

const { chromium } = require('playwright');
const database = require('../../core/data_store/database');
const accountManager = require('../../../ai/agents/accountManager');
const { getAuthContext } = require('../scraper/authContext');
const { resolveProfile } = require('../scraper/profileScraper');

const POLL_INTERVAL = 60000; // 60s
let isProcessing = false;

async function runSISIdentityWorker() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        // 1. Find a Classification that needs more clues
        // Priority: partial_lead > anonymous_signal
        const target = database._db.prepare(`
            SELECT pc.*, rp.author_profile_url, rp.author_name, rp.platform
            FROM post_classifications pc
            JOIN raw_posts rp ON pc.raw_post_id = rp.id
            WHERE pc.recommended_lane IN ('partial_lead', 'anonymous_signal')
            AND pc.resolution_confidence < 90
            AND rp.author_profile_url IS NOT NULL
            ORDER BY pc.intent_score DESC
            LIMIT 1
        `).get();

        if (!target) {
            isProcessing = false;
            return;
        }

        console.log(`[SIS Identity] 🔍 Investigating Clues for: ${target.author_name} (Signal #${target.id})`);

        // 2. Resolve Profile (Websites, Emails, Pages)
        const account = accountManager.getNextAccount({ forScraping: true });
        if (!account) {
            console.warn('[SIS Identity] ⚠️ No accounts available for scraping');
            isProcessing = false;
            return;
        }

        let browser = null;
        try {
            browser = await chromium.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-dev-shm-usage']
            });

            const context = await getAuthContext(account, browser);
            const page = await context.newPage();

            // ── HUNTING PHASE ──
            const resolved = await resolveProfile(page, target.author_profile_url);

            if (resolved && resolved.ok) {
                // 3. SYNTHESIS PHASE (Transaction)
                database._db.transaction(() => {
                    // a) Find/Create Account Card
                    // Check if we already have an identity for this author_profile_url
                    let accId = database.findAccountByIdentity('fb_profile', target.author_profile_url);
                    if (!accId) {
                        accId = database.insertAccount({
                            brand_name: target.author_name || 'Anonymous Seller',
                            status: 'lead'
                        });
                        database.insertIdentity({ account_id: accId, type: 'fb_profile', value: target.author_profile_url, discovered_from: 'signal_scrape' });
                    }

                    // b) Save discovered clues
                    const insertIden = (type, val) => {
                        try { database.insertIdentity({ account_id: accId, type, value: val, discovered_from: 'identity_worker' }); } catch (e) { }
                    };

                    let newClues = 0;
                    (resolved.emails || []).forEach(e => { insertIden('email', e); newClues++; });
                    (resolved.websites || []).forEach(w => { insertIden('website', w); newClues++; });
                    (resolved.pages || []).forEach(p => { insertIden('fb_page', p); newClues++; });
                    (resolved.phones || []).forEach(ph => { insertIden('phone', ph); newClues++; });

                    // c) update resolution score
                    const newConfidence = Math.min(100, target.resolution_confidence + (newClues * 15) + (resolved.websites.length > 0 ? 30 : 0));
                    const newLane = newConfidence >= 80 ? 'resolved_lead' : target.recommended_lane;

                    database._db.prepare(`
                        UPDATE post_classifications 
                        SET resolution_confidence = ?, recommended_lane = ?
                        WHERE id = ?
                    `).run(newConfidence, newLane, target.id);

                    console.log(`[SIS Identity] ✅ Identity Updated: Confidence ${target.resolution_confidence} -> ${newConfidence} | Lane: ${newLane}`);

                    // d) Update Account main fields if we found a website
                    if (resolved.websites.length > 0) {
                        database._db.prepare(`UPDATE accounts SET primary_domain = ? WHERE id = ? AND (primary_domain IS NULL OR primary_domain = '')`)
                            .run(resolved.websites[0], accId);
                    }
                })();
            }

            await page.close();
        } catch (err) {
            console.error(`[SIS Identity] 💥 Task failed:`, err.message);
        } finally {
            if (browser) await browser.close();
        }

    } catch (err) {
        console.error(`[SIS Identity] ❌ Loop error:`, err.message);
    } finally {
        isProcessing = false;
    }
}

// Start Worker
console.log(`[SIS Identity] 🚀 SIS v2 Identity Worker Started. Polling every ${POLL_INTERVAL / 1000}s`);
setInterval(runSISIdentityWorker, POLL_INTERVAL);
runSISIdentityWorker(); 
