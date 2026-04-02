/**
 * 🤖 Social Agent — Main Orchestrator
 * 
 * Composes all sub-components into a single human-like session flow:
 * 
 *   openFacebook() → warmUp() → checkNotifications() → checkInbox() → coolDown()
 * 
 * Uses existing infrastructure:
 * - accountManager.js — account pool & session management
 * - personalAgent.js — AI draft replies with staff style
 * - humanizer.js — anti-detection behavior
 * 
 * @module agent/social/socialAgent
 */
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const accountManager = require('../accountManager');
const { generateFingerprint } = require('../../../backend/infra/proxy/fingerprint');
const { applyStealthToContext } = require('../../../backend/infra/proxy/stealthScripts');
const { generateAgentReply } = require('../personalAgent');

// ─── Checkpoint Recovery Config ──────────────────────────────────────────────
const MAX_RETRIES_PER_SESSION = 2;

// ─── Sub-components ──────────────────────────────────────────────────────────
const sessionMgr = require('./sessionManager');
const feedBrowser = require('./feedBrowser');
const { checkNotifications } = require('./notificationChecker');
const { checkInbox } = require('./inboxReader');

chromium.use(StealthPlugin());

// ─── State ───────────────────────────────────────────────────────────────────
let _browser = null;
let _activityLog = []; // In-memory ring buffer (last 100)
const MAX_LOG = 100;

/**
 * Log an activity event
 */
function logActivity(sessionId, action, details = '', account = '') {
    const entry = {
        sessionId,
        account,
        action,
        details,
        timestamp: new Date().toISOString(),
    };
    _activityLog.push(entry);
    if (_activityLog.length > MAX_LOG) _activityLog.shift();

    // Also persist to DB if available
    try {
        const db = require('../../../backend/core/data_store/database');
        if (db.logSocialActivity) {
            db.logSocialActivity(account, action, details, sessionId);
        }
    } catch { /* DB not ready yet */ }
}

/**
 * Create authenticated browser context for an account
 * @param {object} account - from accountManager
 * @returns {{ context, page, tag }}
 */
async function createContext(account) {
    if (!_browser || !_browser.isConnected()) {
        _browser = await chromium.launch({
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
            ],
        });
    }

    const fingerprint = generateFingerprint ? generateFingerprint() : {};
    const sessionPath = accountManager.getSessionPath(account);
    const tag = `[Social:${account.email.split('@')[0]}]`;

    // Build context opts from fingerprint (platform-consistent)
    const contextOpts = {
        storageState: sessionPath,
        viewport: fingerprint.viewport || {
            width: 1280 + sessionMgr.randInt(-100, 100),
            height: 720 + sessionMgr.randInt(-50, 50),
        },
        userAgent: fingerprint.userAgent || undefined,
        locale: fingerprint.language ? fingerprint.language.split(',')[0] : 'vi-VN',
        timezoneId: fingerprint.timezone || 'Asia/Ho_Chi_Minh',
        extraHTTPHeaders: {
            'Accept-Language': fingerprint.language || 'vi-VN,vi;q=0.9,en;q=0.8',
        },
    };

    // Add proxy if account has one
    if (account.proxy_url) {
        const proxyUrl = new URL(account.proxy_url);
        contextOpts.proxy = {
            server: `${proxyUrl.protocol}//${proxyUrl.hostname}:${proxyUrl.port}`,
            username: proxyUrl.username || undefined,
            password: proxyUrl.password || undefined,
        };
    }

    const context = await _browser.newContext(contextOpts);

    // Apply stealth scripts BEFORE any navigation
    try {
        await applyStealthToContext(context, fingerprint);
    } catch (e) {
        console.warn(`${tag} ⚠️ Stealth injection partial: ${e.message}`);
    }

    const page = await context.newPage();

    return { context, page, tag };
}

/**
 * Validate session — check if logged in
 * @param {Page} page
 * @param {string} tag
 * @returns {boolean}
 */
async function validateSession(page, tag) {
    try {
        await page.goto('https://www.facebook.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 25000,
        });
        await new Promise(r => setTimeout(r, 3000));

        const url = page.url();
        if (url.includes('login') || url.includes('checkpoint')) {
            console.log(`${tag} ❌ Session expired or checkpoint detected`);
            return false;
        }

        console.log(`${tag} ✅ Session valid`);
        return true;
    } catch (e) {
        console.error(`${tag} ❌ Session validation failed: ${e.message}`);
        return false;
    }
}

/**
 * Handle new message callback — AI drafts a reply
 * @param {string} accountSalesName
 * @param {string} senderName
 * @param {string} message
 * @param {string} convUrl
 */
