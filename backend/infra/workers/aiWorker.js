/**
 * THG Lead Gen — AI Worker (Standalone Process)
 * 
 * This process runs INDEPENDENTLY from the API server.
 * It processes raw_leads (from CrawBot imports) with AI classification.
 * 
 * Flow:
 *   1. Poll raw_leads table for PENDING rows every 3s
 *   2. Pre-filter with regex (free, instant)
 *   3. AI classify each post (Groq/Gemini) → 2-5s per post
 *   4. Route qualified leads to Sales team
 *   5. Insert into leads table (dashboard)
 * 
 * Usage:
 *   node src/workers/aiWorker.js
 *   PM2: thg-ai-worker (see ecosystem.config.js)
 */
const config = require('../../config');
const database = require('../../core/data_store/database');
const { generateSISScore } = require('../../../ai/prompts/sisScorer');

const POLL_INTERVAL = 3000; // 3 seconds
const BATCH_SIZE = 20;
let isProcessing = false;

// ── Routing rules ──────────────────────────────────────────────────────
const ROUTING_RULES = [
    { pattern: /pod|print.on.demand|in.áo|in.theo|xưởng.in/i, assignTo: 'Đức Anh' },
    { pattern: /trung.quốc|china|tq|taobao|1688|quảng.châu|cn.→|cn\s/i, assignTo: 'Moon' },
    { pattern: /kho.mỹ|warehouse|3pl|texas|pennsylvania|pa.kho|kho.us/i, assignTo: 'Khoa' },
    { pattern: /fulfillment|fulfill|dropship|drop.ship/i, assignTo: 'Đức Anh' },
    { pattern: /epacket|chile|colombia|mexico|saudi|uae|úc|australia/i, assignTo: 'Linh' },
];
const ROUND_ROBIN_SALES = ['Đức Anh', 'Moon', 'Khoa', 'Linh'];
let rrIdx = 0;

function routeLead(content) {
    const text = content || '';
    for (const rule of ROUTING_RULES) {
        if (rule.pattern.test(text)) return rule.assignTo;
    }
    const sales = ROUND_ROBIN_SALES[rrIdx % ROUND_ROBIN_SALES.length];
    rrIdx++;
    return sales;
}

const SPAM_AD_RE = /(bên em|bên mình|inb em|check ib|nhận gửi|nhận vận chuyển|hệ thống tracking|liên hệ e|zalo:|lh em|inbox ngay|liên hệ ngay|doanh thu|lợi nhuận|roi|tối ưu chi phí|giảm cost|vít ad|scale[^A-Za-z]|max camp|case study|win camp|idea design|chia sẻ tut|hướng dẫn bán|học bán|dạy bán)/i;
const RETAIL_RE = /(gửi 1 cái|gửi 1 đôi|ship 1kg|gửi đồ ăn|gửi mỹ phẩm|mua hộ|order taobao|gom order|nhận order)/i;
const OUT_OF_BOUNDS_WH_RE = /(úc|australia|châu âu|eu|can\b|canada|nhật|japan|hàn|korea|đức|germany|pháp|france|sing|đài loan|taiwan|mexico|chile|colombia|saudi|uae|tây ban nha|nhập hàng về|ship về vn|order về vn)/i;

const POD_CORE_RE = /(pod|print on demand|dropship|fulfillment|fulfill|fulfiller)/i;
const SUPPORT_NEED_RE = /(tìm đơn vị|cần tìm|tìm kho|cần ship|báo giá|shipping|vận chuyển|gửi hàng|áo tee|mug|phone case|ornament|canvas)/i;

/**
 * Phân tích và chấm điểm Lead hoàn toàn bằng Hardcoded String Matching (Thay thế AI)
 */
function scoreLead(content, topCommentsJson) {
    let fullText = (content || '').toLowerCase();

    // Ghép comment vào text để quét (người bán hay để số/thông tin dưới comment)
    if (topCommentsJson) {
        try {
            const comments = JSON.parse(topCommentsJson);
            if (Array.isArray(comments)) {
                fullText += ' ' + comments.map(c => (c.text || '')).join(' ').toLowerCase();
            }
        } catch (e) { }
    }

    // 1. Hard Filters - Loại bỏ rác, đối thủ, ads, đơn lẻ
    if (SPAM_AD_RE.test(fullText)) return { pass: false, reason: 'Quảng cáo/Chuyên gia dỏm (doanh thu/case study/inb)' };
    if (RETAIL_RE.test(fullText)) return { pass: false, reason: 'Đi lẻ/Mua hộ/Đồ ăn (Không phải B2B POD)' };
    if (OUT_OF_BOUNDS_WH_RE.test(fullText)) return { pass: false, reason: 'Kho/Tuyến ngoại lệ (Chỉ chấp nhận US/VN/CN)' };

    // 2. Chấm điểm - Bắt buộc phải là POD/Dropship cần dịch vụ
    if (POD_CORE_RE.test(fullText) || SUPPORT_NEED_RE.test(fullText)) {
        // Cộng điểm
        let score = 50;
        if (POD_CORE_RE.test(fullText) && SUPPORT_NEED_RE.test(fullText)) score += 30; // 80 points
        if (fullText.includes('usa') || fullText.includes('mỹ') || fullText.includes('us')) score += 10;

        // Phải có ít nhất Core HOẶC Need và vượt qua bộ lọc khắt khe trên
        if (score >= 60) {
            // Tóm tắt ngắn để UI đẹp hơn
            const summaryText = content ? content.substring(0, 60).replace(/\n/g, ' ') + '...' : 'Tìm kiếm dịch vụ vận chuyển';
            return { pass: true, score: score, summary: summaryText };
        }
    }

    return { pass: false, reason: 'Không nhắc đến nhu cầu POD/Dropship shipping' };
}

