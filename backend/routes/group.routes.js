const express = require('express');
const router = express.Router();
const groupDiscovery = require('../../ai/agents/groupDiscovery');

// GET /api/groups/debug_db
router.get('/api/groups/debug_db', async (req, res) => {
    try {
        const db = groupDiscovery.getDb();
        const raw = db.prepare('SELECT * FROM fb_groups ORDER BY id DESC LIMIT 10').all();
        res.json({ success: true, data: raw });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/groups/stats
router.get('/api/groups/stats', async (req, res) => {
    try {
        const stats = groupDiscovery.getStats();
        res.json({ success: true, data: stats });
    } catch (err) {
        console.error('[GroupRoutes] Error getting stats:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/groups
router.get('/api/groups', async (req, res) => {
    try {
        const { limit, category, status } = req.query;
        const filters = {};
        if (limit) filters.limit = parseInt(limit, 10);
        if (category) filters.category = category;
        if (status) filters.status = status;

        const groups = groupDiscovery.getAllGroups(filters);
        res.json({ success: true, data: groups });
    } catch (err) {
        console.error('[GroupRoutes] Error getting groups:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/groups
router.post('/api/groups', async (req, res) => {
    try {
        const { name, url, category, notes, member_count } = req.body;
        if (!name || !url) return res.status(400).json({ success: false, error: 'Name and URL are required' });

        const newGroup = { name, url, category, notes, member_count: member_count || 0 };
        groupDiscovery.upsertGroup(newGroup);
        res.json({ success: true, data: newGroup });
    } catch (err) {
        console.error('[GroupRoutes] Error adding group:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/groups/:url/status
router.patch('/api/groups/:url/status', async (req, res) => {
    try {
        const url = decodeURIComponent(req.params.url);
        const { status } = req.body;
        groupDiscovery.setStatus(url, status);
        res.json({ success: true });
    } catch (err) {
        console.error('[GroupRoutes] Error updating group status:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/groups/category/:category
router.delete('/api/groups/category/:category', async (req, res) => {
    try {
        const category = decodeURIComponent(req.params.category);
        groupDiscovery.deleteGroupsByCategory(category);
        res.json({ success: true });
    } catch (err) {
        console.error('[GroupRoutes] Error deleting group category:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// DELETE /api/groups/:url
router.delete('/api/groups/:url', async (req, res) => {
    try {
        const url = decodeURIComponent(req.params.url);
        groupDiscovery.deleteGroup(url);
        res.json({ success: true });
    } catch (err) {
        console.error('[GroupRoutes] Error deleting group:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
