const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = path.join(DATA_DIR, 'leads.db');
const db = new Database(DB_PATH, {
  verbose: (msg) => { if (process.env.DEBUG_DB) console.log(msg); }
});

// ═══════════════════════════════════════════════════════
// RESILIENCE PRAGMAS (Prevent Corruption & Multi-Process Crash)
// ═══════════════════════════════════════════════════════
db.pragma('journal_mode = WAL');    // Write-Ahead Logging (Vital for stability)
db.pragma('synchronous = NORMAL');  // Faster and safe with WAL
db.pragma('busy_timeout = 5000');   // Wait 5s if DB is locked by another process
db.pragma('foreign_keys = ON');

console.log(`[Database] 🗄️ SIS v2 Database Loaded (WAL Mode Active)`);

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
    strategic_summary TEXT,
    suggested_opener TEXT,
    objection_prevention TEXT,
    next_best_action TEXT,
    sales_priority_score INTEGER DEFAULT 0,
    identity_clues TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
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

// ─── Absolute Schema Synchronization (v2.4) ────────────────────────────────
function absoluteSync() {
  console.log('[Database] 🛡️  Absolute Sync: Ensuring 100% Schema & Constraint Parity...');

  // 1. Radical Purge: Delete legacy v1 tables and deduplicated v2 tables to avoid "Data Chaos"
  const legacyTables = ['leads', 'analysis_results', 'group_members', 'search_tasks', 'agents', 'messages', 'v1_posts', 'accounts', 'identity_clues', 'lead_cards'];
  legacyTables.forEach(t => {
    try {
      db.prepare(`DROP TABLE IF EXISTS ${t}`).run();
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
    const currentTableInfo = db.prepare(`PRAGMA table_info(${table})`).all();
    const currentColNames = currentTableInfo.map(c => c.name);

    // Check for 1. Missing columns OR 2. Legacy NOT NULL columns that shouldn't be there
    const missingCols = config.cols.filter(c => !currentColNames.includes(c));
    const legacyNotNull = currentTableInfo.filter(c => c.notnull === 1 && !config.cols.includes(c.name) && c.name !== 'id');

    if (missingCols.length > 0 || legacyNotNull.length > 0) {
      console.log(`[Database] ☢️  ABSOLUTE SYNC: Rebuilding [${table}]...`);
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
        console.log(`[Database] ✅ [${table}] successfully rebuilt.`);
      } catch (err) {
        console.error(`[Database] ❌ Absolute Sync failed for [${table}]:`, err.message);
      }
    }
  }
  console.log('[Database] ✅ Absolute Parity Achieved.');
}
absoluteSync();

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
      top_comments    = excluded.top_comments
    RETURNING id
  `);

  const row = stmt.get({
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
  });

  return row.id;
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
  const rows = db.prepare(`
    SELECT 
      pc.id as classification_id, pc.recommended_lane as lane, pc.reason_summary, pc.confidence,
      pc.seller_likelihood, pc.pain_score, pc.intent_score,
      pc.strategic_summary, pc.suggested_opener, pc.sales_priority_score, pc.identity_clues,
      rp.id as id, rp.author_name, rp.post_url, rp.post_text as content, rp.source_platform as platform, rp.group_name
    FROM post_classifications pc
    JOIN raw_posts rp ON pc.raw_post_id = rp.id
    WHERE pc.recommended_lane = ?
    GROUP BY rp.id
    ORDER BY pc.created_at DESC
    LIMIT ?
  `).all(lane, limit);

  return rows.map(r => {
    return {
      ...r,
      classification: {
        id: r.classification_id,
        seller_likelihood: r.seller_likelihood,
        pain_score: r.pain_score,
        intent_score: r.intent_score,
        confidence: r.confidence,
        reason_summary: r.reason_summary,
        recommended_lane: r.lane
      },
      leadCard: r.strategic_summary ? {
        strategic_summary: r.strategic_summary,
        suggested_opener: r.suggested_opener,
        sales_priority_score: r.sales_priority_score,
        identity_clues: r.identity_clues
      } : undefined
    };
  });
};

const updateLeadCard = (raw_post_id, card) => {
  const stmt = db.prepare(`
    UPDATE post_classifications 
    SET strategic_summary = @strategic_summary, 
        suggested_opener = @suggested_opener, 
        objection_prevention = @objection_prevention, 
        next_best_action = @next_best_action, 
        sales_priority_score = @sales_priority_score
    WHERE raw_post_id = @raw_post_id
  `);
  return stmt.run({
    raw_post_id: raw_post_id,
    strategic_summary: card.strategic_summary || '',
    suggested_opener: card.suggested_opener || '',
    objection_prevention: card.objection_prevention || '',
    next_best_action: card.next_best_action || 'monitor',
    sales_priority_score: isNaN(card.sales_priority_score) ? 50 : card.sales_priority_score
  }).changes;
};

const getLeadCardByPost = (raw_post_id) => {
  return db.prepare(`
    SELECT strategic_summary, suggested_opener, objection_prevention, next_best_action, sales_priority_score 
    FROM post_classifications 
    WHERE raw_post_id = ? AND strategic_summary IS NOT NULL
  `).get(raw_post_id);
};

const getSISSummary = () => {
  const lanesRows = db.prepare(`
    SELECT recommended_lane as lane, COUNT(*) as count 
    FROM post_classifications 
    GROUP BY recommended_lane
  `).all();

  const mapping = {
    'resolved_lead': 'resolved',
    'partial_lead': 'partial',
    'anonymous_signal': 'anonymous',
    'competitor_intel': 'competitor'
  };

  const lanes = { resolved: 0, partial: 0, anonymous: 0, competitor: 0 };
  lanesRows.forEach(r => {
    const key = mapping[r.lane];
    if (key) lanes[key] = r.count;
  });

  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_processed,
      SUM(CASE WHEN is_relevant = 1 AND recommended_lane != 'discard' THEN 1 ELSE 0 END) as total_relevant
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

// ─── Human Feedback ────────────────────────────────────────────────────────

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
  getLeadCardByPost,
  updateLeadCard,
  getSISSummary,
  enqueueScan,
  claimNextScan,
  completeScan,
  failScan,
  getScanQueueStatus: () => db.prepare(`SELECT status, COUNT(*) as count FROM scan_queue GROUP BY status`).all(),
  insertFeedback,
  _db: db
};
