/**
 * THG Group Discovery Agent
 * 
 * Kho dữ liệu FB groups — nền tảng để thay SociaVault dần dần.
 * Lưu trữ 100+ groups với relevance scoring, auto-discovery, và sync với scan rotation.
 * 
 * Schema: fb_groups (id, name, url, group_id, member_count, category, relevance_score, status, discovered_at, last_scanned_at)
 */

const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'groups.db');

let _db = null;
function getDb() {
    if (_db) return _db;
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    initSchema();
    return _db;
}

function initSchema() {
    _db.exec(`
        CREATE TABLE IF NOT EXISTS fb_groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            url TEXT UNIQUE NOT NULL,
            group_id TEXT,
            member_count INTEGER DEFAULT 0,
            category TEXT DEFAULT 'unknown',
            relevance_score INTEGER DEFAULT 50,
            status TEXT DEFAULT 'active',
            notes TEXT DEFAULT '',
            discovered_at TEXT DEFAULT (datetime('now')),
            last_scanned_at TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_fsg_status ON fb_groups(status);
        CREATE INDEX IF NOT EXISTS idx_fsg_cat ON fb_groups(category);
        CREATE INDEX IF NOT EXISTS idx_fsg_score ON fb_groups(relevance_score);
    `);
    // Seed data nếu chưa có
    const count = _db.prepare('SELECT COUNT(*) as c FROM fb_groups').get().c;
    if (count === 0) {
        seedGroups();
        console.log('[GroupDB] 🌱 Seeded', _db.prepare('SELECT COUNT(*) as c FROM fb_groups').get().c, 'groups');
    }
}

// ════════════════════════════════════════════════════════
// CRUD Operations
// ════════════════════════════════════════════════════════

function upsertGroup(group) {
    const stmt = _db.prepare(`
        INSERT INTO fb_groups (name, url, group_id, member_count, category, relevance_score, notes)
        VALUES (@name, @url, @group_id, @member_count, @category, @relevance_score, @notes)
        ON CONFLICT(url) DO UPDATE SET
            name = excluded.name,
            group_id = COALESCE(excluded.group_id, fb_groups.group_id),
            member_count = CASE WHEN excluded.member_count > 0 THEN excluded.member_count ELSE fb_groups.member_count END,
            relevance_score = excluded.relevance_score
    `);
    return stmt.run({
        name: group.name,
        url: group.url,
        group_id: extractGroupId(group.url),
        member_count: group.member_count || 0,
        category: group.category || 'unknown',
        relevance_score: group.relevance_score || 50,
        notes: group.notes || '',
    });
}

function extractGroupId(url) {
    if (!url) return null;
    const match = url.match(/\/groups\/(\d+)/);
    return match ? match[1] : null;
}

function getActiveGroups(limit = 50) {
    return getDb().prepare(`
        SELECT * FROM fb_groups 
        WHERE status = 'active' AND relevance_score >= 40
        ORDER BY relevance_score DESC, last_scanned_at ASC NULLS FIRST
        LIMIT ?
    `).all(limit);
}

function getTopGroups(limit = 20) {
    return getDb().prepare(`
        SELECT * FROM fb_groups 
        WHERE status = 'active'
        ORDER BY relevance_score DESC
        LIMIT ?
    `).all(limit);
}

function markScanned(url) {
    getDb().prepare(`UPDATE fb_groups SET last_scanned_at = datetime('now') WHERE url = ?`).run(url);
}

function updateScore(url, score) {
    getDb().prepare(`UPDATE fb_groups SET relevance_score = ? WHERE url = ?`).run(score, url);
}

function setStatus(url, status) {
    getDb().prepare(`UPDATE fb_groups SET status = ? WHERE url = ?`).run(status, url);
}

