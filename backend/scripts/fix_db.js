/**
 * SIS v2: Absolute Database Migration (v2.4)
 * 
 * Rebuilds tables with legacy constraints and purges v1 "dust" tables.
 * Usage: node backend/scripts/fix_db.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'leads.db');
if (!fs.existsSync(DB_PATH)) {
    console.log('🌱 Database missing. Creating fresh SIS v2 Database...');
    // Create directory if it doesn't exist
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

console.log('☢️  Starting Absolute Force Migration v2.4...');

// 1. Radical Purge: Delete legacy v1 tables and deduplicated v2 tables to avoid "Data Chaos"
const legacyTables = ['leads', 'analysis_results', 'group_members', 'search_tasks', 'agents', 'messages', 'v1_posts', 'accounts', 'identity_clues', 'lead_cards'];
legacyTables.forEach(t => {
    try {
        db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
        console.log(`🧹 Purged legacy table: ${t}`);
    } catch (e) { }
});

const schema = {
    raw_posts: {
        cols: ['source_platform', 'source_type', 'external_post_id', 'group_name', 'author_name', 'author_profile_url', 'post_url', 'post_text', 'scraped_at', 'posted_at'],
        create: `CREATE TABLE raw_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_platform TEXT NOT NULL DEFAULT 'facebook',
        source_type TEXT NOT NULL,
        external_post_id TEXT UNIQUE NOT NULL,
        group_name TEXT, group_id TEXT, author_name TEXT, author_profile_url TEXT,
        author_external_id TEXT, post_url TEXT, post_text TEXT, post_language TEXT,
        links_found TEXT DEFAULT '[]', media_urls TEXT DEFAULT '[]',
        engagement_json TEXT DEFAULT '{}', top_comments TEXT DEFAULT '[]',
        scraped_at TEXT DEFAULT (datetime('now')), posted_at TEXT, raw_payload TEXT DEFAULT '{}'
      )`
    },
    post_classifications: {
        cols: ['raw_post_id', 'model_name', 'is_relevant', 'entity_type', 'seller_likelihood', 'pain_score', 'intent_score', 'resolution_confidence', 'contactability_score', 'competitor_probability', 'recommended_lane', 'reason_summary', 'strategic_summary', 'suggested_opener', 'objection_prevention', 'next_best_action', 'sales_priority_score', 'identity_clues'],
        create: `CREATE TABLE post_classifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id) ON DELETE CASCADE,
        model_name TEXT NOT NULL, is_relevant INTEGER NOT NULL, entity_type TEXT NOT NULL,
        seller_likelihood INTEGER NOT NULL, pain_score INTEGER NOT NULL, intent_score INTEGER NOT NULL,
        resolution_confidence INTEGER NOT NULL, contactability_score INTEGER NOT NULL,
        competitor_probability INTEGER NOT NULL, pain_tags TEXT DEFAULT '[]', market_tags TEXT DEFAULT '[]',
        seller_stage_estimate TEXT DEFAULT 'unknown', recommended_lane TEXT NOT NULL,
        reason_summary TEXT, confidence TEXT DEFAULT 'low', raw_response TEXT DEFAULT '{}',
        strategic_summary TEXT, suggested_opener TEXT, objection_prevention TEXT,
        next_best_action TEXT, sales_priority_score INTEGER DEFAULT 0, identity_clues TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now'))
      )`
    },
    scan_logs: {
        cols: ['platform', 'posts_found', 'leads_detected', 'duration_seconds', 'status'],
        create: `CREATE TABLE scan_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        platform TEXT, keywords_used TEXT, posts_found INTEGER DEFAULT 0,
        leads_detected INTEGER DEFAULT 0, duration_seconds INTEGER DEFAULT 0,
        status TEXT DEFAULT 'running', error TEXT, started_at TEXT DEFAULT (datetime('now'))
      )`
    }
};

for (const [table, config] of Object.entries(schema)) {
    const tableExists = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='?';`.replace('?', table)).get();

    if (!tableExists) {
        console.log(`🌱 Creating fresh table [${table}]...`);
        db.exec(config.create);
        continue;
    }

    const currentTableInfo = db.prepare(`PRAGMA table_info(${table})`).all();
    const currentColNames = currentTableInfo.map(c => c.name);

    // Check for 1. Missing columns OR 2. Legacy NOT NULL columns
    const missingCols = config.cols.filter(c => !currentColNames.includes(c));
    const legacyNotNull = currentTableInfo.filter(c => c.notnull === 1 && !config.cols.includes(c.name) && c.name !== 'id');

    if (missingCols.length > 0 || legacyNotNull.length > 0) {
        console.log(`☢️  ABSOLUTE SYNC: Rebuilding [${table}]...`);
        try {
            db.transaction(() => {
                db.prepare(`ALTER TABLE ${table} RENAME TO ${table}_old`).run();
                db.exec(config.create);
                const commonCols = currentColNames.filter(c => config.cols.includes(c));
                if (commonCols.length > 0) {
                    const colsStr = commonCols.join(', ');
                    db.prepare(`INSERT INTO ${table} (${colsStr}) SELECT ${colsStr} FROM ${table}_old`).run();
                }
                db.prepare(`DROP TABLE ${table}_old`).run();
            })();
            console.log(`✅ [${table}] successfully rebuilt.`);
        } catch (err) {
            console.error(`❌ Failed: ${err.message}`);
        }
    }
}

console.log('🏁 Absolute Migration v2.4 Complete.');
db.close();
