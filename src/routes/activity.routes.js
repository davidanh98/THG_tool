/**
 * 📡 Activity Feed API — Real-time agent activity stream
 * 
 * Tổng hợp từ: outreach_log + social_activity_log + scrape runs
 * Cung cấp feed cho frontend hiển thị hoạt động agents
 * 
 * @module routes/activity.routes
 */
const express = require('express');
const router = express.Router();
const database = require('../core/data_store/database');

// ─── GET /api/activity/feed — Last 30 activities ─────────────────────────────
router.get('/feed', (req, res) => {
    try {
        const limit = Math.min(Number(req.query.limit) || 30, 100);
        const since = req.query.since || null; // ISO timestamp for polling

        let activities = [];

        // 1. Outreach activities (expert reply, profile engage, hot alert, DM)
        try {
            const whereClause = since
                ? `WHERE ol.created_at > '${since}'`
                : '';
            const outreach = database.db.prepare(`
                SELECT ol.id, ol.lead_id, ol.staff_name, ol.channel, ol.message, 
                       ol.status, ol.created_at, ol.ai_generated,
                       l.author_name, l.score, l.author_url, l.post_url
                FROM outreach_log ol
                LEFT JOIN leads l ON ol.lead_id = l.id
                ${whereClause}
                ORDER BY ol.created_at DESC LIMIT ?
            `).all(limit);

            outreach.forEach(r => {
                let icon = '📨', label = 'Outreach';
                if (r.channel === 'profile_engage') { icon = '👀'; label = 'Profile Engaged'; }
                else if (r.channel === 'comment') { icon = '🏆'; label = 'Expert Reply'; }
                else if (r.channel === 'telegram_alert') { icon = '⚡'; label = 'Hot Alert Sent'; }
                else if (r.channel === 'dm') { icon = '💬'; label = 'DM Sent'; }

                activities.push({
                    id: `outreach_${r.id}`,
                    type: r.channel || 'outreach',
                    icon,
                    label,
                    leadName: r.author_name || 'Unknown',
                    leadScore: r.score,
                    leadUrl: r.author_url,
                    postUrl: r.post_url,
                    detail: r.message?.substring(0, 100),
                    staff: r.staff_name,
                    aiGenerated: !!r.ai_generated,
                    timestamp: r.created_at,
                });
            });
        } catch { }

        // 2. Scan activities
        try {
            const scans = database.db.prepare(`
                SELECT id, keyword, total_posts, new_leads, created_at
                FROM scrape_runs
                ${since ? `WHERE created_at > '${since}'` : ''}
                ORDER BY created_at DESC LIMIT 10
            `).all();

            scans.forEach(r => {
                activities.push({
                    id: `scan_${r.id}`,
                    type: 'scan',
                    icon: '🔍',
                    label: 'Keyword Scan',
                    detail: `"${r.keyword}" → ${r.new_leads || 0} leads mới (${r.total_posts} posts)`,
                    timestamp: r.created_at,
                });
            });
        } catch { }

        // Sort by timestamp (newest first)
        activities.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        activities = activities.slice(0, limit);

        res.json({ ok: true, data: activities, count: activities.length });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─── GET /api/activity/summary — Today's aggregated stats ────────────────────
router.get('/summary', (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        const replies = database.db.prepare(`
            SELECT COUNT(*) as c FROM outreach_log 
            WHERE channel = 'comment' AND created_at >= ?
        `).get(today)?.c || 0;

        const engagements = database.db.prepare(`
            SELECT COUNT(*) as c FROM outreach_log 
            WHERE channel = 'profile_engage' AND created_at >= ?
        `).get(today)?.c || 0;

        const alerts = database.db.prepare(`
            SELECT COUNT(*) as c FROM outreach_log 
            WHERE channel = 'telegram_alert' AND created_at >= ?
        `).get(today)?.c || 0;

        const dms = database.db.prepare(`
            SELECT COUNT(*) as c FROM outreach_log 
            WHERE channel = 'dm' AND created_at >= ?
        `).get(today)?.c || 0;

        let scansToday = 0, leadsToday = 0;
        try {
            const scanStats = database.db.prepare(`
                SELECT COUNT(*) as scans, COALESCE(SUM(new_leads), 0) as leads
                FROM scrape_runs WHERE created_at >= ?
            `).get(today);
            scansToday = scanStats?.scans || 0;
            leadsToday = scanStats?.leads || 0;
        } catch { }

        const pipeline = {};
        try {
            const stages = database.db.prepare(`
                SELECT COALESCE(pipeline_stage, 'new') as stage, COUNT(*) as c 
                FROM leads WHERE role = 'buyer' AND status != 'ignored'
                GROUP BY pipeline_stage
            `).all();
            stages.forEach(s => { pipeline[s.stage] = s.c; });
        } catch { }

        res.json({
            ok: true,
            today: {
                replies,
                engagements,
                alerts,
                dms,
                scans: scansToday,
                newLeads: leadsToday,
                totalActions: replies + engagements + alerts + dms,
            },
            pipeline,
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

module.exports = router;