/**
 * Process a batch of PENDING raw_leads with Hardcoded algorithm + SIS AI Evaluation
 */
async function processBatch() {
    if (isProcessing) return;
    isProcessing = true;

    try {
        const batch = database.db.prepare(
            `SELECT * FROM raw_leads WHERE status = 'PENDING' LIMIT ?`
        ).all(BATCH_SIZE);

        if (batch.length === 0) return;

        console.log(`[AIWorker] 📋 Processing ${batch.length} leads with SIS architecture...`);

        for (const row of batch) {
            // Mark as PROCESSING
            database.db.prepare(`UPDATE raw_leads SET status='PROCESSING' WHERE id=?`).run(row.id);

            // Job 2: Fast Filter (Quét post + comments) - GIỮ LẠI LÀM LỌC RÁC
            const result = scoreLead(row.content, row.top_comments || '[]');

            if (!result.pass) {
                database.db.prepare(
                    `UPDATE raw_leads SET status='REJECTED', reject_reason=? WHERE id=?`
                ).run(result.reason, row.id);
                console.log(`[AIWorker] 🚫 DROP [${result.reason}]: ${(row.content || '').substring(0, 40)}...`);
                continue;
            }

            console.log(`[AIWorker] 🎯 PASS FAST FILTER: ${row.author} - Đang chuyển qua SIS AI Scoring...`);

            // Job 4: SIS AI Scoring 
            const sisScores = await generateSISScore(row.content, row.top_comments);

            // Job 3: Identity & Entity Resolution
            let accountId = null;
            if (row.author_url) {
                // Thử tìm Identity xem đã tồn tại chưa
                const existingAccount = database.findAccountByIdentity('fb_profile', row.author_url);
                if (existingAccount) {
                    accountId = existingAccount.id;
                    console.log(`[AIWorker] 🔄 Map vào Account cũ: ID #${accountId}`);
                }
            }

            if (!accountId) {
                // Tạo Account mới
                accountId = database.insertAccount({
                    brand_name: row.author,
                    category: sisScores.category,
                    platform: row.platform,
                    market: 'Global'
                });
                console.log(`[AIWorker] 🆕 Tạo Account mới: ID #${accountId} - ${row.author}`);

                // Tạo Identity link với Account
                if (row.author_url) {
                    database.insertIdentity(accountId, 'fb_profile', row.author_url, 'Facebook Scraper');
                }
            }

            // Cập nhật điểm cho Account
            database.updateAccountScores(accountId, {
                pain_score: sisScores.pain_score,
                revenue_score: sisScores.revenue_score,
                contactability_score: sisScores.contactability_score, // Phụ thuộc vào Bio sau này (Job 5)
                switching_score: sisScores.switching_score,
                urgency_score: sisScores.urgency_score,
                priority_score: sisScores.priority_score,
                status: 'qualified'
            });

            // Ghi nhận Action nếu cần (Optional)
            if (sisScores.suggested_action === 'sales_now') {
                database.logSISAction({
                    account_id: accountId,
                    action_type: 'Sales_Evaluation_Needed',
                    owner: 'System',
                    status: 'pending'
                });
            }

            const assignedTo = routeLead(row.content);

            // Save to leads table (lúc này là SIGNALS table trong bản chất)
            database.db.prepare(`
                INSERT OR IGNORE INTO leads
                  (platform, author_name, author_url, content, post_url, post_created_at,
                   item_type, group_name, score, summary, status, tags, response_draft, assigned_sales, account_id)
                VALUES (?, ?, ?, ?, ?, ?, 'post', ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                row.platform, row.author, row.author_url, row.content,
                row.url, row.scraped_at, row.group_name,
                sisScores.priority_score,
                sisScores.summary,
                sisScores.suggested_action === 'sales_now' ? 'hot' : 'new',
                JSON.stringify(['#POD', '#Dropship']),
                '', // no response draft generated yet
                assignedTo,
                accountId
            );

            database.db.prepare(
                `UPDATE raw_leads SET status='QUALIFIED', score=?, assigned_to=? WHERE id=?`
            ).run(sisScores.priority_score, assignedTo, row.id);

            // Invalidate stats cache
            database.invalidateStatsCache();

            console.log(`[AIWorker] 🔥 SIS SCORED [P:${sisScores.pain_score} / R:${sisScores.revenue_score}] -> TỔNG ĐIỂM PRIORITY: ${sisScores.priority_score}đ → ${assignedTo}`);
        }
        console.log(`[AIWorker] ✅ Batch done.`);
    } catch (err) {
        console.error(`[AIWorker] ❌ Batch error:`, err.message);
    } finally {
        isProcessing = false;
    }
}

// ═══ Main ═══
function main() {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  🧠 THG AI Worker — Standalone Process              ║');
    console.log('║  Polls raw_leads → Pre-filter → AI Classify → Save ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    console.log(`[AIWorker] 🔄 Polling raw_leads every ${POLL_INTERVAL / 1000}s (batch=${BATCH_SIZE})...`);

    // Start polling
    setInterval(processBatch, POLL_INTERVAL);

    // Initial poll
    processBatch();
}

main();
