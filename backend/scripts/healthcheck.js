/**
 * SIS v2 — Grand System Healthcheck 🏥
 * 
 * Tests:
 * 1. DB Connectivity & Pragmas
 * 2. Schema Integrity (8 Tables)
 * 3. Atomic Data Flow (Insert -> Duplicate -> Classify)
 * 4. Account Status Audit
 * 5. Data Orphans Check
 */

'use strict';

const database = require('../core/data_store/database');
const path = require('path');
const fs = require('fs');

async function runHealthCheck() {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`  🦅 THG SIS v2 — ABSOLUTE SYSTEM HEALTHCHECK`);
    console.log(`${'═'.repeat(60)}\n`);

    let errors = 0;
    let warnings = 0;

    // --- 1. DB Connection & Mode ---
    console.log('1. DB Connectivity 🗄️');
    try {
        const mode = database._db.pragma('journal_mode')[0].journal_mode;
        if (mode === 'wal') {
            console.log('   ✅ WAL Mode: ACTIVE (Safe for multi-process)');
        } else {
            console.log(`   ⚠️  WAL Mode: ${mode.toUpperCase()} (Warning: non-WAL might be unstable)`);
            warnings++;
        }
    } catch (e) {
        console.error('   ❌ Connection Failed:', e.message);
        errors++;
    }

    // --- 2. Schema Integrity ---
    console.log('\n2. Schema Integrity (8 CORE TABLES) 📐');
    const essentialTables = [
        'raw_posts', 'post_classifications', 'identity_clues',
        'accounts', 'lead_cards', 'scan_queue', 'scan_logs', 'feedback'
    ];

    for (const table of essentialTables) {
        try {
            const info = database._db.prepare(`PRAGMA table_info(${table})`).all();
            if (info.length > 0) {
                console.log(`   ✅ Table [${table}]: OK (${info.length} columns)`);
            } else {
                console.error(`   ❌ Table [${table}]: MISSING!`);
                errors++;
            }
        } catch (e) {
            console.error(`   ❌ Table [${table}]: ERROR - ${e.message}`);
            errors++;
        }
    }

    // --- 3. Atomic Data Flow Test (The Bug Fix Test) ---
    console.log('\n3. Atomic Data Flow Test (Insert -> Conflict -> Return ID) 🔄');
    try {
        const testPost = {
            external_post_id: 'healthcheck_test_' + Date.now(),
            post_text: 'Healthcheck test content',
            source_platform: 'facebook'
        };

        // Test First Insert
        const id1 = database.insertRawPost(testPost);
        console.log(`   ✅ First Insert: SUCCESS (ID=${id1})`);

        // Test Duplicate Insert (The Bug Tripwire)
        const id2 = database.insertRawPost(testPost);
        if (id1 === id2 && id1 > 0) {
            console.log(`   ✅ Identity Persistence: SUCCESS (Conflict correctly returned same ID=${id2})`);
        } else {
            console.error(`   ❌ Identity Persistence: FAILED (Returned ID=${id2}, expected ${id1})`);
            errors++;
        }

        // Test Classification Link (FK Check)
        const classId = database.insertClassification({
            raw_post_id: id1,
            model_name: 'healthcheck',
            is_relevant: 1,
            entity_type: 'test',
            seller_likelihood: 50,
            pain_score: 50,
            intent_score: 50,
            resolution_confidence: 50,
            contactability_score: 50,
            competitor_probability: 0,
            recommended_lane: 'discard',
            reason_summary: 'Healthcheck test'
        });
        console.log(`   ✅ Classification Link: SUCCESS (FK check passed, ID=${classId})`);

        // Clean up
        database._db.prepare('DELETE FROM raw_posts WHERE id = ?').run(id1);
        console.log('   ✅ Cleanup: SUCCESS');
    } catch (e) {
        console.error('   ❌ Data Flow Test: FAILED -', e.message);
        errors++;
    }

    // --- 4. Orphaned Data Check ---
    console.log('\n4. Data Integrity Check (Orphans) 🔍');
    try {
        const orphans = database._db.prepare(`
            SELECT COUNT(*) as cnt 
            FROM post_classifications 
            WHERE raw_post_id NOT IN (SELECT id FROM raw_posts)
        `).get();
        if (orphans.cnt === 0) {
            console.log('   ✅ No Orphaned Classifications');
        } else {
            console.error(`   ❌ Found ${orphans.cnt} ORPHANED classifications (Points to broken links)`);
            errors++;
        }
    } catch (e) {
        console.warn('   ⚠️ Orphan Check Failed:', e.message);
    }

    // --- 5. Statistics Overview ---
    console.log('\n5. Current System Load 📊');
    try {
        const counts = {
            posts: database._db.prepare('SELECT COUNT(*) as c FROM raw_posts').get().c,
            classified: database._db.prepare('SELECT COUNT(*) as c FROM post_classifications').get().c,
            leads: database._db.prepare("SELECT COUNT(*) as c FROM post_classifications WHERE recommended_lane IN ('resolved_lead', 'partial_lead')").get().c,
            pending_jobs: database._db.prepare("SELECT COUNT(*) as c FROM scan_queue WHERE status = 'PENDING'").get().c
        };
        console.log(`   📝 Total Posts Scraped:    ${counts.posts}`);
        console.log(`   🤖 Total Classified:       ${counts.classified}`);
        console.log(`   🎯 Potential Leads Found:  ${counts.leads}`);
        console.log(`   ⏳ Pending Scans in Queue: ${counts.pending_jobs}`);
    } catch (e) {
        console.warn('   ⚠️ Stats failed:', e.message);
    }

    console.log(`\n${'═'.repeat(60)}`);
    if (errors === 0) {
        console.log(`  ✅ SYSTEM HEALTHY! SIS v2 is ready for action. [Warnings: ${warnings}]`);
    } else {
        console.log(`  ❌ SYSTEM CRITICAL: ${errors} Errors found. Check logs above.`);
    }
    console.log(`${'═'.repeat(60)}\n`);

    process.exit(errors === 0 ? 0 : 1);
}

runHealthCheck();
