/**
 * SIS v2 Intelligence Routes — Lanes & Strategic Brain
 * 
 * Exposes the Signal-Centric architecture to the Dashboard.
 */
const router = require('express').Router();
const database = require('../core/data_store/database');
const { generateLeadCard } = require('../../ai/prompts/salesCopilot');

// ── GET /api/sis/summary — Dashboard KPI overview ────────────────────────────
router.get('/api/sis/summary', (req, res) => {
    try {
        const summary = database.getSISSummary();
        res.json({ ok: true, data: summary });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/sis/lanes/:lane — Fetch Lead Cards for a Lane ────────────────────
router.get('/api/sis/lanes/:lane', (req, res) => {
    try {
        const lane = req.params.lane;
        const limit = req.query.limit ? parseInt(req.query.limit) : 50;

        const cards = database.getLeadCards(lane, limit);
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

// ── DELETE /api/sis/signals/:id — Hard Delete Signal ─────────────────────────
router.delete('/api/sis/signals/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);

        const deleteLeadCards = database._db.prepare(`DELETE FROM lead_cards WHERE raw_post_id = ?`);
        const deleteClassifications = database._db.prepare(`DELETE FROM post_classifications WHERE raw_post_id = ?`);
        const deleteRawPost = database._db.prepare(`DELETE FROM raw_posts WHERE id = ?`);

        const transaction = database._db.transaction(() => {
            deleteLeadCards.run(id);
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

module.exports = router;
