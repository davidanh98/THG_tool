/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         SIS v2 — DATABASE RECOVERY TOOL                         ║
 * ║                                                                  ║
 * ║  Dùng khi: "database disk image is malformed"                   ║
 * ║                                                                  ║
 * ║  Usage:  node backend/scripts/recover-db.js                     ║
 * ║                                                                  ║
 * ║  Quá trình:                                                      ║
 * ║   1. Backup file DB gốc → leads.db.bak                          ║
 * ║   2. Dùng sqlite3 CLI dump toàn bộ dữ liệu còn sống             ║
 * ║   3. Rebuild DB mới sạch từ dump                                 ║
 * ║   4. Verify DB mới hoạt động bình thường                         ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ─── Paths ───────────────────────────────────────────────────────────────────
const PROJECT_ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(PROJECT_ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'leads.db');
const BAK_PATH = path.join(DATA_DIR, `leads.db.bak_${Date.now()}`);
const DUMP_PATH = path.join(DATA_DIR, 'leads_dump.sql');
const NEW_DB_PATH = path.join(DATA_DIR, 'leads_new.db');

// ─── Colors ──────────────────────────────────────────────────────────────────
const C = {
    reset: '\x1b[0m', bold: '\x1b[1m',
    red: '\x1b[31m', green: '\x1b[32m',
    yellow: '\x1b[33m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const ok = (m) => console.log(`  ${C.green}✅${C.reset} ${m}`);
const fail = (m) => console.log(`  ${C.red}❌${C.reset} ${m}`);
const warn = (m) => console.log(`  ${C.yellow}⚠️${C.reset}  ${m}`);
const info = (m) => console.log(`  ${C.cyan}ℹ️${C.reset}  ${m}`);
const step = (m) => console.log(`\n${C.bold}${C.cyan}▶ ${m}${C.reset}`);
const line = () => console.log(`${C.gray}${'─'.repeat(62)}${C.reset}`);

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log();
    console.log(`${C.bold}${C.cyan}╔══════════════════════════════════════════════════════════════╗${C.reset}`);
    console.log(`${C.bold}${C.cyan}║         SIS v2 — DATABASE RECOVERY TOOL                     ║${C.reset}`);
    console.log(`${C.bold}${C.cyan}╚══════════════════════════════════════════════════════════════╝${C.reset}`);
    console.log();

    // ── Kiểm tra DB gốc có tồn tại không ─────────────────────────────────────
    step('STEP 1 — Kiểm tra DB gốc');

    if (!fs.existsSync(DB_PATH)) {
        fail(`Không tìm thấy DB tại: ${DB_PATH}`);
        fail('Không cần recovery — chạy app để tạo DB mới.');
        process.exit(0);
    }
    const dbSize = (fs.statSync(DB_PATH).size / 1024).toFixed(1);
    ok(`Tìm thấy DB: ${DB_PATH} (${dbSize} KB)`);

    // ── Backup file gốc ───────────────────────────────────────────────────────
    step('STEP 2 — Backup DB gốc');
    try {
        fs.copyFileSync(DB_PATH, BAK_PATH);
        ok(`Backup tạo thành công: ${path.basename(BAK_PATH)}`);
        info('Backup này an toàn, bạn có thể restore bất cứ lúc nào.');
    } catch (e) {
        fail(`Không thể tạo backup: ${e.message}`);
        process.exit(1);
    }

    // ── Thử đọc integrity check ───────────────────────────────────────────────
    step('STEP 3 — Đánh giá mức độ hỏng');

    // Kiểm tra sqlite3 CLI có sẵn không
    const sqlite3Available = (spawnSync('sqlite3', ['--version']).status === 0);

    let recoveryMethod = 'better-sqlite3'; // fallback

    if (sqlite3Available) {
        info('sqlite3 CLI có sẵn → dùng phương pháp .dump (tốt nhất)');
        recoveryMethod = 'sqlite3-cli';
    } else {
        warn('sqlite3 CLI không có → dùng better-sqlite3 fallback');
        info('Cài sqlite3 CLI để recovery tốt hơn: apt install sqlite3');
    }

    // ── Recovery ──────────────────────────────────────────────────────────────
    step('STEP 4 — Recovery dữ liệu');

    if (recoveryMethod === 'sqlite3-cli') {
        // Method A: sqlite3 .dump (best — extracts everything possible)
        try {
            info('Đang dump dữ liệu từ DB hỏng...');

            // sqlite3 tries to recover as much as possible with .dump
            const dumpResult = spawnSync('sqlite3', [DB_PATH, '.dump'], {
                encoding: 'utf8',
                maxBuffer: 200 * 1024 * 1024, // 200MB max
            });

            if (!dumpResult.stdout || dumpResult.stdout.trim().length < 10) {
                warn('Dump rỗng — DB quá hỏng, không cứu được dữ liệu.');
                warn('Sẽ tạo DB mới hoàn toàn sạch.');
                createFreshDB();
            } else {
                // Lọc bỏ các dòng lỗi, chỉ giữ SQL hợp lệ
                const lines = dumpResult.stdout.split('\n');
                const validLines = lines.filter(l => {
                    // Bỏ qua ROLLBACK và các dòng lỗi
                    if (l.startsWith('ROLLBACK')) return false;
                    if (l.includes('malformed')) return false;
                    return true;
                });

                const cleanDump = validLines.join('\n');
                fs.writeFileSync(DUMP_PATH, cleanDump, 'utf8');

                const lineCount = validLines.filter(l => l.trim()).length;
                ok(`Dump hoàn thành: ${lineCount} dòng SQL được cứu`);

                // Import vào DB mới
                info('Đang import vào DB mới...');
                const importResult = spawnSync('sqlite3', [NEW_DB_PATH], {
                    input: cleanDump,
                    encoding: 'utf8',
                });

                if (importResult.status !== 0) {
                    warn(`Import có một số lỗi (thường là bình thường với DB hỏng)`);
                    warn(importResult.stderr?.slice(0, 200) || '');
                } else {
                    ok('Import thành công vào DB mới!');
                }
            }
        } catch (e) {
            warn(`sqlite3 dump gặp lỗi: ${e.message}`);
            warn('Chuyển sang tạo DB mới sạch.');
            createFreshDB();
        }
    } else {
        // Method B: better-sqlite3 fallback — try to read row by row
        info('Thử đọc dữ liệu bằng better-sqlite3...');
        let recovered = 0;

        try {
            const corruptDb = new Database(DB_PATH, { readonly: true, fileMustExist: true });
            const freshDb = new Database(NEW_DB_PATH);

            // Apply same pragmas
            freshDb.pragma('journal_mode = WAL');
            freshDb.pragma('foreign_keys = OFF'); // OFF during import

            // Copy schema từ DB hỏng
            const tables = corruptDb.prepare(
                `SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
            ).all();

            for (const table of tables) {
                if (table.sql) {
                    try {
                        freshDb.exec(table.sql);
                        ok(`Schema copied: ${table.name}`);
                    } catch (e) {
                        warn(`Schema copy failed for ${table.name}: ${e.message}`);
                    }
                }
            }

            // Copy data row by row (skips corrupt pages)
            for (const table of tables) {
                try {
                    const rows = corruptDb.prepare(`SELECT * FROM ${table.name}`).all();
                    if (rows.length === 0) continue;

                    const cols = Object.keys(rows[0]);
                    const placeholders = cols.map(c => `@${c}`).join(', ');
                    const insertStmt = freshDb.prepare(
                        `INSERT OR IGNORE INTO ${table.name} (${cols.join(', ')}) VALUES (${placeholders})`
                    );

                    const insertMany = freshDb.transaction((rowsToInsert) => {
                        for (const row of rowsToInsert) insertStmt.run(row);
                    });

                    insertMany(rows);
                    recovered += rows.length;
                    ok(`${table.name}: ${rows.length} rows recovered`);
                } catch (e) {
                    warn(`${table.name}: partial read — ${e.message}`);
                }
            }

            corruptDb.close();
            freshDb.pragma('foreign_keys = ON');
            freshDb.close();
            ok(`Tổng cộng ${recovered} rows được cứu.`);

        } catch (e) {
            warn(`better-sqlite3 recovery thất bại: ${e.message}`);
            warn('Tạo DB mới hoàn toàn sạch...');
            createFreshDB();
        }
    }

    // ── Verify DB mới ─────────────────────────────────────────────────────────
    step('STEP 5 — Verify DB mới');

    if (!fs.existsSync(NEW_DB_PATH)) {
        warn('DB mới chưa được tạo, đang tạo DB sạch...');
        createFreshDB();
    }

    try {
        const verifyDb = new Database(NEW_DB_PATH);
        verifyDb.pragma('journal_mode = WAL');
        verifyDb.pragma('foreign_keys = ON');

        const integrityCheck = verifyDb.pragma('integrity_check', { simple: true });
        if (integrityCheck === 'ok') {
            ok(`DB mới INTEGRITY CHECK: OK ✓`);
        } else {
            warn(`Integrity: ${integrityCheck}`);
        }

        const tables = verifyDb.prepare(
            `SELECT name FROM sqlite_master WHERE type='table'`
        ).all().map(r => r.name);
        ok(`Tables trong DB mới: ${tables.join(', ')}`);

        verifyDb.close();
    } catch (e) {
        fail(`Verify thất bại: ${e.message}`);
        process.exit(1);
    }

    // ── Swap: DB mới thay thế DB cũ ───────────────────────────────────────────
    step('STEP 6 — Swap DB mới vào production');

    try {
        // Xóa WAL và SHM của DB cũ nếu có
        [DB_PATH + '-wal', DB_PATH + '-shm'].forEach(f => {
            if (fs.existsSync(f)) {
                fs.unlinkSync(f);
                info(`Đã xóa: ${path.basename(f)}`);
            }
        });

        // Thay thế
        fs.renameSync(NEW_DB_PATH, DB_PATH);
        ok(`DB mới đã được swap vào: ${DB_PATH}`);

        // Xóa dump tạm
        if (fs.existsSync(DUMP_PATH)) {
            fs.unlinkSync(DUMP_PATH);
        }

    } catch (e) {
        fail(`Swap thất bại: ${e.message}`);
        info(`Manual fix: mv ${NEW_DB_PATH} ${DB_PATH}`);
        process.exit(1);
    }

    // ── Xong ─────────────────────────────────────────────────────────────────
    line();
    console.log();
    console.log(`${C.bold}${C.green}  ✅ RECOVERY HOÀN THÀNH!${C.reset}`);
    console.log();
    console.log(`  ${C.cyan}Bước tiếp theo:${C.reset}`);
    console.log(`  1. Chạy lại healthcheck:  ${C.bold}node backend/scripts/healthcheck.js${C.reset}`);
    console.log(`  2. Nếu SYSTEM HEALTHY:    ${C.bold}pm2 restart all${C.reset}`);
    console.log();
    console.log(`  ${C.gray}Backup DB cũ được giữ tại: ${path.basename(BAK_PATH)}${C.reset}`);
    console.log(`  ${C.gray}(Có thể xóa sau khi confirm hệ thống OK)${C.reset}`);
    console.log();
}

function createFreshDB() {
    info('Tạo DB sạch mới (không có dữ liệu cũ)...');
    if (fs.existsSync(NEW_DB_PATH)) fs.unlinkSync(NEW_DB_PATH);

    const db = new Database(NEW_DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    db.exec(`
    CREATE TABLE IF NOT EXISTS raw_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_platform TEXT NOT NULL DEFAULT 'facebook',
      source_type TEXT NOT NULL,
      external_post_id TEXT UNIQUE NOT NULL,
      group_name TEXT, group_id TEXT, author_name TEXT, author_profile_url TEXT,
      author_external_id TEXT, post_url TEXT, post_text TEXT, post_language TEXT,
      links_found TEXT DEFAULT '[]', media_urls TEXT DEFAULT '[]',
      engagement_json TEXT DEFAULT '{}', top_comments TEXT DEFAULT '[]',
      scraped_at TEXT DEFAULT (datetime('now')), posted_at TEXT,
      raw_payload TEXT DEFAULT '{}'
    );
    CREATE TABLE IF NOT EXISTS post_classifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id) ON DELETE CASCADE,
      model_name TEXT NOT NULL, is_relevant INTEGER NOT NULL, entity_type TEXT NOT NULL,
      seller_likelihood INTEGER NOT NULL, pain_score INTEGER NOT NULL,
      intent_score INTEGER NOT NULL, resolution_confidence INTEGER NOT NULL,
      contactability_score INTEGER NOT NULL, competitor_probability INTEGER NOT NULL,
      pain_tags TEXT DEFAULT '[]', market_tags TEXT DEFAULT '[]',
      seller_stage_estimate TEXT DEFAULT 'unknown', recommended_lane TEXT NOT NULL,
      reason_summary TEXT, confidence TEXT DEFAULT 'low', raw_response TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS identity_clues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER, raw_post_id INTEGER REFERENCES raw_posts(id) ON DELETE CASCADE,
      clue_type TEXT NOT NULL, clue_value TEXT NOT NULL, confidence_score INTEGER DEFAULT 0,
      discovered_by TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      brand_name TEXT, primary_domain TEXT, primary_email TEXT, primary_page_url TEXT,
      instagram_handle TEXT, tiktok_handle TEXT, seller_likelihood INTEGER DEFAULT 0,
      pain_score INTEGER DEFAULT 0, intent_score INTEGER DEFAULT 0,
      resolution_confidence INTEGER DEFAULT 0, sales_priority_score INTEGER DEFAULT 0,
      account_status TEXT DEFAULT 'active',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS lead_cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_post_id INTEGER REFERENCES raw_posts(id) ON DELETE SET NULL,
      account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
      lane TEXT NOT NULL, strategic_summary TEXT, suggested_opener TEXT,
      objection_prevention TEXT, next_best_action TEXT, sales_priority_score INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS scan_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type TEXT NOT NULL DEFAULT 'FULL_SCAN', status TEXT DEFAULT 'PENDING',
      platforms TEXT DEFAULT 'facebook', max_posts INTEGER DEFAULT 200,
      options TEXT DEFAULT '{}', result TEXT DEFAULT '', error TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')), started_at TEXT, finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS scan_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT, keywords_used TEXT,
      posts_found INTEGER DEFAULT 0, leads_detected INTEGER DEFAULT 0,
      duration_seconds INTEGER DEFAULT 0, status TEXT DEFAULT 'running',
      error TEXT, started_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id) ON DELETE CASCADE,
      is_correct INTEGER NOT NULL, corrected_lane TEXT, feedback_text TEXT,
      created_at    TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_scan_queue_status ON scan_queue(status);
  `);

    db.close();
    ok('DB sạch đã được tạo (WAL + FK ON).');
}

main().catch(e => {
    console.error(\`\\x1b[31m[RECOVERY CRASH]\\x1b[0m\`, e);
  process.exit(1);
});
