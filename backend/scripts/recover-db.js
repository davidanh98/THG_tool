'use strict';

var path = require('path');
var fs = require('fs');

var PROJECT_ROOT = path.join(__dirname, '..', '..');
var DATA_DIR = path.join(PROJECT_ROOT, 'data');
var DB_PATH = path.join(DATA_DIR, 'leads.db');
var WAL_PATH = DB_PATH + '-wal';
var SHM_PATH = DB_PATH + '-shm';
var BAK_PATH = DB_PATH + '.bak_' + Date.now();

console.log('');
console.log('========================================');
console.log('  SIS v2 - DB RECOVERY (Simple Mode)   ');
console.log('========================================');
console.log('');

// Step 1: Check
console.log('[1/4] Checking DB file...');
if (!fs.existsSync(DB_PATH)) {
    console.log('  INFO: DB file not found. Nothing to recover.');
    console.log('  Just start the app - it will create a fresh DB.');
    process.exit(0);
}
var sizekb = (fs.statSync(DB_PATH).size / 1024).toFixed(1);
console.log('  Found: ' + DB_PATH + ' (' + sizekb + ' KB)');

// Step 2: Backup
console.log('[2/4] Creating backup...');
try {
    fs.copyFileSync(DB_PATH, BAK_PATH);
    console.log('  Backup saved: ' + path.basename(BAK_PATH));
} catch (e) {
    console.log('  ERROR: Cannot create backup: ' + e.message);
    process.exit(1);
}

// Step 3: Delete corrupted files
console.log('[3/4] Removing corrupted DB files...');
try {
    fs.unlinkSync(DB_PATH);
    console.log('  Deleted: leads.db');
} catch (e) {
    console.log('  WARNING: ' + e.message);
}
if (fs.existsSync(WAL_PATH)) {
    try { fs.unlinkSync(WAL_PATH); console.log('  Deleted: leads.db-wal'); } catch (e) { }
}
if (fs.existsSync(SHM_PATH)) {
    try { fs.unlinkSync(SHM_PATH); console.log('  Deleted: leads.db-shm'); } catch (e) { }
}

