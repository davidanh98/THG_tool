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

  -- 9. Bảng hành động Sales (Sprint 2: Sales Actions)
  CREATE TABLE IF NOT EXISTS sales_actions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_post_id  INTEGER NOT NULL REFERENCES raw_posts(id) ON DELETE CASCADE,
    action_type  TEXT NOT NULL, -- stage_change | note | deal_closed | follow_up | feedback
    action_data  TEXT DEFAULT '{}',
    staff_name   TEXT,
    created_at   TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_scan_queue_status ON scan_queue(status);
`);

// Indexes that depend on columns added/renamed by absoluteSync must run AFTER sync
// Wrap in try-catch so a stale schema doesn't crash startup
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_sales_actions_post ON sales_actions(raw_post_id);`);
} catch (e) {
  // Will be fixed after absoluteSync rebuilds sales_actions
}

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
      cols: ['raw_post_id', 'model_name', 'is_relevant', 'entity_type', 'seller_likelihood', 'pain_score', 'intent_score', 'resolution_confidence', 'contactability_score', 'competitor_probability', 'recommended_lane', 'reason_summary', 'strategic_summary', 'suggested_opener', 'objection_prevention', 'next_best_action', 'sales_priority_score', 'identity_clues', 'pipeline_stage', 'assigned_to', 'sales_notes', 'thg_service_needed', 'claim_status', 'claimed_at', 'first_contact_at', 'release_count'],
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
        pipeline_stage TEXT DEFAULT 'new',
        assigned_to TEXT,
        sales_notes TEXT DEFAULT '',
        thg_service_needed TEXT DEFAULT 'unknown',
        claim_status TEXT DEFAULT 'unclaimed',
        claimed_at TEXT,
        first_contact_at TEXT,
        release_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )`
    },
    sales_actions: {
      cols: ['raw_post_id', 'action_type', 'action_data', 'staff_name'],
      create: `CREATE TABLE sales_actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        raw_post_id INTEGER NOT NULL REFERENCES raw_posts(id) ON DELETE CASCADE,
        action_type TEXT NOT NULL,
        action_data TEXT DEFAULT '{}',
        staff_name TEXT,
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
    },
    meta_conversations: {
      cols: ['external_id', 'platform', 'status', 'last_message_at', 'unread_count', 'assigned_to', 'claimed_at', 'first_replied_at', 'claim_abandoned_count'],
      create: `CREATE TABLE meta_conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        external_id TEXT UNIQUE NOT NULL,
        platform TEXT DEFAULT 'messenger',
        status TEXT DEFAULT 'open',
        last_message_at TEXT,
        unread_count INTEGER DEFAULT 0,
        assigned_to TEXT,
        claimed_at TEXT,
        first_replied_at TEXT,
        claim_abandoned_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      )`
    },
    meta_messages: {
      cols: ['conversation_id', 'sender_id', 'sender_role', 'message_text', 'attachments_json'],
      create: `CREATE TABLE meta_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES meta_conversations(id) ON DELETE CASCADE,
        sender_id TEXT NOT NULL,
        sender_role TEXT DEFAULT 'customer',
        message_text TEXT,
        attachments_json TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`
    },
    meta_participants: {
      cols: ['conversation_id', 'participant_id', 'name', 'profile_pic'],
      create: `CREATE TABLE meta_participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES meta_conversations(id) ON DELETE CASCADE,
        participant_id TEXT NOT NULL,
        name TEXT,
        profile_pic TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(conversation_id, participant_id)
      )`
    },
    system_settings: {
      cols: ['key', 'value', 'updated_at'],
      create: `CREATE TABLE system_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )`
    },
    staff_profiles: {
      cols: ['staff_name', 'preferred_niches', 'tone', 'sample_openers', 'total_sent', 'service_samples'],
      create: `CREATE TABLE staff_profiles (
        staff_name TEXT PRIMARY KEY,
        preferred_niches TEXT DEFAULT '[]',
        tone TEXT DEFAULT 'friendly',
        sample_openers TEXT DEFAULT '[]',
        total_sent INTEGER DEFAULT 0,
        service_samples TEXT DEFAULT '{}',
        updated_at TEXT DEFAULT (datetime('now'))
      )`
    },
    kpi_log: {
      cols: ['staff_name', 'action_type', 'raw_post_id', 'points', 'deal_value', 'note', 'verified', 'suspicious', 'status'],
      create: `CREATE TABLE kpi_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        staff_name TEXT NOT NULL,
        action_type TEXT NOT NULL,
        raw_post_id INTEGER,
        points INTEGER DEFAULT 0,
        deal_value REAL DEFAULT 0,
        note TEXT DEFAULT '',
        verified INTEGER DEFAULT 1,
        suspicious INTEGER DEFAULT 0,
        status TEXT DEFAULT 'credited',
        created_at TEXT DEFAULT (datetime('now'))
      )`
    }
  };

  for (const [table, config] of Object.entries(schema)) {
    const currentTableInfo = db.prepare(`PRAGMA table_info(${table})`).all();
    const currentColNames = currentTableInfo.map(c => c.name);

    // Check for 1. Missing columns OR 2. Legacy NOT NULL columns that shouldn't be there
    const missingCols = config.cols.filter(c => !currentColNames.includes(c));
    const legacyNotNull = currentTableInfo.filter(c => c.notnull === 1 && !config.cols.includes(c.name) && c.name !== 'id');

    const tableExists = currentTableInfo.length > 0;

    if (!tableExists) {
      // Brand-new table — just create it
      try {
        db.exec(config.create);
        console.log(`[Database] ✅ [${table}] created (new table).`);
      } catch (err) {
        console.error(`[Database] ❌ Create failed for [${table}]:`, err.message);
      }
    } else if (missingCols.length > 0 || legacyNotNull.length > 0) {
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
      recommended_lane, reason_summary, confidence, raw_response,
      thg_service_needed
    ) VALUES (
      @raw_post_id, @model_name, @is_relevant, @entity_type,
      @seller_likelihood, @pain_score, @intent_score, @resolution_confidence,
      @contactability_score, @competitor_probability,
      @pain_tags, @market_tags, @seller_stage_estimate,
      @recommended_lane, @reason_summary, @confidence, @raw_response,
      @thg_service_needed
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
    raw_response: JSON.stringify(cls.raw_response || {}),
    thg_service_needed: cls.thg_service_needed || 'unknown'
  }).lastInsertRowid;
};

