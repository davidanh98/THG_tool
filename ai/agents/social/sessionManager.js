/**
 * 🕐 Session Manager — Timing & Scheduling
 * 
 * Controls WHEN the Social Agent runs to mimic real human patterns:
 * - Random session length (8-20 min)
 * - Random intervals between sessions (30-90 min)
 * - Active hours only (no 3am activity)
 * - 10% chance to skip a session ("busy")
 * 
 * @module agent/social/sessionManager
 */
const crypto = require('crypto');

// ─── Config ──────────────────────────────────────────────────────────────────
const ACTIVE_HOURS = { start: 8, end: 22 }; // VN time
const SESSION_MIN_MS = 8 * 60 * 1000;       // 8 minutes
const SESSION_MAX_MS = 20 * 60 * 1000;      // 20 minutes
const INTERVAL_MIN_MS = 30 * 60 * 1000;     // 30 minutes between sessions
const INTERVAL_MAX_MS = 90 * 60 * 1000;     // 90 minutes between sessions
const SKIP_CHANCE = 0.10;                    // 10% chance to skip a session

// ─── State ─────────────────────────────────────────────────────────────────────
let _running = false;
let _currentSessionId = null;
let _sessionCount = 0;
let _timer = null;

// Adaptive scheduling state
let _dangerLevel = 0;            // 0 = normal, 1+ = danger (doubles interval)
let _lastCheckpointTime = null;  // Track when last checkpoint happened
let _checkpointCount = 0;        // Rolling count for this session loop

/**
 * Generate a unique session ID
 */
function generateSessionId() {
    return `session_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

/**
 * Random integer between min and max (inclusive)
 */
function randInt(min, max) {
    return Math.floor(min + Math.random() * (max - min + 1));
}

/**
 * Random milliseconds between min and max
 */
function randMs(minMs, maxMs) {
    return minMs + Math.random() * (maxMs - minMs);
}

/**
 * Check if current hour falls within active window
 * @returns {boolean}
 */
function isActiveHour() {
    const hour = new Date().getHours();
    return hour >= ACTIVE_HOURS.start && hour < ACTIVE_HOURS.end;
}

/**
 * Decide if we should skip this session (simulates "being busy")
 * @returns {boolean}
 */
function shouldSkipSession() {
    return Math.random() < SKIP_CHANCE;
}

/**
 * Get how long this session should last (ms)
 * @returns {number}
 */
function getSessionDuration() {
    return Math.round(randMs(SESSION_MIN_MS, SESSION_MAX_MS));
}

/**
 * Get how long to wait before next session (ms)
 * @returns {number}
 */
function getNextInterval() {
    const base = Math.round(randMs(INTERVAL_MIN_MS, INTERVAL_MAX_MS));

    // Adaptive: multiply interval based on danger level
    const multiplier = Math.pow(2, Math.min(_dangerLevel, 3)); // max 8x
    const adjusted = base * multiplier;

    // Auto-normalize danger: if no checkpoint in 2 hours, reduce danger
    if (_dangerLevel > 0 && _lastCheckpointTime) {
        const hoursSinceCheckpoint = (Date.now() - _lastCheckpointTime) / (1000 * 60 * 60);
        if (hoursSinceCheckpoint > 2) {
            _dangerLevel = Math.max(0, _dangerLevel - 1);
            console.log(`[SessionMgr] 🟢 Danger reduced to ${_dangerLevel} (no checkpoint in ${hoursSinceCheckpoint.toFixed(1)}h)`);
        }
    }

    if (_dangerLevel > 0) {
        console.log(`[SessionMgr] ⚠️ Danger level ${_dangerLevel} — interval ${multiplier}x longer`);
    }

    return adjusted;
}

/**
 * Start a new session — returns session metadata
 * @returns {{ sessionId: string, duration: number, startedAt: Date }}
 */
function startSession() {
    _sessionCount++;
    _currentSessionId = generateSessionId();
    const duration = getSessionDuration();
    console.log(`[SessionMgr] 🟢 Session #${_sessionCount} started (${_currentSessionId})`);
    console.log(`[SessionMgr]    Duration: ${Math.round(duration / 60000)} min`);
    return {
        sessionId: _currentSessionId,
        duration,
        startedAt: new Date(),
        sessionNumber: _sessionCount,
    };
}

/**
 * End current session
 */
function endSession() {
    console.log(`[SessionMgr] 🔴 Session ended (${_currentSessionId})`);
    _currentSessionId = null;
}

/**
 * Schedule the next session run
 * @param {Function} runFn — async function to execute
 * @returns {number} interval in ms
 */
function scheduleNext(runFn) {
    const interval = getNextInterval();
    console.log(`[SessionMgr] ⏰ Next session in ${Math.round(interval / 60000)} min`);
    _timer = setTimeout(async () => {
        if (!_running) return;
        if (!isActiveHour()) {
            console.log(`[SessionMgr] 😴 Outside active hours (${ACTIVE_HOURS.start}h-${ACTIVE_HOURS.end}h) — skipping`);
            if (_running) scheduleNext(runFn);
            return;
        }
        if (shouldSkipSession()) {
            console.log(`[SessionMgr] 🚶 Randomly skipping this session (simulating "busy")`);
            if (_running) scheduleNext(runFn);
            return;
        }
        try {
            await runFn();
        } catch (e) {
            console.error(`[SessionMgr] ❌ Session error: ${e.message}`);
        }
        if (_running) scheduleNext(runFn);
    }, interval);
    return interval;
}

/**
 * Start the session loop
 */
function start(runFn) {
    _running = true;
    _sessionCount = 0;
    console.log(`[SessionMgr] ✅ Social Agent scheduler started`);
    // Run first session after a short warm-up delay (5-30s)
    const firstDelay = randMs(5000, 30000);
    _timer = setTimeout(async () => {
        if (!_running) return;
        try { await runFn(); } catch (e) { console.error(`[SessionMgr] ❌ ${e.message}`); }
        if (_running) scheduleNext(runFn);
    }, firstDelay);
}

/**
 * Stop the session loop
 */
function stop() {
    _running = false;
    if (_timer) clearTimeout(_timer);
    _timer = null;
    console.log(`[SessionMgr] 🛑 Social Agent scheduler stopped (${_sessionCount} sessions completed)`);
}

/**
 * Report danger — checkpoint(s) detected, increase intervals
 */
function reportDanger() {
    _dangerLevel = Math.min(_dangerLevel + 1, 3); // max level 3 (8x)
    _lastCheckpointTime = Date.now();
    _checkpointCount++;
    console.log(`[SessionMgr] 🟡 DANGER raised to level ${_dangerLevel} (total checkpoints: ${_checkpointCount})`);
}

/**
 * Report safe — successful session, reduce danger
 */
function reportSafe() {
    if (_dangerLevel > 0) {
        _dangerLevel = Math.max(0, _dangerLevel - 1);
        console.log(`[SessionMgr] 🟢 Danger reduced to ${_dangerLevel} after successful session`);
    }
}

/**
 * Get current status
 */
function getStatus() {
    return {
        running: _running,
        currentSession: _currentSessionId,
        totalSessions: _sessionCount,
        isActiveHour: isActiveHour(),
        activeHours: ACTIVE_HOURS,
        dangerLevel: _dangerLevel,
        checkpointCount: _checkpointCount,
    };
}

module.exports = {
    startSession,
    endSession,
    isActiveHour,
    shouldSkipSession,
    getSessionDuration,
    getNextInterval,
    scheduleNext,
    start,
    stop,
    getStatus,
    randInt,
    randMs,
    generateSessionId,
    reportDanger,
    reportSafe,
};
