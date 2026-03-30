/**
 * THG Discovery Agent — Gemini 2.5 Flash + Google Search Grounding
 *
 * Replaces/complements Playwright scraping for multi-platform lead discovery.
 * Tìm kiếm seller tiềm năng từ TOÀN BỘ web công khai (LinkedIn, Reddit, forums...)
 * mà KHÔNG cần đăng nhập Facebook → không bao giờ bị checkpoint.
 *
 * Output: Leads đã enriched với THG-specific schema → đổ thẳng vào raw_posts pipeline.
 */

const axios = require('axios');
const database = require('../core/data_store/database');

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

// ─── System Prompt: THG-aware, strict seller-only ────────────────────────────
const SYSTEM_PROMPT = `Bạn là chuyên gia tình báo thị trường cho THG Logistics — một công ty vận chuyển & fulfillment VN→US/EU.

=== NHIỆM VỤ ===
Tìm kiếm SELLER (người bán hàng) đang CÓ NHU CẦU THỰC SỰ về dịch vụ fulfillment/vận chuyển/kho.
Đây là những KHÁCH HÀNG TIỀM NĂNG của THG, không phải đối thủ.

=== ĐỐI TƯỢNG CẦN TÌM (SELLER có nhu cầu) ===
- Cá nhân/shop đang bán hàng trên Etsy, Amazon, Shopify, TikTok Shop
- Đang tìm nhà cung cấp fulfillment, kho US, hoặc đường ship VN/CN→US
- Đang phàn nàn về giá ship cao, giao chậm, kho US đắt
- Đang hỏi cộng đồng về warehouse US, 3PL, FBA prep
- Store owner muốn scale lên US market nhưng chưa có logistics

=== TUYỆT ĐỐI KHÔNG LẤY (loại bỏ ngay) ===
❌ Công ty logistics/fulfillment (Printify, Printful, CJdropshipping, Oberlo, Gelato, Gooten, ShipBob, Flexport, Mergify, Onospod, Gearment, Teezily, SPOD...) — đây là ĐỐI THỦ của THG
❌ Nhà cung cấp dịch vụ: bất kỳ ai đang CHÀO BÁN fulfillment cho người khác
❌ Platform marketplace (Etsy, Amazon, Shopify — đây là nền tảng, không phải seller)
❌ Hàng nhập VỀ Việt Nam
❌ Bài tuyển dụng, tool, phần mềm

=== PHÂN BIỆT QUAN TRỌNG ===
✅ GIỮ: "Etsy shop owner Vietnam bán POD cần tìm fulfillment rẻ hơn" → SELLER cần dịch vụ
❌ BỎ: "Printful provides POD fulfillment for Etsy sellers" → PROVIDER đang chào dịch vụ
✅ GIỮ: "Amazon FBA seller tìm 3PL warehouse tại US" → SELLER cần kho
❌ BỎ: "ShipBob offers warehouse services for Amazon sellers" → PROVIDER

Trả về ĐÚNG định dạng JSON array. Mỗi phần tử gồm:
{
  "name": "Tên seller/brand/store hoặc tên người (KHÔNG PHẢI tên công ty logistics)",
  "source": "BẮT BUỘC PHẢI LÀ FULL URL (bắt đầu bằng https://...). Lấy link CHÍNH XÁC từ kết quả tìm kiếm Google của bạn. KHÔNG ĐƯỢC điền tên chung chung.",
  "niche": "Niche hàng hóa họ đang bán (ví dụ: POD t-shirts Etsy, Amazon FBA electronics)",
  "needs": ["warehouse_us", "express_vn_us", "pod_fulfillment", "3pl", "fba_prep"],
  "thg_service_needed": "warehouse | express | pod | quote_needed | unknown",
  "pain_signal": "Mô tả THỰC TẾ vấn đề họ đang gặp (giao chậm, giá cao, kho đắt...)",
  "estimated_volume": "Ước tính volume đơn (ví dụ: 50-100 orders/day)",
  "contact_clues": ["etsy.com/shop/abc", "reddit.com/u/xyz", "email nếu có"],
  "market": "US | EU | AU | UK | mixed",
  "seller_stage": "newbie | operator | scaling | unknown",
  "ai_score": số từ 1-100 (dựa trên mức độ phù hợp tuyến VN/CN→US, volume, pain rõ ràng),
  "automation_payload": {
    "dm": "Tin nhắn DM/inbox cá nhân hóa bằng tiếng Việt, ngắn gọn, đề cập thẳng vào pain point của họ, KHÔNG dùng văn mẫu chung. Kết thúc bằng câu hỏi mở.",
    "comment": "Câu comment ngắn (1-2 câu) để reply dưới bài viết của họ trên group/forum, tự nhiên không spam.",
    "linkedin": "Tin nhắn LinkedIn bằng tiếng Anh, chuyên nghiệp, đề cập đến niche và pain point của họ."
  },
  "is_provider": false
}
CHỈ TRẢ VỀ JSON ARRAY. KHÔNG có văn bản giải thích. Nếu không tìm được seller thực sự, trả về []. ĐẢM BẢO mọi trường 'source' đều bắt đầu bằng https://.`;

