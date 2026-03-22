const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'leads.db');
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');

// ─── SIS v2 CORE SCHEMA ──────────────────────────────────────────────────
db.exec(`
  -- 1. Bảng nguồn scrape thô
  CREATE TABLE IF NOT EXISTS raw_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_platform TEXT NOT NULL DEFAULT 'facebook',
    source_type TEXT NOT NULL, -- group_post, comment, page_post
    external_post_id TEXT UNIQUE NOT NULL,
    group_name TEXT,
    group_id TEXT,
    author_name TEXT,
    author_profile_url TEXT,
    author_external_id TEXT,
    post_url TEXT,
    post_text TEXT,
    post_language TEXT,
    links_found TEXT DEFAULT '[]',
    media_urls TEXT DEFAULT '[]',
    engagement_json TEXT DEFAULT '{}',
    top_comments TEXT DEFAULT '[]',
    scraped_at TEXT DEFAULT (datetime('now')),
    posted_at TEXT,
    raw_payload TEXT DEFAULT '{}'
  );

  -- 2. Bảng kết quả AI worker (Classification)
  CREATE TABLE IF NOT EXISTS post_classifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id) ON DELETE CASCADE,
    model_name TEXT NOT NULL,
    is_relevant INTEGER NOT NULL,
    entity_type TEXT NOT NULL, -- seller, competitor, newbie, noise, unknown
    seller_likelihood INTEGER NOT NULL,
    pain_score INTEGER NOT NULL,
    intent_score INTEGER NOT NULL,
    resolution_confidence INTEGER NOT NULL,
    contactability_score INTEGER NOT NULL,
    competitor_probability INTEGER NOT NULL,
    pain_tags TEXT DEFAULT '[]',
    market_tags TEXT DEFAULT '[]',
    seller_stage_estimate TEXT DEFAULT 'unknown',
    recommended_lane TEXT NOT NULL, -- resolved_lead, partial_lead, anonymous_signal, competitor_intel, discard
    reason_summary TEXT,
    confidence TEXT DEFAULT 'low',
    raw_response TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- 3. Bảng identity clues
  CREATE TABLE IF NOT EXISTS identity_clues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id) ON DELETE CASCADE,
    clue_type TEXT NOT NULL, -- domain, email, page, instagram, tiktok
    clue_value TEXT NOT NULL,
    confidence_score INTEGER DEFAULT 0,
    discovered_by TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  -- 4. Bảng account hợp nhất (v2)
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brand_name TEXT,
    primary_domain TEXT,
    primary_email TEXT,
    primary_page_url TEXT,
    instagram_handle TEXT,
    tiktok_handle TEXT,
    seller_likelihood INTEGER DEFAULT 0,
    pain_score INTEGER DEFAULT 0,
    intent_score INTEGER DEFAULT 0,
    resolution_confidence INTEGER DEFAULT 0,
    sales_priority_score INTEGER DEFAULT 0,
    account_status TEXT DEFAULT 'active',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- 5. Bảng lead card cho sales
  CREATE TABLE IF NOT EXISTS lead_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_post_id INTEGER REFERENCES raw_posts(id) ON DELETE SET NULL,
    account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
    lane TEXT NOT NULL,
    strategic_summary TEXT,
    suggested_opener TEXT,
    objection_prevention TEXT,
    next_best_action TEXT,
    sales_priority_score INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  -- 6. Scan Queue (IPC)
  CREATE TABLE IF NOT EXISTS scan_queue (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type    TEXT NOT NULL DEFAULT 'FULL_SCAN',
    status      TEXT DEFAULT 'PENDING',
    platforms   TEXT DEFAULT 'facebook',
    max_posts   INTEGER DEFAULT 200,
    options     TEXT DEFAULT '{}',
    result      TEXT DEFAULT '',
    error       TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now')),
    started_at  TEXT,
    finished_at TEXT
  );

  -- 7. Scan Logs (Monitoring)
  CREATE TABLE IF NOT EXISTS scan_logs (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    platform    TEXT,
    keywords_used TEXT,
    posts_found INTEGER DEFAULT 0,
    leads_detected INTEGER DEFAULT 0,
    duration_seconds INTEGER DEFAULT 0,
    status      TEXT DEFAULT 'running',
    error       TEXT,
    started_at  TEXT DEFAULT (datetime('now'))
  );
  -- 8. Bảng phản hồi (Human Feedback)
  CREATE TABLE IF NOT EXISTS feedback (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_post_id   INTEGER NOT NULL REFERENCES raw_posts(id) ON DELETE CASCADE,
    is_correct    INTEGER NOT NULL,
    corrected_lane TEXT,
    feedback_text TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_scan_queue_status ON scan_queue(status);
`);