const getLeadCards = (lane = 'resolved_lead', limit = 50, service = null) => {
  let query = `
    SELECT
      pc.id as classification_id, pc.recommended_lane as lane, pc.reason_summary, pc.confidence,
      pc.seller_likelihood, pc.pain_score, pc.intent_score,
      pc.strategic_summary, pc.suggested_opener, pc.sales_priority_score, pc.identity_clues,
      pc.pipeline_stage, pc.assigned_to, pc.sales_notes, pc.thg_service_needed,
      rp.id as id, rp.author_name, rp.post_url, rp.post_text as content, rp.source_platform as platform, rp.group_name, rp.post_language as language
    FROM post_classifications pc
    JOIN raw_posts rp ON pc.raw_post_id = rp.id
    WHERE pc.recommended_lane = ?
  `;
  const params = [lane];

  if (service && service !== 'all') {
    query += ` AND pc.thg_service_needed = ?`;
    params.push(service);
  }

  query += ` GROUP BY rp.id ORDER BY pc.created_at DESC LIMIT ?`;
  params.push(limit);

  const rows = db.prepare(query).all(...params);

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
      pipeline_stage: r.pipeline_stage || 'new',
      assigned_to: r.assigned_to || null,
      sales_notes: r.sales_notes || '',
      thg_service_needed: r.thg_service_needed || 'unknown',
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
    SELECT pc.recommended_lane as lane, COUNT(DISTINCT pc.raw_post_id) as count 
    FROM post_classifications pc
    JOIN raw_posts rp ON pc.raw_post_id = rp.id
    GROUP BY pc.recommended_lane
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
      COUNT(DISTINCT pc.raw_post_id) as total_processed,
      COUNT(DISTINCT CASE WHEN pc.is_relevant = 1 AND pc.recommended_lane != 'discard' THEN pc.raw_post_id ELSE NULL END) as total_relevant
    FROM post_classifications pc
    JOIN raw_posts rp ON pc.raw_post_id = rp.id
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

// ─── Meta Inbox Methods ───────────────────────────────────────────────────

const upsertMetaConversation = (conv) => {
  const stmt = db.prepare(`
    INSERT INTO meta_conversations (
      external_id, platform, status, last_message_at, unread_count, assigned_to
    ) VALUES (
      @external_id, @platform, @status, @last_message_at, @unread_count, @assigned_to
    ) ON CONFLICT(external_id) DO UPDATE SET
      last_message_at = excluded.last_message_at,
      unread_count = meta_conversations.unread_count + excluded.unread_count
    RETURNING id
  `);
  return stmt.get({
    external_id: conv.external_id,
    platform: conv.platform || 'messenger',
    status: conv.status || 'open',
    last_message_at: conv.last_message_at || new Date().toISOString(),
    unread_count: conv.unread_count || 1,
    assigned_to: conv.assigned_to || null
  }).id;
};

const insertMetaMessage = (msg) => {
  const stmt = db.prepare(`
    INSERT INTO meta_messages (
      conversation_id, sender_id, sender_role, message_text, attachments_json, created_at
    ) VALUES (
      @conversation_id, @sender_id, @sender_role, @message_text, @attachments_json, @created_at
    )
  `);
  return stmt.run({
    conversation_id: msg.conversation_id,
    sender_id: msg.sender_id,
    sender_role: msg.sender_role || 'customer',
    message_text: msg.message_text || '',
    attachments_json: JSON.stringify(msg.attachments_json || []),
    created_at: msg.created_at || new Date().toISOString()
  }).lastInsertRowid;
};

const upsertMetaParticipant = (part) => {
  const stmt = db.prepare(`
    INSERT INTO meta_participants (
      conversation_id, participant_id, name, profile_pic
    ) VALUES (
      @conversation_id, @participant_id, @name, @profile_pic
    ) ON CONFLICT(conversation_id, participant_id) DO UPDATE SET
      name = excluded.name,
      profile_pic = excluded.profile_pic
  `);
  return stmt.run({
    conversation_id: part.conversation_id,
    participant_id: part.participant_id,
    name: part.name || 'Unknown',
    profile_pic: part.profile_pic || ''
  }).changes;
};

const getMetaConversations = (limit = 50) => {
  return db.prepare(`
    SELECT mc.*, 
           (SELECT message_text FROM meta_messages WHERE conversation_id = mc.id ORDER BY created_at DESC LIMIT 1) as last_message,
           (SELECT name FROM meta_participants WHERE conversation_id = mc.id AND participant_id = mc.external_id LIMIT 1) as sender_name,
           (SELECT profile_pic FROM meta_participants WHERE conversation_id = mc.id AND participant_id = mc.external_id LIMIT 1) as sender_pic
    FROM meta_conversations mc
    ORDER BY mc.last_message_at DESC
    LIMIT ?
  `).all(limit);
};

const getMetaMessages = (conversation_id) => {
  return db.prepare(`
    SELECT * FROM meta_messages 
    WHERE conversation_id = ? 
    ORDER BY created_at ASC
  `).all(conversation_id);
};

// ─── Sales Actions (Sprint 2) ──────────────────────────────────────────────

const insertSalesAction = (action) => {
  return db.prepare(`
    INSERT INTO sales_actions (raw_post_id, action_type, action_data, staff_name)
    VALUES (?, ?, ?, ?)
  `).run(
    action.raw_post_id,
    action.action_type,
    JSON.stringify(action.action_data || {}),
    action.staff_name || null
  ).lastInsertRowid;
};

const getSalesActions = (raw_post_id) => {
  return db.prepare(`
    SELECT * FROM sales_actions WHERE raw_post_id = ? ORDER BY created_at ASC
  `).all(raw_post_id);
};

const updatePipelineStage = (raw_post_id, stage, staff_name) => {
  db.prepare(`
    UPDATE post_classifications SET pipeline_stage = ? WHERE raw_post_id = ?
  `).run(stage, raw_post_id);
  return insertSalesAction({ raw_post_id, action_type: 'stage_change', action_data: { stage }, staff_name });
};

const updateSalesNotes = (raw_post_id, notes, staff_name) => {
  db.prepare(`
    UPDATE post_classifications SET sales_notes = ? WHERE raw_post_id = ?
  `).run(notes, raw_post_id);
  return insertSalesAction({ raw_post_id, action_type: 'note', action_data: { notes }, staff_name });
};

const updateAssignedTo = (raw_post_id, staff_name) => {
  db.prepare(`
    UPDATE post_classifications SET assigned_to = ? WHERE raw_post_id = ?
  `).run(staff_name, raw_post_id);
  return insertSalesAction({ raw_post_id, action_type: 'assign', action_data: { assigned_to: staff_name }, staff_name });
};

const getSignalDetail = (raw_post_id) => {
  return db.prepare(`
    SELECT
      rp.*,
      pc.id as classification_id, pc.recommended_lane as lane, pc.entity_type,
      pc.seller_likelihood, pc.pain_score, pc.intent_score, pc.resolution_confidence,
      pc.contactability_score, pc.competitor_probability, pc.pain_tags, pc.market_tags,
      pc.seller_stage_estimate, pc.reason_summary, pc.confidence,
      pc.strategic_summary, pc.suggested_opener, pc.objection_prevention,
      pc.next_best_action, pc.sales_priority_score, pc.identity_clues,
      pc.pipeline_stage, pc.assigned_to, pc.sales_notes
    FROM raw_posts rp
    JOIN post_classifications pc ON pc.raw_post_id = rp.id
    WHERE rp.id = ?
    LIMIT 1
  `).get(raw_post_id);
};

// ─── Staff Profiles & Style Learning ─────────────────────────────────────────

const getStaffProfile = (staffName) => {
  const row = db.prepare(`SELECT * FROM staff_profiles WHERE staff_name = ?`).get(staffName);
  if (!row) return null;
  try { row.preferred_niches = JSON.parse(row.preferred_niches || '[]'); } catch (e) { row.preferred_niches = []; }
  try { row.sample_openers = JSON.parse(row.sample_openers || '[]'); } catch (e) { row.sample_openers = []; }
  return row;
};

/**
 * Store a style sample when sales rewrites the AI draft.
 * Keeps the 10 most recent samples per staff.
 */
const updateStaffOpenerSample = (staffName, sample) => {
  const existing = db.prepare(`SELECT sample_openers FROM staff_profiles WHERE staff_name = ?`).get(staffName);
  let samples = [];
  try { samples = JSON.parse(existing?.sample_openers || '[]'); } catch (e) { samples = []; }
  samples.unshift(sample);
  if (samples.length > 10) samples = samples.slice(0, 10);
  db.prepare(`
    INSERT INTO staff_profiles (staff_name, sample_openers, total_sent, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(staff_name) DO UPDATE SET
      sample_openers = excluded.sample_openers,
      total_sent = staff_profiles.total_sent + 1,
      updated_at = datetime('now')
  `).run(staffName, JSON.stringify(samples));
};

/**
 * Append a sent message as a style training sample under the correct service bucket.
 * Keeps max 15 samples per service type.
 */
const updateStaffServiceSample = (staffName, service, messageText) => {
  const existing = db.prepare(`SELECT service_samples FROM staff_profiles WHERE staff_name = ?`).get(staffName);
  let serviceSamples = {};
  try { serviceSamples = JSON.parse(existing?.service_samples || '{}'); } catch (e) { serviceSamples = {}; }
  const bucket = service || 'unknown';
  if (!Array.isArray(serviceSamples[bucket])) serviceSamples[bucket] = [];
  serviceSamples[bucket].unshift(messageText);
  if (serviceSamples[bucket].length > 15) serviceSamples[bucket] = serviceSamples[bucket].slice(0, 15);
  db.prepare(`
    INSERT INTO staff_profiles (staff_name, service_samples, total_sent, updated_at)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT(staff_name) DO UPDATE SET
      service_samples = excluded.service_samples,
      total_sent = staff_profiles.total_sent + 1,
      updated_at = datetime('now')
  `).run(staffName, JSON.stringify(serviceSamples));
};

/**
 * Get the most recent style samples for a staff member filtered by service type.
 */
const getStaffServiceSamples = (staffName, service, limit = 3) => {
  const row = db.prepare(`SELECT service_samples FROM staff_profiles WHERE staff_name = ?`).get(staffName);
  if (!row) return [];
  try {
    const serviceSamples = JSON.parse(row.service_samples || '{}');
    const bucket = service || 'unknown';
    return (serviceSamples[bucket] || []).slice(0, limit);
  } catch (e) { return []; }
};

// ─── KPI System ───────────────────────────────────────────────────────────────

const KPI_POINTS = {
  opener_copied: 1,
  contacted: 3,
  reply_received: 8,
  interested: 10,
  deal_closed: 25,
  claim_lead: 2,
  claim_abandoned: -15,
};

/**
 * Log a KPI event. Validates anti-gaming rules.
 * Returns { ok, points, flagged, reason }
 */
const logKpiEvent = (staffName, actionType, rawPostId, dealValue = 0, note = '') => {
  if (!staffName) return { ok: false, reason: 'No staff_name' };

  let points = KPI_POINTS[actionType] || 0;
  let suspicious = 0;
  let status = 'credited';
  let reason = '';

  // Anti-gaming: deal_closed requires prior contacted action
  if (actionType === 'deal_closed') {
    if (!dealValue || dealValue <= 0) {
      return { ok: false, reason: 'Deal value must be > 0' };
    }
    // Check if this staff actually contacted this lead
    const priorContact = db.prepare(`
      SELECT id FROM sales_actions
      WHERE raw_post_id = ? AND staff_name = ? AND action_type = 'stage_change'
      AND json_extract(action_data, '$.stage') IN ('contacted','interested','negotiating')
    `).get(rawPostId, staffName);

    if (!priorContact) {
      points = 0;
      reason = 'No verified contact for this lead';
      suspicious = 1;
    } else {
      // Bonus points from deal value
      points += Math.floor(dealValue * 0.1);
    }
    // Deals go pending for 24h (manager review)
    status = suspicious ? 'flagged' : 'pending';
  }

  // Anti-gaming: rapid fire detection (3+ deals in 10 min)
  if (actionType === 'deal_closed' && !suspicious) {
    const recentDeals = db.prepare(`
      SELECT COUNT(*) as cnt FROM kpi_log
      WHERE staff_name = ? AND action_type = 'deal_closed'
      AND created_at >= datetime('now', '-10 minutes')
    `).get(staffName);
    if (recentDeals.cnt >= 2) {
      suspicious = 1;
      status = 'flagged';
      reason = 'Rapid fire deals detected';
      // Flag previous recent deals too
      db.prepare(`
        UPDATE kpi_log SET suspicious = 1, status = 'flagged'
        WHERE staff_name = ? AND action_type = 'deal_closed'
        AND created_at >= datetime('now', '-10 minutes')
      `).run(staffName);
    }
  }

  const id = db.prepare(`
    INSERT INTO kpi_log (staff_name, action_type, raw_post_id, points, deal_value, note, verified, suspicious, status)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(staffName, actionType, rawPostId || null, points, dealValue, note, suspicious, status).lastInsertRowid;

  return { ok: true, id, points, flagged: suspicious === 1, status, reason };
};

/**
 * Get real leaderboard data from kpi_log
 */
const getLeaderboard = () => {
  const staffList = ['Hạnh', 'Lê Huyền', 'Moon', 'Thư', 'Trang', 'Ngọc Huyền', 'Min', "Đức Anh's Agent"];

  const rankings = staffList.map(name => {
    const pts = db.prepare(`
      SELECT COALESCE(SUM(points), 0) as total FROM kpi_log
      WHERE staff_name = ? AND status IN ('credited', 'pending') AND suspicious = 0
    `).get(name);

    const contacted = db.prepare(`
      SELECT COUNT(DISTINCT raw_post_id) as cnt FROM kpi_log
      WHERE staff_name = ? AND action_type = 'contacted'
    `).get(name);

    const replies = db.prepare(`
      SELECT COUNT(*) as cnt FROM kpi_log
      WHERE staff_name = ? AND action_type = 'reply_received'
    `).get(name);

    const deals = db.prepare(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(deal_value), 0) as total_val FROM kpi_log
      WHERE staff_name = ? AND action_type = 'deal_closed' AND status IN ('credited', 'pending') AND suspicious = 0
    `).get(name);

    const pending = db.prepare(`
      SELECT COALESCE(SUM(points), 0) as total FROM kpi_log
      WHERE staff_name = ? AND status = 'pending'
    `).get(name);

    const penalties = db.prepare(`
      SELECT COUNT(*) as cnt, COALESCE(SUM(points), 0) as total_pts FROM kpi_log
      WHERE staff_name = ? AND action_type = 'claim_abandoned'
    `).get(name);

    const claims = db.prepare(`
      SELECT COUNT(*) as cnt FROM kpi_log
      WHERE staff_name = ? AND action_type = 'claim_lead'
    `).get(name);

    return {
      name,
      total_points: pts.total || 0,
      pending_points: pending.total || 0,
      contacted: contacted.cnt || 0,
      reply_received: replies.cnt || 0,
      deals_closed: deals.cnt || 0,
      total_deal_value: deals.total_val || 0,
      converted: replies.cnt || 0,
      claims_total: claims.cnt || 0,
      release_count: penalties.cnt || 0,
      penalty_points: penalties.total_pts || 0,
    };
  });

  const log = db.prepare(`
    SELECT id, staff_name, action_type, points, deal_value, note, suspicious, status, created_at
    FROM kpi_log
    ORDER BY created_at DESC
    LIMIT 50
  `).all();

  const flagged = db.prepare(`
    SELECT * FROM kpi_log WHERE suspicious = 1 ORDER BY created_at DESC LIMIT 20
  `).all();

  const antiHoarding = {
    unassigned: db.prepare(`SELECT COUNT(*) as cnt FROM post_classifications WHERE claim_status = 'unclaimed' AND is_relevant = 1`).get().cnt || 0,
    active_claims: db.prepare(`SELECT COUNT(*) as cnt FROM post_classifications WHERE claim_status = 'claimed'`).get().cnt || 0,
    penalties_today: db.prepare(`SELECT COUNT(*) as cnt FROM kpi_log WHERE action_type = 'claim_abandoned' AND DATE(created_at) = DATE('now')`).get().cnt || 0,
    total_releases: db.prepare(`SELECT COALESCE(SUM(release_count), 0) as total FROM post_classifications`).get().total || 0,
  };

  return { rankings, log, flagged, antiHoarding };
};

