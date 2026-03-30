/**
 * Webhook Routes — Facebook Messenger + Telegram alerts + Lead Ads
 */
const router = require('express').Router();
const express = require('express');
const axios = require('axios');
const database = require('../core/data_store/database');
const { generateCopilotReply, classifyIntent, classifyService } = require('../../ai/prompts/salesCopilot');

// ── Service → Staff mapping (reads from DB settings, fallback to defaults) ──
function getServiceStaffMap() {
    try {
        const override = database.getSetting('SERVICE_STAFF_MAP', null);
        const defaults = { warehouse: 'Hạnh', express: 'Lê Huyền', pod: 'Moon', quote_needed: 'Thư', unknown: null };
        if (override) return { ...defaults, ...JSON.parse(override) };
        return defaults;
    } catch (e) {
        return { warehouse: 'Hạnh', express: 'Lê Huyền', pod: 'Moon', quote_needed: 'Thư', unknown: null };
    }
}

// ── Telegram Alert Helper ───────────────────────────────────────────────────
async function sendTelegramAlert(senderId, message, aiSuggestion, intent) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId || token === 'your_telegram_bot_token') return;

    const intentEmojis = {
        price_inquiry: '💰', service_inquiry: '📋',
        urgent_need: '🔥', general: '💬', spam: '🚫',
    };

    const text = `⚡ *KHÁCH INBOX FB PAGE / LEAD AD* ⚡\n\n${intentEmojis[intent] || '💬'} *Intent:* ${intent}\n🗣️ *Khách / Form nói:*\n"${message.substring(0, 300)}"\n\n🤖 *AI Copilot soạn sẵn:*\n\`${aiSuggestion.substring(0, 500)}\`\n\n👉 _Sale vào Dashboard → Inbox để review & gửi!_`;

    try {
        await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
            chat_id: chatId, text, parse_mode: 'Markdown',
        });
        console.log('[Telegram] 📲 Alert sent!');
    } catch (err) {
        console.error('[Telegram] ✗', err.message);
    }
}

// ── Facebook Lead Ads API Fetcher ──────────────────────────────────────────
async function fetchLeadDetails(leadId, pageId, adId) {
    try {
        const tokens = [
            process.env.FB_PAGE_TOKEN_WAREHOUSE,
            process.env.FB_PAGE_TOKEN_EXPRESS,
            process.env.FB_PAGE_TOKEN_FULFILLMENT
        ].filter(Boolean);

        for (const token of tokens) {
            try {
                const res = await axios.get(`https://graph.facebook.com/v19.0/${leadId}?access_token=${token}`);
                const leadData = res.data;
                const formattedLead = (leadData.field_data || []).map(f => `- ${f.name}: ${f.values[0]}`).join('\n');

                const senderId = 'leadad_' + leadId;
                const messageText = `[FACEBOOK LEAD AD - AdID: ${adId || 'N/A'}]\nThông tin Form:\n${formattedLead}`;

                const convId = database.upsertMetaConversation({
                    external_id: senderId,
                    platform: 'lead_ad',
                    status: 'pending',
                    last_message_at: new Date().toISOString(),
                    unread_count: 1
                });

                database.upsertMetaParticipant({
                    conversation_id: convId,
                    participant_id: senderId,
                    name: 'Facebook Lead',
                    profile_pic: pageId
                });

                database.insertMetaMessage({
                    conversation_id: convId,
                    sender_id: senderId,
                    sender_role: 'customer',
                    message_text: messageText,
                    attachments_json: [],
                    created_at: new Date().toISOString()
                });

                const aiSuggestion = await generateCopilotReply(messageText, { senderName: 'Facebook Lead Form', platform: 'lead_ad' });
                database.insertMetaMessage({
                    conversation_id: convId,
                    sender_id: 'bot_draft',
                    sender_role: 'ai_draft',
                    message_text: aiSuggestion,
                    attachments_json: [],
                    created_at: new Date().toISOString()
                });

                await sendTelegramAlert(senderId, messageText, aiSuggestion, 'service_inquiry');
                console.log(`[Webhook] ✅ Đã lưu Lead Ads ${leadId} vào CRM.`);
                return;
            } catch (err) { }
        }
        console.error(`[Webhook] ❌ Không thể fetch thông tin cho Lead ID ${leadId} bằng các token đang có.`);
    } catch (err) {
        console.error('[Webhook/LeadAd] Error:', err.message);
    }
}

