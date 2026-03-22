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

console.log('☢️  Starting Nuclear Force Migration...');

const schema = {
    raw_posts: {
        source_platform: 'TEXT DEFAULT "facebook"',
        source_type: 'TEXT',
        external_post_id: 'TEXT',
        group_name: 'TEXT',
        author_name: 'TEXT',
        author_profile_url: 'TEXT',
        post_url: 'TEXT',
        post_text: 'TEXT',
        scraped_at: 'TEXT',
        posted_at: 'TEXT'
    },
    post_classifications: {
        raw_post_id: 'INTEGER',
        model_name: 'TEXT',
        is_relevant: 'INTEGER',
        entity_type: 'TEXT',
        seller_likelihood: 'INTEGER',
        pain_score: 'INTEGER',
        intent_score: 'INTEGER',
        resolution_confidence: 'INTEGER',
        contactability_score: 'INTEGER',
        competitor_probability: 'INTEGER',
        recommended_lane: 'TEXT',
        reason_summary: 'TEXT'
    },
    identity_clues: {
        account_id: 'INTEGER',
        raw_post_id: 'INTEGER',
        clue_type: 'TEXT',
        clue_value: 'TEXT',
        discovered_by: 'TEXT'
    },
    lead_cards: {
        raw_post_id: 'INTEGER',
        account_id: 'INTEGER',
        lane: 'TEXT',
        strategic_summary: 'TEXT',
        suggested_opener: 'TEXT',
        objection_prevention: 'TEXT',
        next_best_action: 'TEXT',
        sales_priority_score: 'INTEGER'
    },
    scan_logs: {
        platform: 'TEXT',
        posts_found: 'INTEGER',
        leads_detected: 'INTEGER',
        duration_seconds: 'INTEGER',
        status: 'TEXT'
    }
};

for (const [table, cols] of Object.entries(schema)) {
    const currentCols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
    for (const [col, type] of Object.entries(cols)) {
        if (!currentCols.includes(col)) {
            console.log(`➕ Adding missing column [${col}] to [${table}]...`);
            try {
                db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
                console.log(`✨ Success: ${table}.${col} added.`);
            } catch (err) {
                console.error(`❌ Failed: ${err.message}`);
            }
        }
    }
}

console.log('🏁 Nuclear Migration Complete.');
db.close();
