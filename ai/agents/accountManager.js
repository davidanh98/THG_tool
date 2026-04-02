/**
 * CrawBot Account Manager v1.0
 * 
 * Quản lý nhiều tài khoản Facebook cho hệ thống quét tự động:
 * - Xoay vòng (rotate) tài khoản theo trạng thái sức khỏe
 * - Gán proxy 1:1 cho mỗi tài khoản (tránh Chain-ban)
 * - Phát hiện và xử lý Checkpoint tự động
 * - Cửa sổ thời gian hoạt động (8h - 23h VN)
 * - Hành vi giống người dùng thật (Like dạo, nghỉ ngơi)
 */

'use strict';

const path = require('path');
const fs = require('fs');
const db = require('../../backend/core/data_store/database');

// ─── Activity Time Window ─────────────────────────────────────────────────
// Quét giờ seller Việt Kiều Mỹ active (23h VN → 13h VN hôm sau = 8am-10pm ET)
const ACTIVE_HOUR_START = 23;  // 23h VN = 8am ET
const ACTIVE_HOUR_END = 13;  // 13h VN = 10pm ET hôm trước
const SESSIONS_DIR = path.join(__dirname, '..', '..', 'data', 'fb_sessions');

// ─── DB Migration: tạo bảng fb_accounts nếu chưa có ────────────────────
function ensureAccountsTable() {
    db.db.exec(`
        CREATE TABLE IF NOT EXISTS fb_accounts (
            id          TEXT PRIMARY KEY,
            email       TEXT NOT NULL UNIQUE,
            password    TEXT NOT NULL,
            proxy_url   TEXT DEFAULT '',
            status      TEXT DEFAULT 'active',
            -- active | checkpoint | banned | resting
            checkpoint_count INTEGER DEFAULT 0,
            last_used   TEXT DEFAULT '',
            last_scan   TEXT DEFAULT '',
            session_path TEXT DEFAULT '',
            trust_score INTEGER DEFAULT 100,
            -- 100 = fresh, drops on checkpoint, recovers on rest
            notes       TEXT DEFAULT '',
            created_at  TEXT DEFAULT (datetime('now'))
        );
    `);

    // Seed tài khoản từ .env — hỗ trợ nhiều account:
    // FB_ACCOUNT_1_EMAIL, FB_ACCOUNT_1_PASSWORD (mới)
    // FB_EMAIL, FB_PASSWORD (cũ — compat)
    const accountsToSeed = [];

    // Migration to ensure sales_name column exists before we insert VIPs
    try { db.db.exec(`ALTER TABLE fb_accounts ADD COLUMN sales_name TEXT DEFAULT ''`); } catch { }

    // Multi-account format: FB_ACCOUNT_1_EMAIL, FB_ACCOUNT_2_EMAIL, ...
    let i = 1;
    while (process.env[`FB_ACCOUNT_${i}_EMAIL`]) {
        const email = process.env[`FB_ACCOUNT_${i}_EMAIL`];
        const accName = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
        const proxyUrl = process.env[`PROXY_${accName}`] || process.env[`PROXY_${email.split('@')[0]}`] || '';

        accountsToSeed.push({
            id: `account_${i}`,
            email: email,
            password: process.env[`FB_ACCOUNT_${i}_PASSWORD`] || '',
            proxy_url: proxyUrl,
            sales_name: process.env[`FB_ACCOUNT_${i}_AGENT`] || 'Đức Anh',
            role: process.env[`FB_ACCOUNT_${i}_ROLE`] || 'scraper'
        });
        i++;
    }

    // Legacy single-account format (backwards compat)
    if (accountsToSeed.length === 0 && process.env.FB_EMAIL) {
        const email = process.env.FB_EMAIL;
        const accName = email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '_');
        const proxyUrl = process.env[`PROXY_${accName}`] || process.env[`PROXY_${email.split('@')[0]}`] || '';
        accountsToSeed.push({
            id: 'default',
            email: email,
            password: process.env.FB_PASSWORD || '',
            proxy_url: proxyUrl,
            sales_name: 'Đức Anh',
            role: 'scraper'
        });
    }

    for (const acct of accountsToSeed) {
        const sessionPath = path.join(SESSIONS_DIR, `${acct.email.replace(/[^a-z0-9]/gi, '_')}.json`);
        db.db.prepare(`
            INSERT INTO fb_accounts (id, email, password, proxy_url, session_path, sales_name, role)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(email) DO UPDATE SET 
                password = excluded.password,
                proxy_url = excluded.proxy_url,
                sales_name = excluded.sales_name,
                role = excluded.role
        `).run(acct.id, acct.email, acct.password, acct.proxy_url, sessionPath, acct.sales_name, acct.role);
        console.log(`[AccountManager] 📋 Seeded & Mapped VIP: ${acct.email} ➡️ Agent ${acct.sales_name} [${acct.role}]`);
    }

    // Migration: link FB account role
    try { db.db.exec(`ALTER TABLE fb_accounts ADD COLUMN role TEXT DEFAULT 'any'`); } catch { }

    // --- Load Scraper Accounts from JSON (since .env is Git ignored) ---
    try {
        const scrapersPath = path.join(__dirname, '..', '..', 'backend', 'config', 'scraper_accounts.json');
        if (fs.existsSync(scrapersPath)) {
            const scraperAccs = JSON.parse(fs.readFileSync(scrapersPath, 'utf8'));
            for (const acct of scraperAccs) {
                const sessionPath = path.join(SESSIONS_DIR, `${acct.email.replace(/[^a-z0-9]/gi, '_')}.json`);
                const role = acct.role || 'any';

                db.db.prepare(`
                    INSERT OR IGNORE INTO fb_accounts (id, email, password, proxy_url, session_path, role)
                    VALUES (?, ?, ?, ?, ?, ?)
                `).run(`acc_${acct.email}`, acct.email, acct.password, acct.proxyUrl || '', sessionPath, role);

                // Sync updates to role and proxy if changed in JSON
                db.db.prepare(`UPDATE fb_accounts SET role = ?, proxy_url = ? WHERE email = ?`)
                    .run(role, acct.proxyUrl || '', acct.email);

                // Auto-generate Playwright session file if missing
                if (!fs.existsSync(sessionPath) && acct.cookieStr) {
                    const pwCookies = acct.cookieStr.split(';').map(p => p.trim()).filter(Boolean).map(pair => {
                        const [name, ...val] = pair.split('=');
                        return { name, value: val.join('='), domain: ".facebook.com", path: "/", expires: Date.now() / 1000 + 31536000, httpOnly: ['xs', 'c_user', 'datr', 'fr'].includes(name), secure: true, sameSite: "None" };
                    });
                    fs.writeFileSync(sessionPath, JSON.stringify([{ cookies: pwCookies, origins: [{ origin: "https://www.facebook.com", localStorage: [] }] }]));
                    console.log(`[AccountManager] 🍪 Generated session for clone [${role}]: ${acct.email}`);
                }
            }
        }
    } catch (err) { console.warn('[AccountManager] ⚠️ Error loading scraper_accounts.json:', err.message); }

    fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