// Step 4: Create fresh DB
console.log('[4/4] Creating fresh DB...');
var Database = require('better-sqlite3');
var db;
try {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec([
        'CREATE TABLE IF NOT EXISTS raw_posts (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
        '  source_platform TEXT NOT NULL DEFAULT "facebook",',
        '  source_type TEXT NOT NULL,',
        '  external_post_id TEXT UNIQUE NOT NULL,',
        '  group_name TEXT, group_id TEXT, author_name TEXT,',
        '  author_profile_url TEXT, author_external_id TEXT,',
        '  post_url TEXT, post_text TEXT, post_language TEXT,',
        '  links_found TEXT DEFAULT \'[]\', media_urls TEXT DEFAULT \'[]\',',
        '  engagement_json TEXT DEFAULT \'{}\', top_comments TEXT DEFAULT \'[]\',',
        '  scraped_at TEXT DEFAULT CURRENT_TIMESTAMP, posted_at TEXT,',
        '  raw_payload TEXT DEFAULT \'{}\');',

        'CREATE TABLE IF NOT EXISTS post_classifications (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
        '  raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id) ON DELETE CASCADE,',
        '  model_name TEXT NOT NULL, is_relevant INTEGER NOT NULL,',
        '  entity_type TEXT NOT NULL, seller_likelihood INTEGER NOT NULL,',
        '  pain_score INTEGER NOT NULL, intent_score INTEGER NOT NULL,',
        '  resolution_confidence INTEGER NOT NULL, contactability_score INTEGER NOT NULL,',
        '  competitor_probability INTEGER NOT NULL,',
        '  pain_tags TEXT DEFAULT \'[]\', market_tags TEXT DEFAULT \'[]\',',
        '  seller_stage_estimate TEXT DEFAULT \'unknown\', recommended_lane TEXT NOT NULL,',
        '  reason_summary TEXT, confidence TEXT DEFAULT \'low\',',
        '  raw_response TEXT DEFAULT \'{}\', created_at TEXT DEFAULT CURRENT_TIMESTAMP);',

        'CREATE TABLE IF NOT EXISTS identity_clues (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
        '  account_id INTEGER, raw_post_id INTEGER REFERENCES raw_posts(id) ON DELETE CASCADE,',
        '  clue_type TEXT NOT NULL, clue_value TEXT NOT NULL,',
        '  confidence_score INTEGER DEFAULT 0, discovered_by TEXT NOT NULL,',
        '  created_at TEXT DEFAULT CURRENT_TIMESTAMP);',

        'CREATE TABLE IF NOT EXISTS accounts (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
        '  brand_name TEXT, primary_domain TEXT, primary_email TEXT,',
        '  primary_page_url TEXT, instagram_handle TEXT, tiktok_handle TEXT,',
        '  seller_likelihood INTEGER DEFAULT 0, pain_score INTEGER DEFAULT 0,',
        '  intent_score INTEGER DEFAULT 0, resolution_confidence INTEGER DEFAULT 0,',
        '  sales_priority_score INTEGER DEFAULT 0, account_status TEXT DEFAULT \'active\',',
        '  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);',

        'CREATE TABLE IF NOT EXISTS lead_cards (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
        '  raw_post_id INTEGER REFERENCES raw_posts(id) ON DELETE SET NULL,',
        '  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,',
        '  lane TEXT NOT NULL, strategic_summary TEXT, suggested_opener TEXT,',
        '  objection_prevention TEXT, next_best_action TEXT,',
        '  sales_priority_score INTEGER DEFAULT 0,',
        '  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);',

        'CREATE TABLE IF NOT EXISTS scan_queue (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
        '  job_type TEXT NOT NULL DEFAULT \'FULL_SCAN\', status TEXT DEFAULT \'PENDING\',',
        '  platforms TEXT DEFAULT \'facebook\', max_posts INTEGER DEFAULT 200,',
        '  options TEXT DEFAULT \'{}\', result TEXT DEFAULT \'\', error TEXT DEFAULT \'\',',
        '  created_at TEXT DEFAULT CURRENT_TIMESTAMP, started_at TEXT, finished_at TEXT);',

        'CREATE TABLE IF NOT EXISTS scan_logs (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT, keywords_used TEXT,',
        '  posts_found INTEGER DEFAULT 0, leads_detected INTEGER DEFAULT 0,',
        '  duration_seconds INTEGER DEFAULT 0, status TEXT DEFAULT \'running\',',
        '  error TEXT, started_at TEXT DEFAULT CURRENT_TIMESTAMP);',

        'CREATE TABLE IF NOT EXISTS feedback (',
        '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
        '  raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id) ON DELETE CASCADE,',
        '  is_correct INTEGER NOT NULL, corrected_lane TEXT, feedback_text TEXT,',
        '  created_at TEXT DEFAULT CURRENT_TIMESTAMP);',

        'CREATE INDEX IF NOT EXISTS idx_scan_queue_status ON scan_queue(status);'
    ].join('\n'));

    var check = db.pragma('integrity_check', { simple: true });
    db.close();

    if (check === 'ok') {
        console.log('  Fresh DB created and integrity verified OK!');
    } else {
        console.log('  WARNING: Integrity check: ' + check);
    }

} catch (e) {
    console.log('  ERROR creating fresh DB: ' + e.message);
    process.exit(1);
}

console.log('');
console.log('========================================');
console.log('  RECOVERY COMPLETE!');
console.log('========================================');
console.log('');
console.log('Next steps:');
console.log('  1. node backend/scripts/healthcheck.js');
console.log('  2. If HEALTHY -> pm2 start ecosystem.config.js');
console.log('');
console.log('Backup at: ' + path.basename(BAK_PATH));
console.log('Delete backup after confirming system is OK.');
console.log('');