/**
 * Manager approves a pending deal (credits the points)
 */
const approveKpiEntry = (id) => {
  return db.prepare(`UPDATE kpi_log SET status = 'credited' WHERE id = ? AND status = 'pending'`).run(id).changes;
};

/**
 * Manager rejects a flagged/pending deal
 */
const rejectKpiEntry = (id, reason = '') => {
  return db.prepare(`UPDATE kpi_log SET status = 'rejected', points = 0, note = note || ' | Rejected: ' || ? WHERE id = ?`).run(reason, id).changes;
};

// ─── Lead Claim System (Anti-Hoarding) ───────────────────────────────────────

/**
 * Atomically claim a lead for a staff member.
 * Returns { ok, reason } — fails if already claimed by someone else.
 */
const claimLead = (rawPostId, staffName) => {
  return db.transaction(() => {
    const current = db.prepare(`
      SELECT assigned_to, claim_status FROM post_classifications
      WHERE raw_post_id = ?
    `).get(rawPostId);

    if (!current) return { ok: false, reason: 'Lead not found' };
    if (current.claim_status === 'claimed' && current.assigned_to && current.assigned_to !== staffName) {
      return { ok: false, reason: `Đã được ${current.assigned_to} nhận rồi` };
    }
    if (current.claim_status === 'interacted' || current.claim_status === 'qualified') {
      return { ok: false, reason: 'Lead này đang được xử lý' };
    }

    db.prepare(`
      UPDATE post_classifications
      SET assigned_to = ?, claim_status = 'claimed', claimed_at = datetime('now'), first_contact_at = NULL
      WHERE raw_post_id = ?
    `).run(staffName, rawPostId);

    // Log KPI: +2 pts for claiming
    db.prepare(`
      INSERT INTO kpi_log (staff_name, action_type, raw_post_id, points, note, verified, suspicious, status)
      VALUES (?, 'claim_lead', ?, 2, 'Nhận khách', 1, 0, 'credited')
    `).run(staffName, rawPostId);

    return { ok: true };
  })();
};