ensureAccountsTable();

// Migration: link FB account to Sales person
try { db.db.exec(`ALTER TABLE fb_accounts ADD COLUMN sales_name TEXT DEFAULT ''`); } catch { }

// ─── Get account linked to a Sales name ──────────────────────────────────
function getAccountBySalesName(salesName) {
    return db.db.prepare(
        `SELECT * FROM fb_accounts WHERE sales_name = ? AND status = 'active' LIMIT 1`
    ).get(salesName);
}

function linkAccountToSales(email, salesName) {
    db.db.prepare(`UPDATE fb_accounts SET sales_name = ? WHERE email = ?`).run(salesName, email);
    console.log(`[AccountManager] 🔗 ${email} → ${salesName}`);
}

// ─── Time Window Check ───────────────────────────────────────────────────
function isInActiveWindow() {
    // VN time = UTC + 7
    const vnHour = (new Date().getUTCHours() + 7) % 24;
    // Active: 23h-23h59 (buổi tối VN) HOẶC 0h-13h59 (sáng VN = sáng ET)
    return vnHour >= ACTIVE_HOUR_START || vnHour <= ACTIVE_HOUR_END;
}

/**
 * Lấy tài khoản tốt nhất để sử dụng ngay bây giờ.
 * Ưu tiên: trust_score cao → ít dùng gần đây → proxy sẵn sàng
 * @param {object} options - { forScraping: boolean, preferSocial: boolean, exclude: string[] }
 * @returns {object|null} account row or null
 */
