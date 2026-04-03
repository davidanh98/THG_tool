/**
 * AI Risk Agent — Self-healing system monitor
 * 
 * Runs every 30 minutes:
 * 1. Reads error logs from SQLite (checkpoint counts, failed requests)
 * 2. Sends to OpenAI for pattern analysis
 * 3. Auto-adjusts system config (delay, limits, pause)
 * 4. Sends Telegram alert for warning/critical
 * 
 * Adapted from Phase 6 workflow — uses SQLite instead of Supabase.
 * 
 * @module ai/agents/riskAgent
 */

'use strict';

const path = require('path');
const Database = require('better-sqlite3');
const { notifyAlert } = require('../../backend/core/integrations/telegramBot');

// ─── Database Setup ─────────────────────────────────────────────────────────────
const DB_PATH = path.join(__dirname, '..', '..', 'data', 'leads.db');
let db;

function getDB() {
    if (!db) {
        db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        // Ensure system_configs table exists
        db.exec(`
            CREATE TABLE IF NOT EXISTS system_configs (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                reason TEXT DEFAULT '',
                updated_at TEXT DEFAULT (datetime('now'))
            );
        `);
        // Ensure system_logs table exists  
        db.exec(`
            CREATE TABLE IF NOT EXISTS system_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                level TEXT DEFAULT 'error',
                source TEXT DEFAULT '',
                account_uid TEXT DEFAULT '',
                error_type TEXT DEFAULT '',
                message TEXT NOT NULL,
                created_at TEXT DEFAULT (datetime('now'))
            );
        `);
        // Seed default configs if not exist
        const defaults = {
            'GLOBAL_DELAY': '60',
            'DAILY_LIMIT': '10',
            'IS_ACTIVE': '1',
            'DANGER_LEVEL': '0',
        };
        const insertConfig = db.prepare(
            `INSERT OR IGNORE INTO system_configs (key, value) VALUES (?, ?)`
        );
        for (const [k, v] of Object.entries(defaults)) {
            insertConfig.run(k, v);
        }
    }
    return db;
}

// ─── Config Read/Write ──────────────────────────────────────────────────────────

function getConfig(key) {
    const row = getDB().prepare('SELECT value FROM system_configs WHERE key = ?').get(key);
    return row ? row.value : null;
}

function setConfig(key, value, reason = '') {
    getDB().prepare(`
        INSERT INTO system_configs (key, value, reason, updated_at) 
        VALUES (?, ?, ?, datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = ?, reason = ?, updated_at = datetime('now')
    `).run(key, String(value), reason, String(value), reason);
}

function getAllConfigs() {
    return getDB().prepare('SELECT * FROM system_configs').all();
}

// ─── Log Management ─────────────────────────────────────────────────────────────

/**
 * Log a system event for Risk Agent analysis
 */
function logEvent(level, source, message, extra = {}) {
    try {
        getDB().prepare(`
            INSERT INTO system_logs (level, source, account_uid, error_type, message)
            VALUES (?, ?, ?, ?, ?)
        `).run(
            level,
            source,
            extra.account_uid || '',
            extra.error_type || '',
            message
        );
    } catch (e) {
        console.warn('[RiskAgent] ⚠️ Log write failed:', e.message);
    }
}

/**
 * Fetch error logs from the last N minutes
 */
function fetchRecentErrors(minutes = 60) {
    const cutoff = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    return getDB().prepare(`
        SELECT * FROM system_logs 
        WHERE created_at > ? AND level IN ('error', 'warning', 'checkpoint')
        ORDER BY created_at DESC
        LIMIT 100
    `).all(cutoff);
}

/**
 * Get checkpoint stats from accounts table
 */
function getAccountHealth() {
    try {
        return getDB().prepare(`
            SELECT email, status, trust_score, checkpoint_count, last_scan
            FROM fb_accounts 
            ORDER BY trust_score ASC
        `).all();
    } catch {
        return [];
    }
}

// ─── AI Analysis ────────────────────────────────────────────────────────────────

/**
 * Analyze error patterns using OpenAI
 * Falls back to rule-based analysis if OpenAI unavailable
 */