// ─── Fetch với Exponential Backoff ───────────────────────────────────────────
async function fetchWithRetry(url, data, maxRetries = 3) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await axios.post(url, data, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 30000
            });
            return response.data;
        } catch (err) {
            lastError = err;
            const status = err.response?.status;
            // Retry on 429 (rate limit), 500, 503
            if (status === 429 || status >= 500) {
                const delay = Math.pow(2, i) * 1000;
                console.log(`[Discovery] Retry ${i + 1}/${maxRetries} after ${delay}ms (status ${status})`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            break; // Don't retry on 400, 401, 403
        }
    }
    throw lastError;
}

// ─── Extract JSON array từ raw text (đề phòng Gemini trả về kèm text) ────────
function extractJsonArray(rawText) {
    if (!rawText) return null;
    // Try direct parse first
    try {
        const parsed = JSON.parse(rawText.trim());
        if (Array.isArray(parsed)) return parsed;
    } catch (e) { }
    // Extract array via regex
    const match = rawText.match(/\[[\s\S]*\]/);
    if (match) {
        try { return JSON.parse(match[0]); } catch (e) { }
    }
    return null;
}

// ─── Map Gemini lead → raw_posts schema ──────────────────────────────────────
function mapLeadToRawPost(lead, query, discoveryRunId) {
    const postText = [
        lead.pain_signal || '',
        lead.niche ? `Niche: ${lead.niche}` : '',
        Array.isArray(lead.needs) ? `Needs: ${lead.needs.join(', ')}` : '',
        lead.estimated_volume ? `Volume: ${lead.estimated_volume}` : '',
        lead.market ? `Market: ${lead.market}` : '',
        lead.ai_score ? `AI Score: ${lead.ai_score}/100` : '',
    ].filter(Boolean).join(' | ');

    return {
        source_platform: 'web_discovery',
        source_type: 'ai_discovery',
        external_post_id: `discovery_${discoveryRunId}_${encodeURIComponent(lead.source || lead.name || Math.random()).substring(0, 40)}`,
        group_name: `AI Discovery: ${query.substring(0, 60)}`,
        group_id: 'web_discovery',
        author_name: lead.name || 'Unknown Seller',
        author_profile_url: lead.source || '',
        post_url: lead.source || '',
        post_text: postText,
        post_language: 'foreign',
        links_found: JSON.stringify(lead.contact_clues || []),
        raw_payload: JSON.stringify(lead)
    };
}

// ─── Map Gemini lead → post_classifications schema ────────────────────────────
function mapLeadToClassification(lead, rawPostId) {
    const service = lead.thg_service_needed || 'unknown';
    const aiScore = typeof lead.ai_score === 'number' ? lead.ai_score : 65;

    // Derive scores from ai_score if Gemini provided it
    const derived = {
        seller_likelihood: Math.min(100, aiScore + 5),
        pain_score: Math.min(100, aiScore - 5),
        intent_score: Math.min(100, aiScore),
    };

    const hasClues = Array.isArray(lead.contact_clues) && lead.contact_clues.length > 0;
    const lane = hasClues ? 'resolved_lead' : 'partial_lead';

    // Build suggested opener from automation_payload (prefer DM, fallback to pain_signal)
    const payload = lead.automation_payload || {};
    const opener = payload.dm || payload.comment || lead.pain_signal || `Web discovery: ${lead.niche || 'seller'}`;

    // Store full automation payload as strategic summary (JSON stringified)
    const strategic = JSON.stringify({
        dm: payload.dm || '',
        comment: payload.comment || '',
        linkedin: payload.linkedin || '',
        pain_signal: lead.pain_signal || '',
        estimated_volume: lead.estimated_volume || '',
        ai_score: aiScore,
    });

    return {
        raw_post_id: rawPostId,
        model_name: 'gemini-discovery',
        is_relevant: true,
        entity_type: 'seller',
        seller_likelihood: derived.seller_likelihood,
        pain_score: derived.pain_score,
        intent_score: derived.intent_score,
        resolution_confidence: hasClues ? 75 : 35,
        contactability_score: hasClues ? 80 : 30,
        competitor_probability: 5,
        pain_tags: JSON.stringify(lead.needs || []),
        market_tags: JSON.stringify(lead.market ? [lead.market] : ['US']),
        seller_stage_estimate: lead.seller_stage || 'unknown',
        recommended_lane: lane,
        reason_summary: lead.pain_signal || `Web discovery: ${lead.niche || 'seller'}`,
        confidence: hasClues ? 'medium' : 'low',
        raw_response: JSON.stringify(lead),
        thg_service_needed: service,
        suggested_opener: opener,
        strategic_summary: strategic,
        sales_priority_score: aiScore,
        identity_clues: JSON.stringify({
            websites: (lead.contact_clues || []).filter(c => c.includes('.') && !c.includes('@')),
            emails: (lead.contact_clues || []).filter(c => c.includes('@')),
            pages: [],
            phones: []
        })
    };
}

