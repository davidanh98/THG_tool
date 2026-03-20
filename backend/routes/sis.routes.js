/**
 * SIS (Seller Intelligence System) Routes — Customer Accounts & Business Entities
 */
const router = require('express').Router();
const database = require('../core/data_store/database');

// ── GET /api/sis/accounts — List all business accounts ───────────────────────
router.get('/api/sis/accounts', (req, res) => {
    try {
        const status = req.query.status || null;
        const limit = req.query.limit ? parseInt(req.query.limit) : 100;

        const accounts = database.getAccounts(limit, status);

        // Populate additional identities and signals for basic 360 preview
        const enrichedAccounts = accounts.map(acc => {
            return database.getAccountById(acc.id);
        });

        res.json({ ok: true, data: enrichedAccounts });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── GET /api/sis/accounts/:id — Get Account 360 View ────────────────────────
router.get('/api/sis/accounts/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const account = database.getAccountById(id);

        if (!account) return res.status(404).json({ ok: false, error: 'Account not found' });

        res.json({ ok: true, data: account });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

// ── PATCH /api/sis/accounts/:id — Update Account Status / Scores ────────────
router.patch('/api/sis/accounts/:id', (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const updates = req.body;

        // Fetch existing
        const existing = database.getAccountById(id);
        if (!existing) return res.status(404).json({ ok: false, error: 'Account not found' });

        // Merge updates
        const merged = { ...existing, ...updates };

        database.updateAccountScores(id, merged);

        // Log manual action if status changed by user
        if (updates.status && updates.status !== existing.status) {
            database.logSISAction({
                account_id: id,
                action_type: 'Status_Change',
                owner: 'Sales Repo',
                status: updates.status
            });
        }

        res.json({ ok: true, data: database.getAccountById(id) });
    } catch (err) {
        res.status(500).json({ ok: false, error: err.message });
    }
});

module.exports = router;
