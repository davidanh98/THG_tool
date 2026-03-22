/**
 * SIS v2: Force Database Migration
 * 
 * Run this manually if self-healing migration is blocked by SQLite locks.
 * Usage: node backend/scripts/fix_db.js
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', '..', 'data', 'leads.db');
if (!fs.existsSync(DB_PATH)) {
    console.error('❌ Database not found at:', DB_PATH);
    process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

console.log('🛠️  Starting Force Migration...');

const fix = (table, col, type) => {
    try {
        db.prepare(`SELECT ${col} FROM ${table} LIMIT 1`).get();
        console.log(`✅ Column [${col}] already exists in [${table}].`);
    } catch (e) {
        if (e.message.includes('no such column')) {
            console.log(`➕ Adding missing column [${col}] to [${table}]...`);
            try {
                db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
                console.log(`✨ Success: ${table}.${col} added.`);
            } catch (err) {
                console.error(`❌ Failed to add ${table}.${col}:`, err.message);
            }
        } else {
            console.error(`❌ Error checking ${table}.${col}:`, e.message);
        }
    }
};

// Apply all SIS v2.1 schema updates
fix('scan_logs', 'duration_seconds', 'INTEGER');
fix('scan_logs', 'leads_detected', 'INTEGER');
fix('lead_cards', 'account_id', 'INTEGER');
fix('raw_posts', 'source_platform', 'TEXT');
fix('identity_clues', 'account_id', 'INTEGER');

console.log('🏁 Force Migration Complete.');
db.close();