/**
 * Log first real interaction proof. Resets the expiry clock.
 * Triggers +3 KPI (contacted) only if not already logged for this lead+staff.
 */
const logFirstContact = (rawPostId, staffName, note = '') => {
  const current = db.prepare(`
    SELECT assigned_to, claim_status, first_contact_at FROM post_classifications
    WHERE raw_post_id = ?
  `).get(rawPostId);

  if (!current) return { ok: false, reason: 'Lead not found' };
  if (current.assigned_to !== staffName) return { ok: false, reason: 'Bạn chưa nhận lead này' };

  db.prepare(`
    UPDATE post_classifications
    SET first_contact_at = COALESCE(first_contact_at, datetime('now')), claim_status = 'interacted'
    WHERE raw_post_id = ?
  `).run(rawPostId);

  // Only give KPI points once per lead per staff
  const alreadyLogged = db.prepare(`
    SELECT id FROM kpi_log WHERE raw_post_id = ? AND staff_name = ? AND action_type = 'contacted' LIMIT 1
  `).get(rawPostId, staffName);

  if (!alreadyLogged) {
    db.prepare(`
      INSERT INTO kpi_log (staff_name, action_type, raw_post_id, points, note, verified, suspicious, status)
      VALUES (?, 'contacted', ?, 3, ?, 1, 0, 'credited')
    `).run(staffName, rawPostId, note || 'Tương tác đầu tiên');
  }

  return { ok: true };
};