async function analyzeRisk(logs, accountHealth) {
    const checkpointCount = logs.filter(l =>
        l.error_type === 'checkpoint' || l.message.includes('checkpoint') || l.message.includes('CHECKPOINT')
    ).length;
    const authErrors = logs.filter(l =>
        l.message.includes('401') || l.message.includes('403') || l.message.includes('login')
    ).length;
    const bannedAccounts = accountHealth.filter(a => a.status === 'banned').length;
    const restingAccounts = accountHealth.filter(a => a.status === 'resting').length;
    const activeAccounts = accountHealth.filter(a => a.status === 'active').length;
    const totalAccounts = accountHealth.length;

    // ── Try AI analysis first ──
    try {
        const { OpenAI } = require('openai');
        const apiKey = process.env.OPENAI_API_KEY;
        if (apiKey && apiKey !== 'your_openai_api_key') {
            const openai = new OpenAI({ apiKey });
            const prompt = `
Bạn là Risk Agent của hệ thống lead generation THG Fulfill.

Dữ liệu lỗi (${logs.length} events trong 1 giờ qua):
- Checkpoint: ${checkpointCount}
- Auth errors (401/403): ${authErrors}
- Accounts: ${activeAccounts} active, ${restingAccounts} resting, ${bannedAccounts} banned / ${totalAccounts} total

Sample errors: ${JSON.stringify(logs.slice(0, 5).map(l => ({ type: l.error_type, msg: l.message.substring(0, 100), src: l.source })))}

Config hiện tại:
- GLOBAL_DELAY: ${getConfig('GLOBAL_DELAY')}s
- DAILY_LIMIT: ${getConfig('DAILY_LIMIT')} group/ngày
- DANGER_LEVEL: ${getConfig('DANGER_LEVEL')}

Trả về JSON:
{
    "status": "safe" | "warning" | "critical",
    "analysis_reason": "lý do ngắn gọn",
    "recommended_configs": {
        "GLOBAL_DELAY": <số giây>,
        "DAILY_LIMIT": <số lượng>,
        "DANGER_LEVEL": <0-3>
    },
    "pause_system": true | false
}`;

            const response = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [{ role: 'system', content: prompt }],
                response_format: { type: 'json_object' },
                temperature: 0.2,
                max_tokens: 300,
            });

            return JSON.parse(response.choices[0].message.content);
        }
    } catch (aiErr) {
        console.warn('[RiskAgent] ⚠️ AI analysis failed, using rule-based:', aiErr.message);
    }

    // ── Fallback: Rule-based analysis ──
    let status = 'safe';
    let reason = 'Hệ thống hoạt động bình thường.';
    let pauseSystem = false;
    const currentDelay = parseInt(getConfig('GLOBAL_DELAY') || '60');
    const currentLimit = parseInt(getConfig('DAILY_LIMIT') || '10');
    let newDelay = currentDelay;
    let newLimit = currentLimit;
    let dangerLevel = parseInt(getConfig('DANGER_LEVEL') || '0');

    if (checkpointCount >= 5 || bannedAccounts >= totalAccounts - 1) {
        status = 'critical';
        reason = `CRITICAL: ${checkpointCount} checkpoints, ${bannedAccounts}/${totalAccounts} banned. Hệ thống tạm dừng.`;
        newDelay = Math.min(currentDelay * 3, 600);
        newLimit = Math.max(Math.floor(currentLimit / 2), 2);
        dangerLevel = 3;
        pauseSystem = bannedAccounts >= totalAccounts;
    } else if (checkpointCount >= 2 || restingAccounts >= Math.ceil(totalAccounts / 2)) {
        status = 'warning';
        reason = `WARNING: ${checkpointCount} checkpoints, ${restingAccounts}/${totalAccounts} đang nghỉ. Tăng delay.`;
        newDelay = Math.min(currentDelay * 2, 300);
        newLimit = Math.max(currentLimit - 2, 3);
        dangerLevel = Math.min(dangerLevel + 1, 3);
    } else if (logs.length === 0 && dangerLevel > 0) {
        // No errors → reduce danger
        dangerLevel = Math.max(dangerLevel - 1, 0);
        newDelay = Math.max(Math.floor(currentDelay * 0.75), 30);
        newLimit = Math.min(currentLimit + 1, 15);
        reason = 'Hệ thống ổn định, giảm danger level.';
    }

    return {
        status,
        analysis_reason: reason,
        recommended_configs: {
            GLOBAL_DELAY: newDelay,
            DAILY_LIMIT: newLimit,
            DANGER_LEVEL: dangerLevel,
        },
        pause_system: pauseSystem,
    };
}

