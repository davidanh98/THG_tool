/**
 * SIS v2 Intelligence Routes — Lanes & Strategic Brain
 * 
 * Exposes the Signal-Centric architecture to the Dashboard.
 */
const router = require('express').Router();
const database = require('../core/data_store/database');
const { generateLeadCard } = require('../../ai/prompts/salesCopilot');
const { runDiscovery } = require('../services/discoveryAgent');

// ── GET /api/sis/summary — Dashboard KPI overview ────────────────────────────
router.get('/api/sis/summary', (req, res) => {
    try {
        const summary = database.getSISSummary();
        res.json({ ok: true, data: summary });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/leaderboard — Dashboard KPI ──────────────────────────────────────
router.get('/api/leaderboard', (req, res) => {
    try {
        const data = database.getLeaderboard();
        res.json({ ok: true, data });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/sis/lanes/:lane — Fetch Lead Cards for a Lane ────────────────────
router.get('/api/sis/lanes/:lane', (req, res) => {
    try {
        const lane = req.params.lane;
        const limit = req.query.limit ? parseInt(req.query.limit) : 50;
        const service = req.query.service || null;
        const cards = database.getLeadCards(lane, limit, service);
        res.json({ ok: true, data: cards });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/sis/signals/:id/strategy — Generate/Fetch Strategy ───────────────
router.get('/api/sis/signals/:id/strategy', async (req, res) => {
    try {
        const rawPostId = parseInt(req.params.id);

        // 1. Check if card exists
        let card = database.getLeadCardByPost(rawPostId);

        // 2. If not, generate it now (Strategic Brain GPT-4o)
        if (!card) {
            await generateLeadCard(rawPostId);
            card = database.getLeadCardByPost(rawPostId);
        }

        if (!card) return res.status(404).json({ ok: false, error: 'Failed to generate strategy' });

        res.json({ ok: true, data: card });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /api/sis/feedback — Human Feedback (Learning Loop) ──────────────────
router.post('/api/sis/feedback', (req, res) => {
    try {
        const feedback = req.body; // { raw_post_id, classification_id, is_correct, corrected_lane, etc }

        if (!feedback.raw_post_id) return res.status(400).json({ ok: false, error: 'Missing raw_post_id' });

        const feedbackId = database.insertFeedback(feedback);
        res.json({ ok: true, data: { feedbackId } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/sis/accounts — List all business accounts (v2 Compat) ───────────
router.get('/api/sis/accounts', (req, res) => {
    try {
        const accounts = database.getAccounts(100);
        res.json({ ok: true, data: accounts });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/sis/signals/:id/detail — Full Signal Detail ─────────────────────
router.get('/api/sis/signals/:id/detail', (req, res) => {
    try {
        const rawPostId = parseInt(req.params.id);
        const detail = database.getSignalDetail(rawPostId);
        if (!detail) return res.status(404).json({ ok: false, error: 'Signal not found' });
        res.json({ ok: true, data: detail });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/sis/signals/:id/actions — Get action history ────────────────────
router.get('/api/sis/signals/:id/actions', (req, res) => {
    try {
        const rawPostId = parseInt(req.params.id);
        const actions = database.getSalesActions(rawPostId);
        res.json({ ok: true, data: actions });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /api/sis/signals/:id/action — Record a sales action ─────────────────
router.post('/api/sis/signals/:id/action', (req, res) => {
    try {
        const rawPostId = parseInt(req.params.id);
        const { action_type, action_data, staff_name } = req.body;

        if (!action_type) return res.status(400).json({ ok: false, error: 'action_type required' });

        let result;
        switch (action_type) {
            case 'stage_change':
                if (!action_data?.stage) return res.status(400).json({ ok: false, error: 'action_data.stage required' });
                result = database.updatePipelineStage(rawPostId, action_data.stage, staff_name);
                break;
            case 'note':
                if (action_data?.notes === undefined) return res.status(400).json({ ok: false, error: 'action_data.notes required' });
                result = database.updateSalesNotes(rawPostId, action_data.notes, staff_name);
                break;
            case 'assign':
                if (!staff_name) return res.status(400).json({ ok: false, error: 'staff_name required for assign' });
                result = database.updateAssignedTo(rawPostId, staff_name);
                break;
            case 'deal_closed':
            case 'follow_up':
            case 'feedback':
                result = database.insertSalesAction({ raw_post_id: rawPostId, action_type, action_data, staff_name });
                break;
            default:
                return res.status(400).json({ ok: false, error: `Unknown action_type: ${action_type}` });
        }

        res.json({ ok: true, data: { action_id: result } });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /api/sis/signals/:id/kpi — Log KPI event with anti-gaming validation ──
router.post('/api/sis/signals/:id/kpi', (req, res) => {
    try {
        const rawPostId = parseInt(req.params.id);
        const { action_type, staff_name, deal_value, note } = req.body;

        if (!action_type || !staff_name) {
            return res.status(400).json({ ok: false, error: 'action_type and staff_name required' });
        }

        const result = database.logKpiEvent(staff_name, action_type, rawPostId, deal_value || 0, note || '');
        if (!result.ok) {
            return res.status(400).json({ ok: false, error: result.reason });
        }

        res.json({ ok: true, data: result });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /api/leaderboard/approve/:id — Manager approves pending deal ──
router.post('/api/leaderboard/approve/:id', (req, res) => {
    try {
        const changes = database.approveKpiEntry(parseInt(req.params.id));
        res.json({ ok: true, approved: changes > 0 });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /api/leaderboard/reject/:id — Manager rejects flagged deal ──
router.post('/api/leaderboard/reject/:id', (req, res) => {
    try {
        const { reason } = req.body;
        const changes = database.rejectKpiEntry(parseInt(req.params.id), reason || '');
        res.json({ ok: true, rejected: changes > 0 });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── DELETE /api/sis/signals/:id — Hard Delete Signal ─────────────────────────
router.delete('/api/sis/signals/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);

        const deleteClassifications = database._db.prepare(`DELETE FROM post_classifications WHERE raw_post_id = ?`);
        const deleteRawPost = database._db.prepare(`DELETE FROM raw_posts WHERE id = ?`);

        const transaction = database._db.transaction(() => {
            deleteClassifications.run(id);
            deleteRawPost.run(id);
        });

        transaction();

        res.json({ ok: true });
    } catch (err) {
        console.error('API /api/sis/signals/:id DELETE failed:', err.message);
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /api/sis/discovery — AI-powered multi-platform lead discovery ────────
router.post('/discovery', async (req, res) => {
    try {
        const { query, maxLeads } = req.body;
        if (!query || !query.trim()) {
            return res.status(400).json({ ok: false, error: 'query is required' });
        }
        const result = await runDiscovery(query.trim(), { maxLeads: Math.min(parseInt(maxLeads) || 5, 10) });
        res.json({ ok: true, data: result });
    } catch (err) {
        console.error('[Discovery API] Error:', err.message);
        if (err.message.includes('GEMINI_API_KEY')) {
            return res.status(503).json({ ok: false, error: 'GEMINI_API_KEY chưa được cấu hình trong .env' });
        }
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/sis/discovery/history — Recent discovery runs ───────────────────
router.get('/discovery/history', (req, res) => {
    try {
        const rows = database._db.prepare(`
            SELECT rp.id, rp.author_name, rp.post_url, rp.group_name, rp.scraped_at,
                   pc.recommended_lane, pc.thg_service_needed, pc.assigned_to, pc.reason_summary
            FROM raw_posts rp
            JOIN post_classifications pc ON pc.raw_post_id = rp.id
            WHERE rp.source_platform = 'web_discovery'
            ORDER BY rp.scraped_at DESC
            LIMIT 50
        `).all();
        res.json({ ok: true, data: rows });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ─── Meta Inbox Integration Route Stubs ───────────────────────────────────

router.get('/meta/conversations', (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const convos = database.getMetaConversations(limit);
        res.json(convos);
    } catch (err) {
        console.error('[SIS API] Meta Get Convos Error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve Meta conversations' });
    }
});

router.post('/meta/assign/:id', (req, res) => {
    try {
        const convId = parseInt(req.params.id);
        const { staff_name } = req.body;
        // When manually reassigning, reset claim timer
        database._db.prepare(`
            UPDATE meta_conversations
            SET assigned_to = ?, claimed_at = CASE WHEN ? IS NOT NULL THEN datetime('now') ELSE NULL END,
                first_replied_at = NULL
            WHERE id = ?
        `).run(staff_name || null, staff_name || null, convId);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /api/sis/meta/claim/:id — Staff claims a conversation ─────────────────
router.post('/meta/claim/:id', (req, res) => {
    try {
        const convId = parseInt(req.params.id);
        const { staff_name } = req.body;
        if (!staff_name) return res.status(400).json({ ok: false, error: 'staff_name required' });
        const result = database.claimMetaConversation(convId, staff_name);
        res.json(result);
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /api/sis/meta/auto-release — Release stale claims + log KPI penalty ──
router.post('/meta/auto-release', (req, res) => {
    try {
        const timeoutMinutes = parseInt(req.body.timeoutMinutes) || 60;
        const expired = database.getExpiredMetaClaims(timeoutMinutes);
        expired.forEach(conv => {
            database.autoReleaseMetaClaim(conv.id, conv.assigned_to);
        });
        console.log(`[Anti-Hoarding] Released ${expired.length} stale Meta claim(s)`);
        res.json({ ok: true, released: expired.length, convs: expired.map(c => c.id) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

router.get('/meta/conversations/:id/messages', (req, res) => {
    try {
        const msgs = database.getMetaMessages(req.params.id);
        res.json(msgs);
    } catch (err) {
        console.error('[SIS API] Meta Get Messages Error:', err.message);
        res.status(500).json({ error: 'Failed to retrieve Meta messages' });
    }
});

// ─── Style Capture Helper ──────────────────────────────────────────────────────
// Tính độ giống nhau giữa AI draft và tin sales thực sự gửi.
// Dùng word-overlap (Jaccard). Không cần dependency ngoài.
function calcSimilarity(a, b) {
    const words = (str) => new Set((str || '').toLowerCase().split(/\s+/).filter(w => w.length > 2));
    const A = words(a), B = words(b);
    if (A.size === 0 || B.size === 0) return 0;
    const intersection = [...A].filter(w => B.has(w)).length;
    return intersection / Math.max(A.size, B.size);
}

router.post('/meta/send/:id', async (req, res) => {
    try {
        const { messageText, staff_name } = req.body;
        const recipientId = req.params.id; // FB Page Scoped ID (PSID)

        if (!messageText) return res.status(400).json({ error: 'Message cannot be empty' });

        console.log(`[Meta API] 📤 Sending message to ${recipientId}: "${messageText}"`);

        const axios = require('axios');

        // Since Thg has multiple Pages, we try the 3 tokens available in .env
        const tokens = [
            process.env.FB_PAGE_TOKEN_WAREHOUSE,
            process.env.FB_PAGE_TOKEN_EXPRESS,
            process.env.FB_PAGE_TOKEN_FULFILLMENT
        ].filter(Boolean);

        if (tokens.length === 0) {
            return res.status(500).json({ error: 'No FB_PAGE_TOKEN_* variables configured in .env' });
        }

        let sentStatus = false;
        let lastError = null;
        let msgIdFromMeta = null;

        for (const tk of tokens) {
            try {
                const response = await axios.post(`https://graph.facebook.com/v19.0/me/messages?access_token=${tk}`, {
                    recipient: { id: recipientId },
                    message: { text: messageText }
                });

                if (response.data && response.data.message_id) {
                    sentStatus = true;
                    msgIdFromMeta = response.data.message_id;
                    console.log(`[Meta API] ✅ Sent successfully using one of the tokens.`);
                    break;
                }
            } catch (err) {
                lastError = err.response ? err.response.data : err.message;
            }
        }

        if (sentStatus) {
            // Get conversation_id corresponding to this recipientId
            const partRow = database._db.prepare(`SELECT conversation_id FROM meta_participants WHERE participant_id = ? LIMIT 1`).get(recipientId);

            if (partRow) {
                database.insertMetaMessage({
                    conversation_id: partRow.conversation_id,
                    sender_id: staff_name || 'page_admin',
                    sender_role: 'admin',
                    message_text: messageText,
                    attachments_json: [],
                    created_at: new Date().toISOString()
                });

                if (staff_name && partRow) {
                    // Log KPI: reply_received (+8) + first contact (+3) if first message
                    try {
                        database.recordMetaFirstReply(partRow.conversation_id, staff_name);
                    } catch(e) { console.error('[KPI] recordMetaFirstReply error:', e.message); }

                    // Determine which service this conversation relates to
                    let serviceType = 'unknown';
                    try {
                        const leadRow = database._db.prepare(`
                            SELECT pc.thg_service_needed
                            FROM post_classifications pc
                            JOIN raw_posts rp ON pc.raw_post_id = rp.id
                            WHERE pc.assigned_to = ?
                            ORDER BY pc.created_at DESC LIMIT 1
                        `).get(staff_name);
                        if (leadRow) serviceType = leadRow.thg_service_needed || 'unknown';
                    } catch(e) {}

                    // Capture ALL sent messages as style training data
                    database.updateStaffServiceSample(staff_name, serviceType, messageText.substring(0, 600));

                    // Also capture rewrite delta if AI draft exists and was changed
                    const lastDraft = database.getLastAiDraft(partRow.conversation_id);
                    if (lastDraft) {
                        const similarity = calcSimilarity(lastDraft.message_text, messageText);
                        console.log(`[StyleCapture] ${staff_name} sent (similarity vs AI draft: ${Math.round(similarity*100)}%) → sample saved to [${serviceType}]`);
                    } else {
                        console.log(`[StyleCapture] ${staff_name} sent message → sample saved to [${serviceType}]`);
                    }
                }
            }

            res.json({ success: true, message: `Message delivered`, message_id: msgIdFromMeta });
        } else {
            console.error('[SIS API] All tokens failed to send. Last error:', lastError);
            res.status(500).json({ error: 'Failed to dispatch Meta message to any page. Incorrect token or outside 24h window.', details: lastError });
        }
    } catch (e) {
        console.error('[SIS API] Meta Send Error:', e.message);
        res.status(500).json({ error: 'Failed to dispatch Meta message' });
    }
});

// ── POST /api/sis/webform/submit ──────────────────────────────────────────────
router.post('/webform/submit', async (req, res) => {
    try {
        const { name, channel, origin, destination, needs, contact } = req.body;

        const senderId = 'webform_' + Date.now();
        const messageText = `Khách hàng từ website đăng ký Form Audit:
- Tên: ${name || 'Ẩn danh'}
- Kênh bán: ${channel || 'N/A'}
- Source hàng: ${origin || 'N/A'}
- Điểm đến (Dest): ${destination || 'N/A'}
- Nhu cầu chính: ${needs || 'N/A'}
- Liên hệ (Phone/Tele): ${contact || 'N/A'}`;

        const convId = database.upsertMetaConversation({
            external_id: senderId,
            platform: 'web_form',
            status: 'pending',
            last_message_at: new Date().toISOString(),
            unread_count: 1
        });

        database.upsertMetaParticipant({
            conversation_id: convId,
            participant_id: senderId,
            name: name || 'Web User',
            profile_pic: ''
        });

        database.insertMetaMessage({
            conversation_id: convId,
            sender_id: senderId,
            sender_role: 'customer',
            message_text: messageText,
            attachments_json: [],
            created_at: new Date().toISOString()
        });

        // Generate AI draft
        const { generateCopilotReply } = require('../../ai/prompts/salesCopilot');
        const aiSuggestion = await generateCopilotReply(messageText, { senderName: name || 'Khách Web', platform: 'web_form' });

        database.insertMetaMessage({
            conversation_id: convId,
            sender_id: 'bot_draft',
            sender_role: 'ai_draft',
            message_text: aiSuggestion,
            attachments_json: [],
            created_at: new Date().toISOString()
        });

        res.json({ success: true, message: 'Web form logged to CRM.' });
    } catch (err) {
        console.error('[WebForm API] Error:', err.message);
        res.status(500).json({ error: 'System error processing your form submission.' });
    }
});

// ── GET /api/sis/settings ──────────────────────────────────────────────
router.get('/settings', (req, res) => {
    try {
        const nightShift = database.getSetting('NIGHT_SHIFT_MODE', 'false');
        const aiKb = database.getSetting('AI_KNOWLEDGE_BASE', '');
        const serviceStaffMap = database.getSetting('SERVICE_STAFF_MAP', '{}');
        res.json({ success: true, settings: { NIGHT_SHIFT_MODE: nightShift === 'true', AI_KNOWLEDGE_BASE: aiKb, SERVICE_STAFF_MAP: serviceStaffMap } });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/sis/settings ─────────────────────────────────────────────
router.post('/settings', (req, res) => {
    try {
        const { NIGHT_SHIFT_MODE, AI_KNOWLEDGE_BASE, SERVICE_STAFF_MAP } = req.body;
        if (NIGHT_SHIFT_MODE !== undefined) {
            database.setSetting('NIGHT_SHIFT_MODE', NIGHT_SHIFT_MODE ? 'true' : 'false');
        }
        if (AI_KNOWLEDGE_BASE !== undefined) {
            database.setSetting('AI_KNOWLEDGE_BASE', AI_KNOWLEDGE_BASE);
        }
        if (SERVICE_STAFF_MAP !== undefined) {
            database.setSetting('SERVICE_STAFF_MAP', SERVICE_STAFF_MAP);
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── POST /api/sis/leads/:id/claim — Sales nhận khách ─────────────────────────
router.post('/api/sis/leads/:id/claim', (req, res) => {
    const rawPostId = parseInt(req.params.id);
    const { staff_name } = req.body;
    if (!staff_name) return res.status(400).json({ ok: false, error: 'staff_name required' });

    try {
        const result = database.claimLead(rawPostId, staff_name);
        if (!result.ok) return res.status(409).json({ ok: false, error: result.reason });
        console.log(`[Claim] ✅ ${staff_name} claimed lead #${rawPostId}`);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── POST /api/sis/leads/:id/contact — Ghi nhận tương tác thật ───────────────
router.post('/api/sis/leads/:id/contact', (req, res) => {
    const rawPostId = parseInt(req.params.id);
    const { staff_name, note } = req.body;
    if (!staff_name) return res.status(400).json({ ok: false, error: 'staff_name required' });

    try {
        const result = database.logFirstContact(rawPostId, staff_name, note || '');
        if (!result.ok) return res.status(403).json({ ok: false, error: result.reason });
        console.log(`[Contact] ✅ ${staff_name} logged first contact on lead #${rawPostId}`);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/sis/leads/unassigned — Danh sách lead chưa có chủ ──────────────
router.get('/api/sis/leads/unassigned', (req, res) => {
    try {
        const limit = parseInt(req.query.limit || '30');
        const rows = database._db.prepare(`
            SELECT rp.id, rp.author_name, rp.post_url, rp.source_platform as platform,
                   pc.thg_service_needed, pc.sales_priority_score, pc.reason_summary,
                   pc.claim_status, pc.release_count, pc.recommended_lane
            FROM post_classifications pc
            JOIN raw_posts rp ON pc.raw_post_id = rp.id
            WHERE pc.claim_status = 'unclaimed'
              AND pc.is_relevant = 1
              AND pc.recommended_lane IN ('resolved_lead', 'partial_lead')
            ORDER BY pc.sales_priority_score DESC, pc.created_at DESC
            LIMIT ?
        `).all(limit);
        res.json({ ok: true, data: rows });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