function getStats() {
    const db = getDb();
    const total = db.prepare('SELECT COUNT(*) as c FROM fb_groups').get().c;
    const active = db.prepare("SELECT COUNT(*) as c FROM fb_groups WHERE status = 'active'").get().c;
    const byCategory = db.prepare('SELECT category, COUNT(*) as c FROM fb_groups GROUP BY category ORDER BY c DESC').all();
    const highScore = db.prepare('SELECT COUNT(*) as c FROM fb_groups WHERE relevance_score >= 70').get().c;
    return { total, active, highScore, byCategory };
}

function getAllGroups(filters = {}) {
    const db = getDb();
    let q = 'SELECT * FROM fb_groups WHERE 1=1';
    const params = [];
    if (filters.category) { q += ' AND category = ?'; params.push(filters.category); }
    if (filters.status) { q += ' AND status = ?'; params.push(filters.status); }
    q += ' ORDER BY relevance_score DESC, name ASC';
    if (filters.limit) { q += ' LIMIT ?'; params.push(filters.limit); }
    return db.prepare(q).all(...params);
}

// ════════════════════════════════════════════════════════
// SEED DATA — 107 groups discovered by browser agent
// Categories: logistics | tq-goods | viet-kieu | ecommerce | marketplace
// Relevance: 80-95 = Tier1 (buyer intent cao), 60-79 = Tier2, 40-59 = Tier3
// ════════════════════════════════════════════════════════

function seedGroups() {
    const insert = _db.prepare(`
        INSERT OR IGNORE INTO fb_groups (name, url, group_id, member_count, category, relevance_score)
        VALUES (?, ?, ?, ?, ?, ?)
    `);

    const groups = [
        // === LOGISTICS / SHIPPING (Cat 1) — Relevance 70-90 ===
        ['Vận Chuyển Mỹ - Việt & Quốc Tế', 'https://www.facebook.com/groups/ship.viet.my', null, 75000, 'logistics', 85],
        ['Mua Hộ Order Vận Chuyển Hàng Mỹ', 'https://www.facebook.com/groups/vanchuyenhangmy', null, 108000, 'logistics', 88],
        ['CỘNG ĐỒNG VẬN CHUYỂN HÀNG HOÁ VIỆT - MỸ', 'https://www.facebook.com/groups/198874301317672', '198874301317672', 13000, 'logistics', 90],
        ['GỬI HÀNG ĐI MỸ', 'https://www.facebook.com/groups/511057606227863', '511057606227863', 15000, 'logistics', 92],
        ['Vận Chuyển Hàng Hóa Quốc Tế - Mỹ, Úc, CA', 'https://www.facebook.com/groups/1769375073378312', '1769375073378312', 33000, 'logistics', 85],
        ['VẬN CHUYỂN HÀNG ĐI MỸ - ÚC - CANADA', 'https://www.facebook.com/groups/2733989140224151', '2733989140224151', 0, 'logistics', 82],
        ['Gửi Hàng Đi Mỹ - Úc - Canada - Châu Âu', 'https://www.facebook.com/groups/2485669168339896', '2485669168339896', 0, 'logistics', 82],
        ['Vận Chuyển Quốc Tế', 'https://www.facebook.com/groups/369902271922489', '369902271922489', 0, 'logistics', 78],
        ['HỘI VẬN CHUYỂN HÀNG HÓA QUỐC TẾ', 'https://www.facebook.com/groups/hoivanchuyenhanghoaquocte', null, 36000, 'logistics', 80],
        ['VẬN CHUYỂN HÀNG HÓA QUỐC TẾ', 'https://www.facebook.com/groups/vanchuyenhhqt', null, 42000, 'logistics', 80],
        ['VẬN CHUYỂN QUỐC TẾ', 'https://www.facebook.com/groups/vanchuyenquocte.hcm', null, 21000, 'logistics', 78],
        ['CHUYỂN PHÁT NHANH QUỐC TẾ', 'https://www.facebook.com/groups/chuyenphatnhanhquocte.hcm', null, 12000, 'logistics', 75],
        ['Vận Chuyển Hàng Mỹ Việt Giá Rẻ', 'https://www.facebook.com/groups/2347372242199015', '2347372242199015', 0, 'logistics', 83],
        ['Gửi hàng đi Mỹ', 'https://www.facebook.com/groups/701183890614920', '701183890614920', 0, 'logistics', 82],
        ['Gửi hàng đi Mỹ - Canada - Úc - NZ', 'https://www.facebook.com/groups/2272449176537942', '2272449176537942', 0, 'logistics', 80],
        ['Gửi hàng đi Mỹ,Úc,Canada,Nhật Bản,...', 'https://www.facebook.com/groups/guihangdimyre', null, 0, 'logistics', 78],
        ['Gửi Hàng Đi Mỹ (2)', 'https://www.facebook.com/groups/guihangdimy', null, 0, 'logistics', 78],
        ['Gửi hàng đi Mỹ, Úc, Canada, Pháp...', 'https://www.facebook.com/groups/356310528854487', '356310528854487', 0, 'logistics', 76],
        ['Gửi hàng đi Mỹ, Úc, Canada giá rẻ', 'https://www.facebook.com/groups/965976281069076', '965976281069076', 0, 'logistics', 76],
        ['Gửi Hàng Đi Mỹ giá rẻ (2)', 'https://www.facebook.com/groups/1600769086782925', '1600769086782925', 0, 'logistics', 74],

        // === TQ CROSS-BORDER ONLY (not TQ→VN imports) ===
        ['Đặt Hàng TQ Giao US/EU', 'https://www.facebook.com/groups/1157826901501932', '1157826901501932', 0, 'tq-goods', 92],
        ['Đặt Hàng TQ Ship ĐNA & US', 'https://www.facebook.com/groups/778601457112289', '778601457112289', 0, 'tq-goods', 90],
        ['Order Hàng TQ - Vận Chuyển XNK', 'https://www.facebook.com/groups/1698840756986636', '1698840756986636', 21000, 'tq-goods', 88],
        ['Order hàng Trung Quốc - XNK', 'https://www.facebook.com/groups/109909824518356', '109909824518356', 0, 'tq-goods', 80],

    ];

    const insertMany = _db.transaction((rows) => {
        for (const [name, url, group_id, member_count, category, relevance_score] of rows) {
            insert.run(name, url, group_id, member_count, category, relevance_score);
        }
    });
    insertMany(groups);
}