// ─── Main Agent Loop ────────────────────────────────────────────────────────────

/**
 * Run one cycle of risk analysis
 */
async function runRiskAgent() {
    try {
        console.log('[RiskAgent] 🔍 Scanning for risks...');

        const logs = fetchRecentErrors(60);
        const accountHealth = getAccountHealth();

        if (logs.length === 0 && accountHealth.every(a => a.status === 'active')) {
            console.log('[RiskAgent] ✅ System healthy — no errors, all accounts active');
            // Still check if we should reduce danger level
            const dangerLevel = parseInt(getConfig('DANGER_LEVEL') || '0');
            if (dangerLevel > 0) {
                const newLevel = Math.max(dangerLevel - 1, 0);
                setConfig('DANGER_LEVEL', newLevel, 'Auto-recovery: no errors in 1h');
                console.log(`[RiskAgent] 📉 Danger level reduced: ${dangerLevel} → ${newLevel}`);
            }
            return;
        }

        console.log(`[RiskAgent] ⚠️ Found ${logs.length} errors, analyzing...`);

        const decision = await analyzeRisk(logs, accountHealth);

        if (decision.status === 'warning' || decision.status === 'critical') {
            // Apply configs
            for (const [key, value] of Object.entries(decision.recommended_configs)) {
                setConfig(key, value, decision.analysis_reason);
            }
            console.log(`[RiskAgent] 🔧 Configs updated:`, decision.recommended_configs);

            // Pause system if critical
            if (decision.pause_system) {
                setConfig('IS_ACTIVE', '0', 'Risk Agent emergency pause');
                console.log('[RiskAgent] ⛔ SYSTEM PAUSED');
            }

            // Send Telegram alert
            const icon = decision.status === 'critical' ? '🚨' : '⚠️';
            const pauseMsg = decision.pause_system ? '\n⛔ <b>HỆ THỐNG ĐÃ TẠM DỪNG</b>' : '';
            const alertMsg = `
${icon} <b>RISK AGENT — ${decision.status.toUpperCase()}</b>
📊 ${logs.length} lỗi trong giờ qua
🧠 ${decision.analysis_reason}

🔧 <b>Auto-adjust:</b>
- GLOBAL_DELAY → ${decision.recommended_configs.GLOBAL_DELAY}s
- DAILY_LIMIT → ${decision.recommended_configs.DAILY_LIMIT}
- DANGER_LEVEL → ${decision.recommended_configs.DANGER_LEVEL}${pauseMsg}
            `.trim();

            try {
                await notifyAlert(alertMsg);
            } catch (tgErr) {
                console.warn('[RiskAgent] ⚠️ Telegram alert failed:', tgErr.message);
            }
        } else {
            console.log(`[RiskAgent] ✅ Status: ${decision.status} — ${decision.analysis_reason}`);
        }

    } catch (err) {
        console.error('[RiskAgent] 💥 Error:', err.message);
    }
}

// ─── Daemon Mode ────────────────────────────────────────────────────────────────

const INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

function startDaemon() {
    console.log('[RiskAgent] 🚀 Starting daemon (every 30 min)...');
    runRiskAgent(); // Run immediately
    setInterval(runRiskAgent, INTERVAL_MS);
}

// If run directly: `node ai/agents/riskAgent.js`
if (require.main === module) {
    require('dotenv').config();
    startDaemon();
}

module.exports = {
    runRiskAgent,
    startDaemon,
    logEvent,
    getConfig,
    setConfig,
    getAllConfigs,
    fetchRecentErrors,
};
