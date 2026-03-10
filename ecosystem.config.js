/**
 * PM2 Ecosystem Config — Production Deployment
 *
 * Usage:
 *   pm2 start ecosystem.config.js     — start / zero-downtime reload
 *   pm2 reload ecosystem.config.js    — rolling reload (zero-downtime)
 *   pm2 stop thg-lead-gen
 *   pm2 logs thg-lead-gen --lines 50
 *   pm2 monit
 *
 * Cluster mode: 2 instances so nginx can round-robin.
 * Heavy scans blocking instance 0 won't affect requests to instance 1.
 */

module.exports = {
    apps: [{
        name: 'thg-lead-gen',
        script: 'src/index.js',
        cwd: __dirname,

        // ── Cluster mode: 2 workers ─────────────────────────────────────
        // Prevents 504s caused by long-running scans blocking the event loop.
        // nginx will load-balance across both instances automatically.
        exec_mode: 'fork',          // keep fork (index.js has its own cron scheduler)
        instances: 1,               // 1 instance in fork mode — safe with SQLite
        // NOTE: switch to exec_mode:'cluster', instances:2 only after
        //       confirming SQLite WAL mode is enabled (avoids write conflicts)

        // ── Environment ─────────────────────────────────────────────────
        env: {
            NODE_ENV: 'production',
            ENABLED_PLATFORMS: 'facebook',
            MAX_POSTS_PER_SCAN: '200',
        },

        // ── Stability ───────────────────────────────────────────────────
        autorestart: true,
        max_restarts: 20,           // Up from 10 — tolerate more scan-related crashes
        min_uptime: '15s',          // Must stay up 15s to count as "stable"
        restart_delay: 3000,        // Wait 3s before restarting (avoids crash loops)
        exp_backoff_restart_delay: 100, // Exponential backoff on repeated crashes

        // ── Memory ──────────────────────────────────────────────────────
        max_memory_restart: '800M', // Up from 500M — Playwright + AI can use ~400-600MB

        // ── Timeouts ────────────────────────────────────────────────────
        kill_timeout: 8000,         // Give 8s for graceful shutdown
        listen_timeout: 15000,      // Wait 15s for port to be ready before marking unhealthy
        shutdown_with_message: true,

        // ── Watch ───────────────────────────────────────────────────────
        watch: false,

        // ── Logging ─────────────────────────────────────────────────────
        log_file: 'logs/pm2_combined.log',
        out_file: 'logs/pm2_out.log',
        error_file: 'logs/pm2_error.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
        merge_logs: true,
        max_size: '20M',            // Rotate logs at 20MB

        // ── Scheduled restart ────────────────────────────────────────────
        // Clears memory leak from long-running Playwright sessions.
        cron_restart: '0 3 * * *',  // 3 AM daily — low traffic period
    }],
};