// ════════════════════════════════════════════════════════
// Sync top groups → config.FB_TARGET_GROUPS dynamically
// Called by scraperEngine to always use DB-driven list
// ════════════════════════════════════════════════════════
function getScanRotationList(limit = 30) {
    const groups = getDb().prepare(`
        SELECT name, url FROM fb_groups
        WHERE status = 'active' AND relevance_score >= 30
        ORDER BY relevance_score DESC, last_scanned_at ASC NULLS FIRST
        LIMIT ?
    `).all(limit);
    return groups.map(g => ({ name: g.name, url: g.url }));
}

// ════════════════════════════════════════════════════════
// Auto-deactivate dead groups (called by fbScraper)
// ════════════════════════════════════════════════════════
function deactivateGroup(url) {
    try {
        const result = getDb().prepare(`
            UPDATE fb_groups SET status = 'dead' WHERE url = ?
        `).run(url);
        if (result.changes > 0) {
            console.log(`[GroupDB] 💀 Deactivated dead group: ${url}`);
        }
    } catch (err) {
        console.warn(`[GroupDB] ⚠️ Failed to deactivate: ${err.message}`);
    }
}

module.exports = {
    getDb,
    upsertGroup,
    getActiveGroups,
    getTopGroups,
    getAllGroups,
    getScanRotationList,
    markScanned,
    updateScore,
    setStatus,
    getStats,
    extractGroupId,
    deactivateGroup,
};