/**
 * Find all claimed leads that have exceeded the timeout and have no first contact.
 * @param {number} timeoutMinutes
 */
const getExpiredClaims = (timeoutMinutes = 60) => {
  return db.prepare(`
    SELECT raw_post_id, assigned_to, claimed_at, release_count
    FROM post_classifications
    WHERE claim_status = 'claimed'
      AND first_contact_at IS NULL
      AND claimed_at IS NOT NULL
      AND claimed_at <= datetime('now', ? || ' minutes')
  `).all(`-${timeoutMinutes}`);
};

/**
 * Server-side auto-release: reset lead to unclaimed pool, penalize staff.
 */
const autoReleaseClaim = (rawPostId, staffName) => {
  db.prepare(`
    UPDATE post_classifications
    SET claim_status = 'unclaimed', assigned_to = NULL, claimed_at = NULL,
        release_count = release_count + 1
    WHERE raw_post_id = ? AND claim_status = 'claimed'
  `).run(rawPostId);

  // Penalty: -15 pts
  db.prepare(`
    INSERT INTO kpi_log (staff_name, action_type, raw_post_id, points, note, verified, suspicious, status)
    VALUES (?, 'claim_abandoned', ?, -15, 'Hết giờ — khách bị nhả về kho chung', 1, 0, 'credited')
  `).run(staffName, rawPostId);
};