async function handleNewMessage(accountSalesName, senderName, message, convUrl) {
    console.log(`[SocialAgent] 💭 AI drafting reply for ${senderName}...`);
    try {
        const reply = await generateAgentReply(accountSalesName, message, {
            senderName,
            platform: 'facebook',
        });
        console.log(`[SocialAgent] 🤖 Draft: "${reply.substring(0, 80)}..."`);

        // Save to conversations table
        try {
            const db = require('../../../backend/core/data_store/database');
            db.insertConversation.run({
                sender_id: convUrl,
                sender_name: senderName,
                message: message,
                ai_suggestion: reply,
                intent: 'general',
                platform: 'facebook',
            });
            console.log(`[SocialAgent] 💾 Conversation saved to DB`);
        } catch (e) {
            console.error(`[SocialAgent] ❌ DB save failed: ${e.message}`);
        }
    } catch (e) {
        console.error(`[SocialAgent] ❌ AI draft failed: ${e.message}`);
    }
}

/**
 * Run a single complete session
 * Full flow: open → warmUp → notifications → inbox → coolDown → close
 */
async function runSession() {
    const session = sessionMgr.startSession();
    let retryCount = 0;
    let account = null;
    let context = null;
    let page = null;
    let tag = '';
    let email = '';
    let usedAccounts = new Set();

    // ── Account selection with retry loop ─────────────────────────────────
    while (retryCount <= MAX_RETRIES_PER_SESSION) {
        // Pick an account (exclude already-tried ones)
        account = accountManager.getNextAccount({ preferSocial: true, exclude: [...usedAccounts] });
        if (!account) {
            console.log(`[SocialAgent] ⚠️ No available accounts — skipping session`);
            sessionMgr.endSession();
            return;
        }

        // Check if account should rest
        if (accountManager.shouldRest(account.id || account.email)) {
            usedAccounts.add(account.id || account.email);
            retryCount++;
            continue;
        }

        tag = `[Social:${account.email.split('@')[0]}]`;
        email = account.email;
        usedAccounts.add(account.id || account.email);

        if (retryCount > 0) {
            console.log(`${tag} 🔄 Retry #${retryCount} with different account`);
        }

        console.log(`\n${'═'.repeat(55)}`);
        console.log(`  🤖 SOCIAL AGENT SESSION #${session.sessionNumber}${retryCount > 0 ? ` (retry ${retryCount})` : ''}`);
        console.log(`  📧 Account: ${email}`);
        console.log(`  ⏱️  Duration: ~${Math.round(session.duration / 60000)} min`);
        console.log(`${'═'.repeat(55)}\n`);

        try {
            // Clean up previous context if retrying
            if (context) { try { await context.close(); } catch { } }

            // 2. Open browser
            logActivity(session.sessionId, 'session_start', `Account: ${email}${retryCount > 0 ? ` (retry ${retryCount})` : ''}`, email);
            ({ context, page } = await createContext(account));

            // 3. Validate session
            const valid = await validateSession(page, tag);
            if (!valid) {
                accountManager.reportCheckpoint(account.id || account.email);
                logActivity(session.sessionId, 'checkpoint_detected',
                    `Account checkpointed — ${retryCount < MAX_RETRIES_PER_SESSION ? 'retrying with another' : 'all retries exhausted'}`, email);
                console.log(`${tag} 🚨 Checkpoint! ${retryCount < MAX_RETRIES_PER_SESSION ? 'Switching account...' : 'No more retries.'}`);
                retryCount++;
                continue; // Try next account
            }

            // Session valid — break out of retry loop
            break;
        } catch (e) {
            console.error(`${tag} ❌ Context creation failed: ${e.message}`);
            retryCount++;
            continue;
        }
    }

    // All retries exhausted
    if (retryCount > MAX_RETRIES_PER_SESSION) {
        console.log(`[SocialAgent] 💀 All ${MAX_RETRIES_PER_SESSION} retries exhausted — aborting session`);
        logActivity(session.sessionId, 'session_abort', 'All accounts checkpointed', '');
        sessionMgr.endSession();
        sessionMgr.reportDanger(); // Signal to increase intervals
        try { if (context) await context.close(); } catch { }
        return;
    }

    // ── Main session flow (account validated) ─────────────────────────────
    try {

        // 3.5 PROFILE SETUP (one-time) — bio, cover photo
        try {
            const { ensureProfileSetup } = require('../strategies/profileBuilder');
            console.log(`${tag} 🎨 Phase 0: Profile Check`);
            const profileResult = await ensureProfileSetup(page, account);
            if (!profileResult.skipped) {
                logActivity(session.sessionId, 'profile_setup',
                    `Bio: ${profileResult.bioUpdated ? '✅' : '❌'}, Cover: ${profileResult.coverUpdated ? '✅' : '❌'}`, email);
            }
        } catch (e) {
            console.warn(`${tag} ⚠️ Profile setup skipped: ${e.message}`);
        }

        // 4. WARM-UP — scroll feed, like, stories (2-5 min)
        console.log(`${tag} 🌅 Phase 1: Warm-up`);
        logActivity(session.sessionId, 'warm_up', 'Starting feed browse', email);
        const warmResult = await feedBrowser.warmUp(page);
        logActivity(session.sessionId, 'warm_up', `Posts: ${warmResult.postsRead}, Liked: ${warmResult.liked}`, email);

        // 5. CHECK NOTIFICATIONS
        console.log(`${tag} 🔔 Phase 2: Notifications`);
        logActivity(session.sessionId, 'notification_check', 'Opening notifications', email);
        const notifResult = await checkNotifications(page);
        logActivity(session.sessionId, 'notification_check', `Clicked: ${notifResult.clickedItems}`, email);

        // 6. CHECK INBOX
        console.log(`${tag} 💬 Phase 3: Inbox`);
        logActivity(session.sessionId, 'inbox_check', 'Opening Messenger', email);

        // Determine which sales person this account belongs to
        const salesName = account.sales_name || 'Đức Anh'; // fallback
        const inboxResult = await checkInbox(page, {
            maxConversations: sessionMgr.randInt(3, 6),
            onNewMessage: (sender, msg, url) => handleNewMessage(salesName, sender, msg, url),
        });
        logActivity(session.sessionId, 'inbox_check',
            `Messages: ${inboxResult.newMessages}, Convos: ${inboxResult.conversations.length}`, email);

        // 6.5. AUTOMATED OUTREACH (24/7 Agent Commenting & Engaging)
        console.log(`${tag} 🚀 Phase 3.5: Automated Outreach (Strategies 1 & 2)`);

        try {
            // A) Expert Replier (Auto-Comment)
            const db = require('../../../backend/core/data_store/database');
            const { batchReply } = require('../strategies/expertReplier');

            const hotLeads = db.db.prepare(`
                SELECT * FROM leads 
                WHERE score >= 60 AND post_url IS NOT NULL 
                AND is_anonymous = 1
                AND automatic_comment_sent = 0
                AND status IN ('new', 'hot') 
                ORDER BY score DESC LIMIT 3
            `).all();

            if (hotLeads.length > 0) {
                console.log(`${tag} 💬 Found ${hotLeads.length} leads to comment on`);
                logActivity(session.sessionId, 'expert_reply', `Attempting ${hotLeads.length} AI comments`, email);
                const replyResults = await batchReply(hotLeads, { staffName: salesName, page });
                const successL = replyResults.filter(r => r.success).length;
                logActivity(session.sessionId, 'expert_reply', `Sent ${successL}/${hotLeads.length} comments`, email);
            }

            // B) Profile Engager (Auto-Like/React)
            const { runEngagementSession } = require('../strategies/profileEngager');
            console.log(`${tag} 👀 Engaging profiles...`);
            logActivity(session.sessionId, 'profile_engage', 'Starting profile engagement', email);
            const engageResults = await runEngagementSession(page, { staffName: salesName });
            if (engageResults) {
                logActivity(session.sessionId, 'profile_engage', `Visited ${engageResults.visited}, Engaged ${engageResults.engaged}`, email);
            }
        } catch (strategyErr) {
            console.error(`[SocialAgent] ⚠️ Outreach strategies failed: ${strategyErr.message}`);
        }

        // 7. COOL-DOWN — scroll feed again (1-3 min)
        console.log(`${tag} 🌙 Phase 4: Cool-down`);

        // Navigate back to feed
        await page.goto('https://www.facebook.com/', {
            waitUntil: 'domcontentloaded',
            timeout: 20000,
        });
        await new Promise(r => setTimeout(r, 2000));

        logActivity(session.sessionId, 'cool_down', 'Winding down', email);
        const coolResult = await feedBrowser.coolDown(page);
        logActivity(session.sessionId, 'cool_down', `Posts: ${coolResult.postsRead}, Liked: ${coolResult.liked}`, email);

        // 8. Success
        accountManager.reportSuccess(account.id || account.email, 0);
        sessionMgr.reportSafe(); // Reduce danger level after success
        logActivity(session.sessionId, 'session_end', 'Completed successfully', email);

        console.log(`\n${tag} ✅ Session complete!`);

    } catch (e) {
        console.error(`[SocialAgent] ❌ Session error: ${e.message}`);
        logActivity(session.sessionId, 'session_error', e.message, email);
    } finally {
        try { if (context) await context.close(); } catch { }
        sessionMgr.endSession();
    }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Start the Social Agent loop
 */
function start() {
    console.log(`[SocialAgent] 🚀 Starting Social Agent...`);
    sessionMgr.start(runSession);
}

/**
 * Stop the Social Agent loop
 */
async function stop() {
    console.log(`[SocialAgent] 🛑 Stopping Social Agent...`);
    sessionMgr.stop();
    if (_browser) {
        try { await _browser.close(); } catch { }
        _browser = null;
    }
}

/**
 * Get current status
 */
function getStatus() {
    return {
        ...sessionMgr.getStatus(),
        recentActivity: _activityLog.slice(-20),
    };
}

/**
 * Get full activity log
 */
function getActivityLog(limit = 50) {
    return _activityLog.slice(-limit);
}

module.exports = {
    start,
    stop,
    getStatus,
    getActivityLog,
    runSession, // exposed for manual trigger
};