function getNextAccount(options = {}) {
    const roleFilter = options.forScraping
        ? `AND (role = 'scraper' OR role = 'any')`
        : options.preferSocial
            ? `AND (role = 'social' OR role = 'any')`
            : `AND (role = 'social' OR role = 'any')`;

    // Build exclude clause for retry rotation
    let excludeClause = '';
    if (options.exclude && options.exclude.length > 0) {
        const placeholders = options.exclude.map(() => '?').join(',');
        excludeClause = `AND id NOT IN (${placeholders}) AND email NOT IN (${placeholders})`;
    }
    const excludeParams = options.exclude ? [...options.exclude, ...options.exclude] : [];

    // Thêm cool-down: không dùng account vừa dùng trong 10 phút
    const account = db.db.prepare(`
        SELECT * FROM fb_accounts
        WHERE status = 'active'
          AND trust_score > 20
          AND (last_used IS NULL OR datetime(last_used) < datetime('now', '-10 minutes'))
          ${roleFilter}
          ${excludeClause}
        ORDER BY trust_score DESC, last_used ASC
        LIMIT 1
    `).get(...excludeParams);

    if (!account) {
        // Fallback: try without cool-down
        const fallback = db.db.prepare(`
            SELECT * FROM fb_accounts
            WHERE status = 'active'
              AND trust_score > 20
              ${roleFilter}
              ${excludeClause}
            ORDER BY trust_score DESC, last_used ASC
            LIMIT 1
        `).get(...excludeParams);

        if (fallback) {
            db.db.prepare(`UPDATE fb_accounts SET last_used=datetime('now') WHERE id=?`).run(fallback.id);
            return fallback;
        }

        // Kiểm tra tài khoản đang resting có thể phục hồi không (2h thay vì 4h)
        const resting = db.db.prepare(`
            SELECT * FROM fb_accounts
            WHERE status = 'resting'
              AND datetime(last_used) < datetime('now', '-2 hours')
              ${roleFilter}
            LIMIT 1
        `).get();

        if (resting) {
            console.log(`[AccountManager] 🔄 Phục hồi tài khoản ${resting.email} (đã nghỉ đủ 2h)`);
            db.db.prepare(`UPDATE fb_accounts SET status='active', trust_score=MIN(trust_score+30, 100) WHERE id=?`).run(resting.id);
            return resting;
        }

        console.log('[AccountManager] ❌ Không có tài khoản nào sẵn sàng!');
        return null;
    }

    // Đánh dấu tài khoản đang được dùng
    db.db.prepare(`UPDATE fb_accounts SET last_used=datetime('now') WHERE id=?`).run(account.id);
    console.log(`[AccountManager] ✅ Dùng tài khoản [${account.role}]: ${account.email} (trust=${account.trust_score}, proxy=${account.proxy_url || 'none'})`);
    return account;
}

/**
 * Báo cáo tài khoản bị Checkpoint — graduated trust penalty
 * Lần 1: -20, Lần 2: -30, Lần 3+: -50
 * @param {string} accountId
 */
function reportCheckpoint(accountId) {
    const acc = db.db.prepare('SELECT * FROM fb_accounts WHERE id=? OR email=?').get(accountId, accountId);
    if (!acc) return;

    const newCheckpointCount = (acc.checkpoint_count || 0) + 1;

    // Graduated penalty: lighter on first offense, heavier on repeat
    let penalty;
    if (newCheckpointCount === 1) penalty = 20;
    else if (newCheckpointCount === 2) penalty = 30;
    else penalty = 50;

    const newTrust = Math.max(0, (acc.trust_score || 100) - penalty);
    const newStatus = newTrust <= 10 ? 'banned' : 'resting';

    // Rest duration adapts: 2h for first, 4h for second, 8h+ for repeat
    db.db.prepare(`
        UPDATE fb_accounts
        SET status=?, trust_score=?, checkpoint_count=?, last_used=datetime('now')
        WHERE id=?
    `).run(newStatus, newTrust, newCheckpointCount, acc.id);

    console.log(`[AccountManager] 🚨 CHECKPOINT #${newCheckpointCount}: ${acc.email} → trust=${newTrust} (penalty=-${penalty}), status=${newStatus}`);

    if (newStatus === 'banned') {
        console.log(`[AccountManager] 💀 ${acc.email} BANNED — ${newCheckpointCount} checkpoints. Cần giải manual.`);
    } else {
        const restHours = newCheckpointCount === 1 ? 2 : newCheckpointCount === 2 ? 4 : 8;
        console.log(`[AccountManager] 😴 ${acc.email} REST — phục hồi sau ~${restHours}h`);
    }
}

/**
 * Báo cáo quét thành công — tăng trust score nhẹ
 * @param {string} accountId
 * @param {number} postsFound
 */
function reportSuccess(accountId, postsFound = 0) {
    db.db.prepare(`
        UPDATE fb_accounts
        SET trust_score = MIN(trust_score + 5, 100),
            last_scan = datetime('now'),
            last_used = datetime('now')
        WHERE id=?
    `).run(accountId);

    const acc = db.db.prepare('SELECT email, trust_score FROM fb_accounts WHERE id=?').get(accountId);
    if (acc) {
        console.log(`[AccountManager] 📈 ${acc.email}: +5 trust → ${acc.trust_score} (${postsFound} posts)`);
    }
}

/**
 * Lấy session path cho account
 * @param {object} account 
 * @returns {string}
 */