/** Get the latest AI draft message for a conversation */
const getLastAiDraft = (conversationId) => {
  return db.prepare(`
    SELECT message_text FROM meta_messages
    WHERE conversation_id = ? AND sender_role = 'ai_draft'
    ORDER BY created_at DESC LIMIT 1
  `).get(conversationId);
};

// ─── Meta Conversation Claim / Anti-Hoarding ─────────────────────────────────

/**
 * Atomically claim a Meta conversation for a staff member.
 * - Sets assigned_to + claimed_at
 * - Logs +2 KPI (claim_lead)
 */
const claimMetaConversation = (convId, staffName) => {
  return db.transaction(() => {
    const current = db.prepare(`
      SELECT assigned_to, claimed_at FROM meta_conversations WHERE id = ?
    `).get(convId);

    if (!current) return { ok: false, reason: 'Conversation not found' };
    if (current.assigned_to && current.assigned_to !== staffName) {
      return { ok: false, reason: `Đã được ${current.assigned_to} nhận rồi` };
    }

    db.prepare(`
      UPDATE meta_conversations
      SET assigned_to = ?, claimed_at = datetime('now'), first_replied_at = NULL
      WHERE id = ?
    `).run(staffName, convId);

    db.prepare(`
      INSERT INTO kpi_log (staff_name, action_type, raw_post_id, points, note, verified, suspicious, status)
      VALUES (?, 'claim_lead', NULL, 2, 'Nhận hội thoại Meta Inbox', 1, 0, 'credited')
    `).run(staffName);

    return { ok: true };
  })();
};

