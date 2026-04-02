/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║  Scraper Routes — Apify Cloud Scraping API                ║
 * ║  POST /api/scraper/run      — trigger scrape job          ║
 * ║  GET  /api/scraper/actors   — list available actors       ║
 * ║  GET  /api/scraper/actions  — list available actions      ║
 * ║  GET  /api/scraper/status   — check Apify config status   ║
 * ╚═══════════════════════════════════════════════════════════╝
 */
const router = require('express').Router();
const scraper = require('../../ai/agents/scraper');

// ── Status check ────────────────────────────────────────────────────────────
router.get('/api/scraper/status', (req, res) => {
    res.json({
        success: true,
        data: {
            configured: scraper.isConfigured(),
            message: scraper.isConfigured()
                ? 'Apify token configured ✅'
                : 'APIFY_TOKEN missing — add to .env',
        },
    });
});

// ── List actors catalog ─────────────────────────────────────────────────────
router.get('/api/scraper/actors', (req, res) => {
    const { platform } = req.query;
    const actors = scraper.listActors();

    if (platform && actors[platform]) {
        return res.json({ success: true, data: { [platform]: actors[platform] } });
    }

    res.json({ success: true, data: actors });
});

// ── List available actions ──────────────────────────────────────────────────
router.get('/api/scraper/actions', (req, res) => {
    const { platform } = req.query;
    const actions = scraper.getAvailableActions(platform || undefined);
    res.json({ success: true, data: actions });
});

// ── Run a scrape job ────────────────────────────────────────────────────────
router.post('/api/scraper/run', async (req, res) => {
    try {
        const { platform, action, params } = req.body;

        // Validate
        if (!platform) return res.status(400).json({ success: false, error: 'platform is required (facebook, instagram, tiktok, youtube, google_maps)' });
        if (!action) return res.status(400).json({ success: false, error: 'action is required — GET /api/scraper/actions for available actions' });

        if (!scraper.isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'APIFY_TOKEN not configured. Add APIFY_TOKEN=your_token to .env',
            });
        }

        const result = await scraper.scrape({ platform, action, params: params || {} });

        res.json({
            success: true,
            data: {
                items: result.items,
                count: result.items.length,
                run: {
                    id: result.run.runId,
                    status: result.run.status,
                    stats: result.run.stats,
                },
            },
        });
    } catch (err) {
        console.error('[Scraper Route] ❌ Error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Run a raw actor by ID (advanced) ────────────────────────────────────────
router.post('/api/scraper/raw', async (req, res) => {
    try {
        const { actorId, input, opts } = req.body;

        if (!actorId) return res.status(400).json({ success: false, error: 'actorId is required' });

        if (!scraper.isConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'APIFY_TOKEN not configured. Add APIFY_TOKEN=your_token to .env',
            });
        }

        const result = await scraper.scrapeRaw(actorId, input || {}, opts || {});

        res.json({
            success: true,
            data: {
                items: result.items,
                count: result.items.length,
                run: {
                    id: result.run.runId,
                    status: result.run.status,
                    stats: result.run.stats,
                },
            },
        });
    } catch (err) {
        console.error('[Scraper Route] ❌ Raw error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