function getSessionPath(account) {
    if (account.session_path && account.session_path.trim()) {
        return account.session_path.trim();
    }
    return path.join(SESSIONS_DIR, `${account.email.replace(/[^a-z0-9]/gi, '_')}.json`);
}

/**
 * Thêm tài khoản mới vào pool
 * @param {object} opts - { email, password, proxyUrl, notes }
 */
function addAccount({ email, password, proxyUrl = '', notes = '' }) {
    const id = `acc_${Date.now()}`;
    const sessionPath = path.join(SESSIONS_DIR, `${email.replace(/[^a-z0-9]/gi, '_')}.json`);

    db.db.prepare(`
        INSERT OR REPLACE INTO fb_accounts (id, email, password, proxy_url, session_path, notes)
        VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, email, password, proxyUrl || '', sessionPath, notes);

    console.log(`[AccountManager] ➕ Thêm tài khoản: ${email} (proxy: ${proxyUrl || 'none'})`);
    return id;
}

/**
 * Xem trạng thái toàn bộ pool tài khoản
 * @returns {object[]}
 */
function getPoolStatus() {
    return db.db.prepare(`
        SELECT email, status, trust_score, checkpoint_count,
               last_scan, proxy_url,
               CASE WHEN proxy_url != '' THEN '✅' ELSE '❌' END as has_proxy
        FROM fb_accounts
        ORDER BY trust_score DESC
    `).all();
}

/**
 * Đặt lại trạng thái tài khoản về active (dùng thủ công sau khi giải checkpoint)
 * @param {string} email
 */
function resetAccount(email) {
    db.db.prepare(`
        UPDATE fb_accounts
        SET status='active', trust_score=70, checkpoint_count=0
        WHERE email=?
    `).run(email);
    console.log(`[AccountManager] 🔄 Reset ${email} → active, trust=70`);
}

/**
 * Reset ALL accounts to active — use when all accounts are stuck in resting/banned
 * @returns {{ changes: number }}
 */
function resetAllAccounts() {
    const result = db.db.prepare(`
        UPDATE fb_accounts
        SET status='active', trust_score=80, checkpoint_count=0
    `).run();
    console.log(`[AccountManager] 🔄 RESET ALL → ${result.changes} accounts set to active, trust=80`);
    return { changes: result.changes };
}

/**
 * Human-like: Thỉnh thoảng cho bot nghỉ (simulate off-peak)
 * Xác suất 5% mỗi phiên (giảm từ 10%)
 * @param {string} accountId
 * @returns {boolean} true = account đang nghỉ
 */
function shouldRest(accountId) {
    // Check if account is already in resting state
    const acc = db.db.prepare('SELECT status FROM fb_accounts WHERE id=? OR email=?').get(accountId, accountId);
    if (acc && acc.status === 'resting') return true;

    // 5% random rest (reduced from 10% for stability)
    if (Math.random() < 0.05) {
        db.db.prepare(`UPDATE fb_accounts SET status='resting', last_used=datetime('now','-1.5 hours') WHERE id=? OR email=?`).run(accountId, accountId);
        console.log(`[AccountManager] 😴 Random rest (human-like)`);
        return true;
    }
    return false;
}

/**
 * Get ALL active accounts (for splitting groups across accounts)
 * @param {object} options - { forScraping: boolean }
 * @returns {object[]} array of active account rows
 */
function getActiveAccounts(options = {}) {
    const roleFilter = options.forScraping
        ? `AND (role = 'scraper' OR role = 'any')`
        : `AND (role = 'social' OR role = 'any')`;

    const accounts = db.db.prepare(`
        SELECT * FROM fb_accounts
        WHERE status = 'active'
          AND trust_score > 20
          ${roleFilter}
        ORDER BY trust_score DESC
    `).all();

    // Also recover resting accounts that have rested enough
    const resting = db.db.prepare(`
        SELECT * FROM fb_accounts
        WHERE status = 'resting'
          AND datetime(last_used) < datetime('now', '-4 hours')
          ${roleFilter}
    `).all();

    for (const acc of resting) {
        db.db.prepare(`UPDATE fb_accounts SET status='active', trust_score=MIN(trust_score+30, 100) WHERE id=?`).run(acc.id);
        accounts.push({ ...acc, status: 'active' });
    }

    return accounts;
}

module.exports = {
    getNextAccount,
    getActiveAccounts,
    getAccountBySalesName,
    linkAccountToSales,
    reportCheckpoint,
    reportSuccess,
    getSessionPath,
    addAccount,
    getPoolStatus,
    resetAccount,
    resetAllAccounts,
    shouldRest,
    isInActiveWindow,
    SESSIONS_DIR,
};
