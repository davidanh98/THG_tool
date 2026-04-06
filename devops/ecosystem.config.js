/**
 * PM2 Ecosystem Config — Production Deployment (3-Tier Architecture)
 *
 * Usage:
 *   pm2 start ecosystem.config.js     — start all 3 processes
 *   pm2 reload ecosystem.config.js    — rolling reload
 *   pm2 stop all
 *   pm2 logs --lines 50
 *   pm2 monit
 *
 * Architecture:
 *   thg-api        → Lightweight Express API (dashboard + webhooks)
 *   thg-scraper    → Playwright scraper (polls scan_queue, heavy CPU/RAM)
 *   thg-ai-worker  → AI classifier (polls raw_leads, I/O-bound)
 */

module.exports = {
    apps: [
        // ── API Server (Lightweight) ─────────────────────────────────────
        {
            name: 'thg-api',
            script: 'backend/index.js',
            cwd: require('path').join(__dirname, '..'),

            exec_mode: 'fork',
            instances: 1,

            env: {
                NODE_ENV: 'production',
                ENABLED_PLATFORMS: 'facebook',
                MAX_POSTS_PER_SCAN: '200',
            },

            // Stability
            autorestart: true,
            max_restarts: 20,
            min_uptime: '15s',
            restart_delay: 3000,
            exp_backoff_restart_delay: 100,

            // Memory — lightweight process, should stay under 200MB
            max_memory_restart: '300M',

            // Timeouts
            kill_timeout: 8000,
            listen_timeout: 15000,
            shutdown_with_message: true,

            watch: false,

            // Logging
            log_file: 'logs/api_combined.log',
            out_file: 'logs/api_out.log',
            error_file: 'logs/api_error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            merge_logs: true,
            max_size: '20M',
        },

        // ── Scraper Worker (Playwright — Heavy) ──────────────────────────
        {
            name: 'thg-scraper',
            script: 'backend/infra/workers/scraperWorker.js',
            cwd: require('path').join(__dirname, '..'),

            exec_mode: 'fork',
            instances: 1,

            env: {
                NODE_ENV: 'production',
            },

            // Stability
            autorestart: true,
            max_restarts: 15,
            min_uptime: '10s',
            restart_delay: 5000,
            exp_backoff_restart_delay: 200,

            // Memory — Playwright can use 400-600MB during scans
            max_memory_restart: '800M',

            kill_timeout: 15000,  // Give Playwright time to close browsers
            shutdown_with_message: true,

            watch: false,

            // Logging
            log_file: 'logs/scraper_combined.log',
            out_file: 'logs/scraper_out.log',
            error_file: 'logs/scraper_error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            merge_logs: true,
            max_size: '30M',

            // Scheduled restart: clear Playwright memory leaks
            cron_restart: '0 3 * * *',  // 3 AM daily
        },

        // ── AI Worker (Classification — I/O-bound) ───────────────────────
        {
            name: 'thg-ai-worker',
            script: 'backend/infra/workers/aiWorker.js',
            cwd: require('path').join(__dirname, '..'),

            exec_mode: 'fork',
            instances: 1,

            env: {
                NODE_ENV: 'production',
            },

            // Stability
            autorestart: true,
            max_restarts: 20,
            min_uptime: '10s',
            restart_delay: 3000,

            // Memory — AI SDKs + responses, should stay light
            max_memory_restart: '300M',

            kill_timeout: 8000,
            shutdown_with_message: true,

            watch: false,

            // Logging
            log_file: 'logs/ai_worker_combined.log',
            out_file: 'logs/ai_worker_out.log',
            error_file: 'logs/ai_worker_error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
            merge_logs: true,
            max_size: '20M',
        },

        // ── Identity Worker (Profile Resolution — I/O-bound) ──────────
        {
            name: 'thg-identity-worker',
            script: 'backend/infra/workers/identityWorker.js',
            cwd: require('path').join(__dirname, '..'),

            exec_mode: 'fork',
            instances: 1,

            env: {
                NODE_ENV: 'production',
            },

            autorestart: true,
            max_restarts: 10,
            restart_delay: 5000,

            // Memory
            max_memory_restart: '300M',

            log_file: 'logs/identity_worker_combined.log',
            out_file: 'logs/identity_worker_out.log',
            error_file: 'logs/identity_worker_error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
        },

        // ── Risk Agent (AI Self-healing — Lightweight) ────────────────────
        {
            name: 'thg-risk-agent',
            script: 'ai/agents/riskAgent.js',
            cwd: require('path').join(__dirname, '..'),

            exec_mode: 'fork',
            instances: 1,

            env: {
                NODE_ENV: 'production',
            },

            autorestart: true,
            max_restarts: 10,
            restart_delay: 5000,

            max_memory_restart: '150M',

            log_file: 'logs/risk_agent_combined.log',
            out_file: 'logs/risk_agent_out.log',
            error_file: 'logs/risk_agent_error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
        },

        // ── Session Health Worker (Auto cookie renewal every 6h) ──────────
        {
            name: 'thg-session-health',
            script: 'backend/infra/workers/sessionHealthWorker.js',
            cwd: require('path').join(__dirname, '..'),

            exec_mode: 'fork',
            instances: 1,

            env: {
                NODE_ENV: 'production',
            },

            autorestart: true,
            max_restarts: 5,
            min_uptime: '30s',
            restart_delay: 30000, // 30s delay — don't spam re-login on crash

            // Playwright during re-login cycles
            max_memory_restart: '400M',

            kill_timeout: 30000,

            log_file: 'logs/session_health_combined.log',
            out_file: 'logs/session_health_out.log',
            error_file: 'logs/session_health_error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
        },

        // ── Outreach Worker (Phase 7 Bridge: SIS v2 → Squad Queue) ────────
        {
            name: 'thg-outreach-worker',
            script: 'backend/infra/workers/outreachWorker.js',
            cwd: require('path').join(__dirname, '..'),

            exec_mode: 'fork',
            instances: 1,

            env: {
                NODE_ENV: 'production',
            },

            autorestart: true,
            max_restarts: 15,
            min_uptime: '10s',
            restart_delay: 5000,

            // Very lightweight — just DB polling
            max_memory_restart: '150M',

            kill_timeout: 5000,

            log_file: 'logs/outreach_worker_combined.log',
            out_file: 'logs/outreach_worker_out.log',
            error_file: 'logs/outreach_worker_error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
        },

        // ── Squad Runner (Comment Actor — 4h cycles) ───────────────────────
        {
            name: 'thg-squad-runner',
            script: 'ai/squad/squadRunner.js',
            cwd: require('path').join(__dirname, '..'),

            exec_mode: 'fork',
            instances: 1,

            args: '--cron',

            env: {
                NODE_ENV: 'production',
                SQUAD_CYCLE_HOURS: '4',
            },

            autorestart: true,
            max_restarts: 10,
            min_uptime: '30s',
            restart_delay: 10000,

            // Playwright browser during comment cycles
            max_memory_restart: '600M',

            kill_timeout: 20000,
            shutdown_with_message: true,

            log_file: 'logs/squad_runner_combined.log',
            out_file: 'logs/squad_runner_out.log',
            error_file: 'logs/squad_runner_error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
        },

        // ── Social Worker (Inbox Monitor + AI Reply — 24/7) ────────────────
        {
            name: 'thg-social-worker',
            script: 'backend/infra/workers/socialWorker.js',
            cwd: require('path').join(__dirname, '..'),

            exec_mode: 'fork',
            instances: 1,

            env: {
                NODE_ENV: 'production',
            },

            autorestart: true,
            max_restarts: 15,
            min_uptime: '15s',
            restart_delay: 8000,
            exp_backoff_restart_delay: 100,

            // Playwright for inbox reading
            max_memory_restart: '500M',

            kill_timeout: 15000,
            shutdown_with_message: true,

            log_file: 'logs/social_worker_combined.log',
            out_file: 'logs/social_worker_out.log',
            error_file: 'logs/social_worker_error.log',
            log_date_format: 'YYYY-MM-DD HH:mm:ss',
        },

    ],
};