/**
 * Record first staff reply on a Meta conversation.
 * Sets first_replied_at once. Logs +3 KPI (contacted) if first time.
 */
const recordMetaFirstReply = (convId, staffName) => {
  const current = db.prepare(`
    SELECT assigned_to, first_replied_at FROM meta_conversations WHERE id = ?
  `).get(convId);

  if (!current) return;

  // Mark first reply timestamp (only once)
  if (!current.first_replied_at) {
    db.prepare(`
      UPDATE meta_conversations SET first_replied_at = datetime('now') WHERE id = ?
    `).run(convId);

    // Log +3 KPI for first contact (once per conversation per staff)
    if (staffName && current.assigned_to === staffName) {
      db.prepare(`
        INSERT INTO kpi_log (staff_name, action_type, raw_post_id, points, note, verified, suspicious, status)
        VALUES (?, 'contacted', NULL, 3, 'Liên hệ đầu tiên qua Meta Inbox', 1, 0, 'credited')
      `).run(staffName);
    }
  }

  // Always log reply_received (+8) for the staff who sent
  if (staffName) {
    db.prepare(`
      INSERT INTO kpi_log (staff_name, action_type, raw_post_id, points, note, verified, suspicious, status)
      VALUES (?, 'reply_received', NULL, 8, 'Gửi tin nhắn Meta Inbox', 1, 0, 'credited')
    `).run(staffName);
  }
};