// ─── Main: Run Discovery ──────────────────────────────────────────────────────
async function runDiscovery(query, options = {}) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        throw new Error('GEMINI_API_KEY not configured in .env');
    }

    const maxLeads = options.maxLeads || 5;
    const discoveryRunId = Date.now();

    console.log(`[Discovery] 🔍 Starting search: "${query}" (max ${maxLeads} leads)`);

    const payload = {
        contents: [{
            role: 'user',
            parts: [{ text: `Tìm ${maxLeads} seller/business tiềm năng cần dịch vụ logistics: ${query}` }]
        }],
        tools: [{ google_search: {} }],
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { temperature: 0.1 }
    };

    const url = `${GEMINI_API_URL}?key=${apiKey}`;
    const result = await fetchWithRetry(url, payload);

    const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Gemini returned empty response');

    const leads = extractJsonArray(rawText);
    if (!leads || !Array.isArray(leads) || leads.length === 0) {
        throw new Error('No valid leads found in Gemini response');
    }

    console.log(`[Discovery] ✅ Gemini found ${leads.length} leads`);

    // ── Filter out providers that slipped through the prompt ─────────────────
    const KNOWN_PROVIDERS = ['printful', 'printify', 'cjdropshipping', 'oberlo', 'gelato', 'gooten', 'shipbob', 'flexport', 'onospod', 'gearment', 'teezily', 'spod', 'printbase', 'podza', 'merchize', 'tpop', 'apliiq', 'teelaunch', 'scalablepress'];
    const cleanLeads = leads.filter(l => {
        if (l.is_provider === true) return false;
        const nameLower = (l.name || '').toLowerCase();
        if (KNOWN_PROVIDERS.some(p => nameLower.includes(p))) {
            console.log(`[Discovery] 🚫 Filtered provider: ${l.name}`);
            return false;
        }
        return true;
    });

    if (cleanLeads.length < leads.length) {
        console.log(`[Discovery] 🧹 Filtered ${leads.length - cleanLeads.length} providers out of ${leads.length} results`);
    }

    // Save to DB
    const saved = [];
    const skipped = [];

    for (const lead of cleanLeads) {
        if (!lead.name && !lead.source) { skipped.push(lead); continue; }

        const rawPost = mapLeadToRawPost(lead, query, discoveryRunId);

        try {
            const rawPostId = database.insertRawPost(rawPost);
            const cls = mapLeadToClassification(lead, rawPostId);
            database.insertClassification(cls);

            // Auto-assign to staff based on service
            if (lead.thg_service_needed && lead.thg_service_needed !== 'unknown') {
                try {
                    const override = database.getSetting('SERVICE_STAFF_MAP', null);
                    const defaults = { warehouse: 'Hạnh', express: 'Lê Huyền', pod: 'Moon', quote_needed: 'Thư' };
                    const map = override ? { ...defaults, ...JSON.parse(override) } : defaults;
                    const staff = map[lead.thg_service_needed];
                    if (staff) database._db.prepare(`UPDATE post_classifications SET assigned_to = ? WHERE raw_post_id = ?`).run(staff, rawPostId);
                } catch (e) { }
            }

            saved.push({
                rawPostId,
                name: lead.name,
                source: lead.source,
                lane: cls.recommended_lane,
                service: lead.thg_service_needed,
                ai_score: lead.ai_score || 65,
                automation_payload: lead.automation_payload || null,
                pain_signal: lead.pain_signal || '',
            });
            console.log(`[Discovery] ✅ Saved: ${lead.name} → ${cls.recommended_lane} (${lead.thg_service_needed}) score=${lead.ai_score}`);
        } catch (err) {
            if (err.message?.includes('UNIQUE constraint')) {
                skipped.push(lead); // Duplicate — already in DB
            } else {
                console.error(`[Discovery] ❌ Save failed for ${lead.name}:`, err.message);
                skipped.push(lead);
            }
        }
    }

    return {
        query,
        total_found: leads.length,
        after_filter: cleanLeads.length,
        saved: saved.length,
        skipped: skipped.length,
        leads: saved,
        discovery_run_id: discoveryRunId
    };
}

module.exports = { runDiscovery };