// ─── Self-Healing Migrations (v2.1) ───────────────────────────────────────
function migrate() {
  console.log('[Database] 🛠️  Checking for schema updates...');
  const tables = {
    scan_logs: ['duration_seconds', 'leads_detected'],
    lead_cards: ['account_id'],
    raw_posts: ['source_platform']
  };

  for (const [table, cols] of Object.entries(tables)) {
    cols.forEach(col => {
      try {
        db.prepare(`SELECT ${col} FROM ${table} LIMIT 1`).get();
      } catch (e) {
        if (e.message.includes('no such column')) {
          console.log(`[Database] ➕ Adding missing column [${col}] to table [${table}]...`);
          const type = (col.includes('id') || col.includes('score') || col.includes('seconds') || col.includes('detected')) ? 'INTEGER' : 'TEXT';
          try {
            db.prepare(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`).run();
            console.log(`[Database] ✅ Column [${col}] added successfully.`);
          } catch (alterErr) {
            console.error(`[Database] ❌ Failed to add column [${col}]:`, alterErr.message);
          }
        } else {
          console.warn(`[Database] ⚠️ Unexpected error checking column [${col}] in [${table}]:`, e.message);
        }
      }
    });
  }
}
migrate();

// ─── SIS v2 Methods ───────────────────────────────────────────────────────

const insertRawPost = (post) => {
  const stmt = db.prepare(`
    INSERT INTO raw_posts (
      source_platform, source_type, external_post_id, group_name, group_id,
      author_name, author_profile_url, author_external_id, post_url, post_text,
      post_language, links_found, media_urls, engagement_json, top_comments,
      scraped_at, posted_at, raw_payload
    ) VALUES (
      @source_platform, @source_type, @external_post_id, @group_name, @group_id,
      @author_name, @author_profile_url, @author_external_id, @post_url, @post_text,
      @post_language, @links_found, @media_urls, @engagement_json, @top_comments,
      @scraped_at, @posted_at, @raw_payload
    ) ON CONFLICT(external_post_id) DO UPDATE SET
      engagement_json = excluded.engagement_json,
      top_comments = excluded.top_comments
  `);

  return stmt.run({
    source_platform: post.source_platform || 'facebook',
    source_type: post.source_type || 'post',
    external_post_id: post.external_post_id || post.post_url,
    group_name: post.group_name || '',
    group_id: post.group_id || '',
    author_name: post.author_name || 'Unknown',
    author_profile_url: post.author_profile_url || '',
    author_external_id: post.author_external_id || '',
    post_url: post.post_url || '',
    post_text: post.post_text || (post.content || ''),
    post_language: post.post_language || 'vi',
    links_found: JSON.stringify(post.links_found || []),
    media_urls: JSON.stringify(post.media_urls || []),
    engagement_json: JSON.stringify(post.engagement_json || {}),
    top_comments: JSON.stringify(post.top_comments || []),
    scraped_at: post.scraped_at || new Date().toISOString(),
    posted_at: post.posted_at || post.post_created_at || new Date().toISOString(),
    raw_payload: JSON.stringify(post.raw_payload || {})
  }).lastInsertRowid;
};

const insertClassification = (cls) => {
  const stmt = db.prepare(`
    INSERT INTO post_classifications (
      raw_post_id, model_name, is_relevant, entity_type, 
      seller_likelihood, pain_score, intent_score, resolution_confidence,
      contactability_score, competitor_probability,
      pain_tags, market_tags, seller_stage_estimate, 
      recommended_lane, reason_summary, confidence, raw_response
    ) VALUES (
      @raw_post_id, @model_name, @is_relevant, @entity_type, 
      @seller_likelihood, @pain_score, @intent_score, @resolution_confidence,
      @contactability_score, @competitor_probability,
      @pain_tags, @market_tags, @seller_stage_estimate, 
      @recommended_lane, @reason_summary, @confidence, @raw_response
    )
  `);

  return stmt.run({
    raw_post_id: cls.raw_post_id,
    model_name: cls.model_name || 'gpt-4o-mini',
    is_relevant: cls.is_relevant ? 1 : 0,
    entity_type: cls.entity_type || 'unknown',
    seller_likelihood: cls.seller_likelihood || 0,
    pain_score: cls.pain_score || 0,
    intent_score: cls.intent_score || 0,
    resolution_confidence: cls.resolution_confidence || 0,
    contactability_score: cls.contactability_score || 0,
    competitor_probability: cls.competitor_probability || 0,
    pain_tags: JSON.stringify(cls.pain_tags || []),
    market_tags: JSON.stringify(cls.market_tags || []),
    seller_stage_estimate: cls.seller_stage_estimate || 'unknown',
    recommended_lane: cls.recommended_lane || 'discard',
    reason_summary: cls.reason_summary || '',
    confidence: cls.confidence || 'low',
    raw_response: JSON.stringify(cls.raw_response || {})
  }).lastInsertRowid;
};

const getLeadCards = (lane = 'resolved_lead', limit = 50) => {
  return db.prepare(`
    SELECT lc.*, rp.post_text, rp.author_name, rp.post_url, rp.group_name 
    FROM lead_cards lc
    JOIN raw_posts rp ON lc.raw_post_id = rp.id
    WHERE lc.lane = ?
    ORDER BY lc.created_at DESC
    LIMIT ?
  `).all(lane, limit);
};

const insertLeadCard = (card) => {
  const stmt = db.prepare(`
    INSERT INTO lead_cards (
      raw_post_id, account_id, lane, strategic_summary, 
      suggested_opener, objection_prevention, next_best_action, sales_priority_score
    ) VALUES (
      @raw_post_id, @account_id, @lane, @strategic_summary, 
      @suggested_opener, @objection_prevention, @next_best_action, @sales_priority_score
    )
  `);
  return stmt.run({
    raw_post_id: card.raw_post_id,
    account_id: card.account_id || null,
    lane: card.lane || 'anonymous_signal',
    strategic_summary: card.strategic_summary || '',
    suggested_opener: card.suggested_opener || '',
    objection_prevention: card.objection_prevention || '',
    next_best_action: card.next_best_action || 'monitor',
    sales_priority_score: card.sales_priority_score || 0
  }).lastInsertRowid;
};

const getSISSummary = () => {
  const lanesRows = db.prepare(`
    SELECT recommended_lane as lane, COUNT(*) as count 
    FROM post_classifications 
    GROUP BY recommended_lane
  `).all();

  const lanes = {};
  lanesRows.forEach(r => lanes[r.lane] = r.count);

  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_processed,
      SUM(CASE WHEN is_relevant = 1 THEN 1 ELSE 0 END) as total_relevant
    FROM post_classifications
  `).get();

  return { lanes, ...stats };
};

// ─── Scan Queue IPC ────────────────────────────────────────────────────────

const enqueueScan = (jobType, platforms, maxPosts = 200) => {
  let p = platforms;
  let m = maxPosts;
  if (typeof platforms === 'object' && !Array.isArray(platforms)) {
    p = platforms.platforms;
    m = platforms.maxPosts || maxPosts;
  }
  return db.prepare(`
        INSERT INTO scan_queue (job_type, platforms, max_posts)
        VALUES (?, ?, ?)
    `).run(jobType, Array.isArray(p) ? p.join(',') : p, m);
};

const claimNextScan = () => {
  const job = db.prepare(`SELECT * FROM scan_queue WHERE status = 'PENDING' ORDER BY created_at ASC LIMIT 1`).get();
  if (job) {
    db.prepare(`UPDATE scan_queue SET status = 'PROCESSING', started_at = datetime('now') WHERE id = ?`).run(job.id);
  }
  return job;
};

const completeScan = (id, result) => {
  return db.prepare(`UPDATE scan_queue SET status = 'COMPLETED', finished_at = datetime('now'), result = ? WHERE id = ?`)
    .run(JSON.stringify(result), id);
};

const failScan = (id, error) => {
  return db.prepare(`UPDATE scan_queue SET status = 'FAILED', finished_at = datetime('now'), error = ? WHERE id = ?`)
    .run(error, id);
};

// ─── Account & Identity ────────────────────────────────────────────────────

const getAccounts = (limit = 100) => {
  return db.prepare(`SELECT * FROM accounts ORDER BY sales_priority_score DESC, created_at DESC LIMIT ?`).all(limit);
};

const getAccountById = (id) => {
  return db.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id);
};

const insertAccount = (acc) => {
  return db.prepare(`INSERT INTO accounts (brand_name, status) VALUES (?, ?)`).run(acc.brand_name, acc.status || 'lead').lastInsertRowid;
};

const findAccountByIdentity = (type, value) => {
  const rel = db.prepare(`SELECT account_id FROM identity_clues WHERE clue_type = ? AND clue_value = ?`).get(type, value);
  return rel ? rel.account_id : null;
};

const insertIdentity = (clue) => {
  return db.prepare(`INSERT INTO identity_clues (account_id, clue_type, clue_value, discovered_by) VALUES (?, ?, ?, ?)`).run(
    clue.account_id, clue.type || clue.clue_type, clue.value || clue.clue_value, clue.discovered_from || 'system'
  ).lastInsertRowid;
};

const insertFeedback = (fb) => {
  return db.prepare(`
        INSERT INTO feedback (raw_post_id, is_correct, corrected_lane, feedback_text)
        VALUES (?, ?, ?, ?)
    `).run(fb.raw_post_id, fb.is_correct ? 1 : 0, fb.corrected_lane, fb.feedback_text).lastInsertRowid;
};

module.exports = {
  db,
  insertRawPost,
  insertClassification,
  getLeadCards,
  insertLeadCard,
  getSISSummary,
  enqueueScan,
  claimNextScan,
  completeScan,
  failScan,
  getScanQueueStatus: () => db.prepare(`SELECT status, COUNT(*) as count FROM scan_queue GROUP BY status`).all(),
  insertAccount,
  getAccounts,
  getAccountById,
  findAccountByIdentity,
  insertIdentity,
  insertFeedback,
  _db: db
};