/**
 * Get Meta conversations that were assigned but staff never replied within timeoutMinutes.
 */
const getExpiredMetaClaims = (timeoutMinutes = 60) => {
  return db.prepare(`
    SELECT id, assigned_to, claimed_at, claim_abandoned_count
    FROM meta_conversations
    WHERE assigned_to IS NOT NULL
      AND claimed_at IS NOT NULL
      AND first_replied_at IS NULL
      AND claimed_at <= datetime('now', ? || ' minutes')
  `).all(`-${timeoutMinutes}`);
};

/**
 * Release a stale Meta claim: clear assignment, increment penalty counter, log -15 KPI.
 */
const autoReleaseMetaClaim = (convId, staffName) => {
  db.prepare(`
    UPDATE meta_conversations
    SET assigned_to = NULL, claimed_at = NULL, first_replied_at = NULL,
        claim_abandoned_count = claim_abandoned_count + 1
    WHERE id = ? AND assigned_to = ?
  `).run(convId, staffName);

  db.prepare(`
    INSERT INTO kpi_log (staff_name, action_type, raw_post_id, points, note, verified, suspicious, status)
    VALUES (?, 'claim_abandoned', NULL, -15, 'Hội thoại Meta hết giờ — nhả về kho', 1, 0, 'credited')
  `).run(staffName);
};

// ─── Accounts (v2 Compat — derived from resolved signals) ────────────────────
const getAccounts = (limit = 100) => {
  return db.prepare(`
    SELECT
      rp.id, rp.author_name as name, rp.author_profile_url as profile_url,
      rp.post_url, pc.thg_service_needed as service, pc.assigned_to,
      pc.pipeline_stage as stage, pc.suggested_opener, pc.identity_clues,
      pc.sales_priority_score, pc.created_at
    FROM post_classifications pc
    JOIN raw_posts rp ON pc.raw_post_id = rp.id
    WHERE pc.recommended_lane IN ('resolved_lead', 'partial_lead')
      AND pc.is_relevant = 1
    ORDER BY pc.sales_priority_score DESC, pc.created_at DESC
    LIMIT ?
  `).all(limit);
};

const getSetting = (key, defaultVal = null) => {
  try {
    const row = db.prepare(`SELECT value FROM system_settings WHERE key = ?`).get(key);
    return row ? row.value : defaultVal;
  } catch (e) { return defaultVal; }
};

const setSetting = (key, value) => {
  db.prepare(`
    INSERT INTO system_settings (key, value, updated_at) 
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')
  `).run(key, value);
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
  upsertMetaConversation,
  insertMetaMessage,
  upsertMetaParticipant,
  getMetaConversations,
  getMetaMessages,
  getSetting,
  setSetting,
  // Sprint 2: Sales Actions
  insertSalesAction,
  getSalesActions,
  updatePipelineStage,
  updateSalesNotes,
  updateAssignedTo,
  getSignalDetail,
  getStaffProfile,
  updateStaffOpenerSample,
  updateStaffServiceSample,
  getStaffServiceSamples,
  getLastAiDraft,
  getAccounts,
  // KPI System
  KPI_POINTS,
  logKpiEvent,
  getLeaderboard,
  approveKpiEntry,
  rejectKpiEntry,
  // Claim / Anti-Hoarding System (scraping leads)
  claimLead,
  logFirstContact,
  getExpiredClaims,
  autoReleaseClaim,
  // Meta Conversation Claim / Anti-Hoarding
  claimMetaConversation,
  recordMetaFirstReply,
  getExpiredMetaClaims,
  autoReleaseMetaClaim,
  _db: db
};