// ── GET /webhook — Facebook verification ────────────────────────────────────
router.get('/webhook', (req, res) => {
    const VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'thg_verify_2024';
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
        console.log('[Webhook] ✅ Facebook verified!');
        res.status(200).send(challenge);
    } else {
        console.warn('[Webhook] ❌ Verification failed');
        res.sendStatus(403);
    }
});

// ── POST /webhook — Receive messages and Ads from Meta ──────────────────────
router.post('/webhook', async (req, res) => {
    const body = req.body;
    res.status(200).send('EVENT_RECEIVED'); // fast ack to Facebook

    if (body.object !== 'page') return;

    for (const entry of (body.entry || [])) {
        const pageId = entry.id;

        // 1. Process Lead Ads (changes)
        if (entry.changes) {
            for (const change of entry.changes) {
                if (change.field === 'leadgen') {
                    const leadId = change.value.leadgen_id;
                    const adId = change.value.ad_id;
                    console.log(`[Webhook] 📣 Nhận Facebook Lead Ad mới! LeadGen ID: ${leadId}`);
                    // Fetch details in background
                    fetchLeadDetails(leadId, pageId, adId);
                }
            }
        }

        // 2. Process Messaging (Inbox + Click to Messenger Ads)
        for (const event of (entry.messaging || [])) {
            const refObj = event.referral || event.postback?.referral || event.message?.referral;
            const referralRef = refObj?.ref || (refObj?.source === 'ADS' ? `[ADS] AdID: ${refObj.ad_id}` : null);

            if (referralRef) {
                console.log(`[Webhook] 🔗 Referral/Ads Triggered: ${referralRef} từ ${event.sender.id}`);
            }

            if (!event.message?.text && !referralRef) continue;

            // Message echo: page sent a message directly on Facebook (not via our app)
            // Capture as style training data for the assigned staff
            if (event.message?.is_echo) {
                const recipientId = event.recipient?.id;
                const echoText = event.message?.text;
                if (echoText && recipientId) {
                    try {
                        const partRow = database._db.prepare(`SELECT conversation_id FROM meta_participants WHERE participant_id = ? LIMIT 1`).get(String(recipientId));
                        if (partRow) {
                            const convAssigned = database._db.prepare(`SELECT assigned_to FROM meta_conversations WHERE id = ?`).get(partRow.conversation_id);
                            if (convAssigned?.assigned_to) {
                                database.updateStaffServiceSample(convAssigned.assigned_to, 'unknown', echoText.substring(0, 600));
                                console.log(`[EchoCapture] Captured FB echo from page → attributed to ${convAssigned.assigned_to}`);
                            }
                        }
                    } catch(e) { /* non-critical */ }
                }
                continue; // Don't process echoes as incoming messages
            }

            const senderId = event.sender.id;
            const messageText = event.message?.text || `[Hệ thống] Khách nhắn tin/click thông qua Ads hoặc Referral: ${referralRef}`;

            console.log(`\n[Webhook] 💬 Tin nhắn mới từ ${senderId} tới Fanpage ${pageId}: "${messageText}"`);

            try {
                const intent = event.message?.text ? await classifyIntent(messageText) : 'service_inquiry';

                // Auto-assign: detect service type → map to staff
                let autoAssignStaff = null;
                try {
                    const serviceType = event.message?.text ? await classifyService(messageText) : 'unknown';
                    const staffMap = getServiceStaffMap();
                    autoAssignStaff = staffMap[serviceType] || null;
                    if (autoAssignStaff) {
                        console.log(`[Webhook] 🎯 Auto-assign: service=${serviceType} → staff=${autoAssignStaff}`);
                    }
                } catch(e) { /* non-critical */ }

                const aiSuggestion = await generateCopilotReply(messageText, { senderId, platform: 'facebook' });

                const convId = database.upsertMetaConversation({
                    external_id: senderId,
                    platform: 'messenger',
                    status: 'pending',
                    last_message_at: new Date().toISOString(),
                    unread_count: 1
                });

                // Assign conversation if staff detected and not yet assigned
                if (autoAssignStaff) {
                    const existingConv = database._db.prepare(`SELECT assigned_to FROM meta_conversations WHERE id = ?`).get(convId);
                    if (!existingConv?.assigned_to) {
                        database._db.prepare(`UPDATE meta_conversations SET assigned_to = ? WHERE id = ?`).run(autoAssignStaff, convId);
                    }
                }

                database.upsertMetaParticipant({
                    conversation_id: convId,
                    participant_id: senderId,
                    name: `FB User ${senderId.slice(-4)}`,
                    profile_pic: pageId
                });

                database.insertMetaMessage({
                    conversation_id: convId,
                    sender_id: senderId,
                    sender_role: 'customer',
                    message_text: messageText,
                    attachments_json: [],
                    created_at: new Date().toISOString()
                });

                // Auto-credit reply_received KPI for assigned staff
                try {
                    // Find staff assigned to leads from this sender (best-effort)
                    const assignedStaff = database._db.prepare(`
                        SELECT pc.assigned_to FROM post_classifications pc
                        JOIN raw_posts rp ON pc.raw_post_id = rp.id
                        WHERE pc.assigned_to IS NOT NULL
                        ORDER BY pc.created_at DESC LIMIT 1
                    `).get();

                    // Check if staff already sent a message in this conversation
                    const priorAdminMsg = database._db.prepare(`
                        SELECT sender_id FROM meta_messages
                        WHERE conversation_id = ? AND sender_role = 'admin'
                        LIMIT 1
                    `).get(convId);

                    if (priorAdminMsg && assignedStaff?.assigned_to) {
                        database.logKpiEvent(assignedStaff.assigned_to, 'reply_received', null, 0, `FB reply conv ${convId}`);
                    }
                } catch(e) {}

                database.insertMetaMessage({
                    conversation_id: convId,
                    sender_id: 'bot_draft',
                    sender_role: 'ai_draft',
                    message_text: aiSuggestion,
                    attachments_json: [],
                    created_at: new Date().toISOString()
                });

                await sendTelegramAlert(senderId, messageText, aiSuggestion, intent);

                // --- Night Shift Auto-Reply (00:00 - 09:00 VN) ---
                const vnTimeHour = (new Date().getUTCHours() + 7) % 24;
                // Currently set to only trigger if explicitly enabled via DB or ENV
                const isNightShiftEnabled = database.getSetting ? (database.getSetting('NIGHT_SHIFT_MODE', 'false') === 'true') : (process.env.NIGHT_SHIFT_MODE === 'true');

                if (vnTimeHour >= 0 && vnTimeHour < 9 && isNightShiftEnabled) {
                    console.log(`[Webhook] 🌙 Night Shift Mode Triggered. Đang Auto-reply...`);
                    const tokens = [process.env.FB_PAGE_TOKEN_WAREHOUSE, process.env.FB_PAGE_TOKEN_EXPRESS, process.env.FB_PAGE_TOKEN_FULFILLMENT].filter(Boolean);

                    let sentInNight = false;
                    for (const tk of tokens) {
                        try {
                            await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${tk}`, {
                                recipient: { id: senderId },
                                message: { text: aiSuggestion }
                            });
                            sentInNight = true;
                            break;
                        } catch (e) { }
                    }
                    if (sentInNight) {
                        database.insertMetaMessage({
                            conversation_id: convId,
                            sender_id: 'page_admin',
                            sender_role: 'admin',
                            message_text: aiSuggestion,
                            attachments_json: [],
                            created_at: new Date().toISOString()
                        });
                        database.db.prepare(`UPDATE meta_conversations SET status = 'replied', unread_count = 0 WHERE id = ?`).run(convId);
                        console.log(`[Webhook] 🌙 Night Shift Auto-Reply thành công!`);
                    }
                }

            } catch (err) {
                console.error('[Webhook] ✗ Error processing message:', err.message);
            }
        }
    }
});

// ── GET & POST /api/test-message — Manual test webhook ──────────────────────
router.post('/api/test-message', async (req, res) => {
    try {
        const { message, sender_name, platform } = req.body;
        if (!message) return res.status(400).json({ success: false, error: 'Message required' });

        const intent = await classifyIntent(message);
        const aiSuggestion = await generateCopilotReply(message, {
            senderName: sender_name || 'Test User',
            platform: platform || 'manual',
        });

        const senderId = 'test_' + Date.now();
        const convId = database.upsertMetaConversation({
            external_id: senderId,
            platform: platform || 'manual',
            status: 'pending',
            last_message_at: new Date().toISOString(),
            unread_count: 1
        });

        database.upsertMetaParticipant({
            conversation_id: convId,
            participant_id: senderId,
            name: sender_name || 'Test User',
            profile_pic: ''
        });

        database.insertMetaMessage({
            conversation_id: convId,
            sender_id: senderId,
            sender_role: 'customer',
            message_text: message,
            attachments_json: [],
            created_at: new Date().toISOString()
        });

        database.insertMetaMessage({
            conversation_id: convId,
            sender_id: 'bot_draft',
            sender_role: 'ai_draft',
            message_text: aiSuggestion,
            attachments_json: [],
            created_at: new Date().toISOString()
        });

        res.json({ success: true, data: { thread: convId } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
