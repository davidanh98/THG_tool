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
        // ═══════════════════════════════════════════════════════
        // CORE E-COMMERCE SELLER GROUPS — Amazon, Shopify, Etsy, POD, Dropship
        // ═══════════════════════════════════════════════════════

        // === AMAZON FBA / FBM SELLERS ===
        ['Amazon Seller Việt Nam', 'https://www.facebook.com/groups/amazonsellervietnam', null, 200000, 'ecommerce', 95],
        ['Cộng Đồng Amazon Seller VN', 'https://www.facebook.com/groups/congdongamazonsellervietnam', null, 100000, 'ecommerce', 95],
        ['Cộng đồng Amazon VN', 'https://www.facebook.com/groups/congdongamazonvn', null, 0, 'ecommerce', 90],
        ['Amazon FBA Vietnam', 'https://www.facebook.com/groups/430998570008556', '430998570008556', 0, 'ecommerce', 92],
        ['VECOM FBA - Vietnam Sellers on Amazon', 'https://www.facebook.com/groups/vietnamsellersonamazon', null, 0, 'ecommerce', 90],
        ['Amazon Global Selling VN Community', 'https://www.facebook.com/groups/amazonglobalsellingvn', null, 0, 'ecommerce', 88],
        ['Sourcing From Vietnam - Amazon FBA', 'https://www.facebook.com/groups/sourcingfromvietnam', null, 0, 'ecommerce', 92],

        // === SHOPIFY / WOOCOMMERCE SELLERS ===
        ['Cộng đồng Shopify Việt Nam', 'https://www.facebook.com/groups/congdongshopifyvietnam', null, 0, 'ecommerce', 90],
        ['Shopify Việt Nam', 'https://www.facebook.com/groups/shopifyvn', null, 0, 'ecommerce', 88],
        ['Shopify & Dropship VN', 'https://www.facebook.com/groups/514921692619278', '514921692619278', 0, 'ecommerce', 88],
        ['Kiếm Tiền Shopify - Dropshipping - FBA', 'https://www.facebook.com/groups/kiemtienvoishopifly', null, 0, 'ecommerce', 85],
        ['Shopify Vietnam Community (Meowcart)', 'https://www.facebook.com/groups/shopifyvietnamcommunity', null, 0, 'ecommerce', 85],
        ['WooCommerce Vietnam', 'https://www.facebook.com/groups/woocommercevietnam', null, 0, 'ecommerce', 80],

        // === ETSY SELLERS ===
        ['Etsy Việt Nam', 'https://www.facebook.com/groups/etsyvietnam', null, 0, 'ecommerce', 88],
        ['Cộng đồng ETSY Việt Nam', 'https://www.facebook.com/groups/congdongetsyvietnam', null, 0, 'ecommerce', 85],

        // === POD / PRINT ON DEMAND ===
        ['POD Vietnam Sellers', 'https://www.facebook.com/groups/112253537621629', '112253537621629', 0, 'ecommerce', 92],
        ['Customily Vietnam Community', 'https://www.facebook.com/groups/customilyvietnam', null, 0, 'ecommerce', 95],
        ['Printify Vietnam', 'https://www.facebook.com/groups/printifyvietnam', null, 0, 'ecommerce', 88],
        ['ShopBase VN - Dropship & POD', 'https://www.facebook.com/groups/shopbasevn', null, 0, 'ecommerce', 85],

        // === DROPSHIPPING / FULFILLMENT ===
        ['Dropshipping - POD Vietnam', 'https://www.facebook.com/groups/273760436440263', '273760436440263', 50000, 'ecommerce', 92],
        ['Tìm Supplier Fulfill POD/Drop', 'https://www.facebook.com/groups/1312868109620530', '1312868109620530', 0, 'ecommerce', 95],
        ['Dropship & Fulfill VN', 'https://www.facebook.com/groups/646444174604027', '646444174604027', 0, 'ecommerce', 92],
        ['CỘNG ĐỒNG DROPSHIPPING & FBA VN', 'https://www.facebook.com/groups/congdongdropshippingfbavn', null, 0, 'ecommerce', 90],
        ['Dropship Việt Nam - Vươn Ra Biển Lớn', 'https://www.facebook.com/groups/dropshipvietnam', null, 0, 'ecommerce', 88],
        ['Cộng Đồng Dropshipping Việt Nam', 'https://www.facebook.com/groups/congdongdropshippingvietnam', null, 0, 'ecommerce', 85],
        ['Cộng Đồng Dropship Việt Nam', 'https://www.facebook.com/groups/congdongdropshipvn', null, 0, 'ecommerce', 85],

        // === TIKTOK SHOP / E-COMMERCE GENERAL ===
        ['TikTok Shop US Underground', 'https://www.facebook.com/groups/1631859190422638', '1631859190422638', 0, 'ecommerce', 88],
        ['Seller E-commerce VN', 'https://www.facebook.com/groups/494286704652111', '494286704652111', 0, 'ecommerce', 85],

        // === CROSS-BORDER / SOURCING (E-COM FOCUSED) ===
        ['Đặt Hàng TQ Giao US/EU', 'https://www.facebook.com/groups/1157826901501932', '1157826901501932', 0, 'cross-border', 92],
        ['Đặt Hàng TQ Ship ĐNA & US', 'https://www.facebook.com/groups/778601457112289', '778601457112289', 0, 'cross-border', 90],
        ['Order Hàng TQ - Vận Chuyển XNK', 'https://www.facebook.com/groups/1698840756986636', '1698840756986636', 21000, 'cross-border', 88],
        ['Order hàng Trung Quốc - XNK', 'https://www.facebook.com/groups/109909824518356', '109909824518356', 0, 'cross-border', 85],

        // === E-COM FULFILLMENT LOGISTICS (buyer-focused, not generic shipping) ===
        ['Vận chuyển Quốc tế VN', 'https://www.facebook.com/groups/914341367037223', '914341367037223', 0, 'fulfillment', 82],
        ['CỘNG ĐỒNG VẬN CHUYỂN HÀNG HOÁ VIỆT - MỸ', 'https://www.facebook.com/groups/198874301317672', '198874301317672', 13000, 'fulfillment', 80],

        // ═══════════════════════════════════════════════════════
        // EU / INTERNATIONAL E-COMMERCE SELLER GROUPS
        // (Amazon/Shopify/Etsy sellers targeting UK, DE, FR markets)
        // ═══════════════════════════════════════════════════════

        // === AMAZON FBA EUROPE ===
        ['Amazon FBA UK & Europe', 'https://www.facebook.com/groups/amazonfbauk', null, 0, 'ecommerce-eu', 88],
        ['Amazon FBA UK Sellers', 'https://www.facebook.com/groups/amazonfbauksellers', null, 0, 'ecommerce-eu', 88],
        ['Amazon FBA Wholesale Deals UK', 'https://www.facebook.com/groups/amazonfbawholesaleuk', null, 0, 'ecommerce-eu', 85],
        ['Amazon FBA Europe', 'https://www.facebook.com/groups/amazonfbaeurope', null, 0, 'ecommerce-eu', 85],
        ['The Amazing European Seller (DE/UK/FR)', 'https://www.facebook.com/groups/theamazingeuropeanseller', null, 0, 'ecommerce-eu', 90],
        ['Amazon DE Sellers Community', 'https://www.facebook.com/groups/971577527971421', '971577527971421', 0, 'ecommerce-eu', 88],

        // === EU DROPSHIP / POD / CROSS-BORDER ===
        ['Dropshipping Europe', 'https://www.facebook.com/groups/dropshippingeurope', null, 0, 'ecommerce-eu', 82],
        ['Ecommerce Europe Sellers', 'https://www.facebook.com/groups/ecommerceeuropesellers', null, 0, 'ecommerce-eu', 80],
        ['FBA Europe - German Sellers', 'https://www.facebook.com/groups/fbaeuropegerman', null, 0, 'ecommerce-eu', 82],
        ['Amazon FBA France Sellers', 'https://www.facebook.com/groups/amazonfbafrance', null, 0, 'ecommerce-eu', 82],
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
