/**
 * Identity Resolver Worker — Phase 3
 * 
 * Polls for qualified leads and resolves their business identities (Fanpages, Websites, Emails).
 */
const { chromium, delay } = require('../scraper/browserManager');
const { getAuthContext } = require('../scraper/authContext');
const { resolveProfile } = require('../scraper/profileScraper');
const database = require('../../core/data_store/database');
const accountManager = require('../../../ai/agents/accountManager');

const POLL_INTERVAL = 45000; // 45 seconds (don't rush identity resolution)
const MIN_SCORE = 70;
let isProcessing = false;

async function runIdentityResolution() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        // 1. Find a qualified lead that hasn't been resolved yet
        const lead = database.db.prepare(`
            SELECT * FROM leads 
            WHERE account_id IS NULL 
            AND score >= ? 
            AND author_url IS NOT NULL 
            AND author_url != ''
            AND status != 'ignored'
            ORDER BY score DESC 
            LIMIT 1
        `).get(MIN_SCORE);

        if (!lead) {
            isProcessing = false;
            return;
        }

        console.log(`[IdentityWorker] 🎯 Target: ${lead.author_name} (Lead #${lead.id}, Score: ${lead.score})`);

        // 2. Get available account
        const account = accountManager.getNextAccount({ forScraping: true });
        if (!account) {
            console.warn('[IdentityWorker] ⚠️ No accounts available for identity resolution');
            isProcessing = false;
            return;
        }

        let browser = null;
        try {
            browser = await chromium.launch({
                headless: true,
                executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
                args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
            });

            const context = await getAuthContext(account, browser);
            const page = await context.newPage();

            const identity = await resolveProfile(page, lead.author_url);

            if (identity && identity.ok) {
                // 3. Save to Database (Transaction)
                database.db.transaction(() => {
                    // a) Create/Find Account
                    // To keep it simple, we use the author_name as the initial brand name
                    const brandName = lead.author_name || 'Prospect';
                    const mainDomain = identity.websites[0] || '';
                    const mainEmail = identity.emails[0] || '';

                    const accResult = database.db.prepare(`
                        INSERT INTO accounts (brand_name, primary_domain, primary_email, status, category)
                        VALUES (?, ?, ?, 'lead', ?)
                    `).run(brandName, mainDomain, mainEmail, lead.category || 'General');

                    const accountId = accResult.lastInsertRowid;

                    // b) Save Identities
                    const insertIden = database.db.prepare(`
                        INSERT INTO identities (account_id, type, value, discovered_from)
                        VALUES (?, ?, ?, ?)
                    `);

                    identity.emails.forEach(email => insertIden.run(accountId, 'email', email, 'profile_scrape'));
                    identity.phones.forEach(phone => insertIden.run(accountId, 'phone', phone, 'profile_scrape'));
                    identity.websites.forEach(web => insertIden.run(accountId, 'website', web, 'profile_scrape'));
                    identity.pages.forEach(pageUrl => insertIden.run(accountId, 'fb_page', pageUrl, 'profile_scrape'));

                    // c) Link Lead to Account
                    database.db.prepare(`UPDATE leads SET account_id = ? WHERE id = ?`)
                        .run(accountId, lead.id);

                    console.log(`[IdentityWorker] ✅ Resolved Lead #${lead.id} → Account #${accountId}`);
                })();
            } else {
                console.warn(`[IdentityWorker] ⚠️ Failed for Lead #${lead.id}: ${identity?.error || 'Unknown error'}`);
                // Tag it so we don't retry immediately? (Optional: increment a resolution_attempts column)
            }

            await page.close();
        } catch (err) {
            console.error(`[IdentityWorker] 💥 Task failed: ${err.message}`);
        } finally {
            if (browser) await browser.close();
        }

    } catch (err) {
        console.error(`[IdentityWorker] ❌ Worker loop error: ${err.message}`);
    } finally {
        isProcessing = false;
    }
}

// Start the loop
console.log(`[IdentityWorker] 🚀 Started (Polling every ${POLL_INTERVAL / 1000}s)`);
setInterval(runIdentityResolution, POLL_INTERVAL);
runIdentityResolution(); // Run once immediately
