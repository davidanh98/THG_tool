/**
 * THG Discovery Agent — Gemini 2.5 Flash + Google Search Grounding
 *
 * MODE 1 — "web": Tìm seller trên Google public web (Reddit, diễn đàn, Etsy, LinkedIn...)
 * MODE 2 — "facebook": Generate keyword + opener script tối ưu cho staff dùng tay trong
 *           19 FB Groups — vì Google Search Grounding KHÔNG thể cào FB group posts.
 *
 * Output: Leads enriched với THG-specific schema → raw_posts pipeline.
 */

const axios = require('axios');
const database = require('../core/data_store/database');

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

// ─── FB Groups từ config (dùng cho mode facebook) ────────────────────────────
const FB_TARGET_GROUPS = [
    { name: 'Đặt Hàng TQ Giao US/EU',        id: '1157826901501932' },
    { name: 'Đặt Hàng TQ Ship ĐNA & US',      id: '778601457112289' },
    { name: 'Order Hàng TQ - Vận Chuyển XNK', id: '1698840756986636' },
    { name: 'Tìm Supplier Fulfill POD/Drop',   id: '1312868109620530' },
    { name: 'Dropship & Fulfill VN',           id: '646444174604027' },
    { name: 'Cộng Đồng Người Việt tại Mỹ',    id: '238061523539498' },
    { name: 'Du học sinh VN tại Mỹ',          id: '888744671201380' },
    { name: 'Cộng đồng Amazon VN',            id: 'congdongamazonvn' },
    { name: 'TikTok Shop US Underground',      id: '1631859190422638' },
    { name: 'POD Vietnam Sellers',             id: '112253537621629' },
    { name: 'Amazon FBA Vietnam',              id: '430998570008556' },
    { name: 'Shopify & Dropship VN',           id: '514921692619278' },
];

// ─── System Prompt: MODE WEB ─────────────────────────────────────────────────
const SYSTEM_PROMPT_WEB = `Bạn là chuyên gia tình báo thị trường cho THG Logistics — công ty vận chuyển & fulfillment VN/CN→US/EU.

=== NHIỆM VỤ ===
Dùng Google Search tìm SELLER (người bán hàng) đang có NHU CẦU THỰC SỰ về dịch vụ fulfillment/vận chuyển/kho.
Ưu tiên tìm trên: Reddit, diễn đàn Việt (webtretho, vozforums, otofun, dientuvietnam),
Etsy community, Facebook PAGE công khai (KHÔNG phải group private), LinkedIn,
các blog/website seller VN đang bán hàng quốc tế.

=== ĐỐI TƯỢNG CẦN TÌM ===
- Shop/cá nhân bán trên Etsy, Amazon, Shopify, TikTok Shop đang tìm fulfillment rẻ hơn
- Seller VN/người Việt ở Mỹ cần ship VN/CN→US
- Người đang phàn nàn giá ship cao, giao chậm, kho US đắt
- Seller đang hỏi cộng đồng về warehouse US, 3PL, FBA prep

=== LOẠI BỎ NGAY ===
❌ Công ty logistics/fulfillment (Printify, Printful, CJ, ShipBob, Flexport, Mergify, Onospod, Gearment, Gelato, Gooten...)
❌ Bất kỳ ai đang CHÀO BÁN dịch vụ
❌ Hàng nhập VỀ Việt Nam — sai tuyến
❌ Bài tuyển dụng, tool, phần mềm

=== PHÂN BIỆT ===
✅ GIỮ: "Etsy seller Vietnam cần fulfillment rẻ hơn Printful" → SELLER
❌ BỎ: "Printful provides POD for Etsy" → PROVIDER

Trả về JSON array. Mỗi phần tử:
{
  "name": "Tên seller/brand/username (không phải tên công ty logistics)",
  "source": "URL đầy đủ bắt đầu bằng https:// (link chính xác từ kết quả search)",
  "platform_found": "reddit | etsy | linkedin | forum | facebook_page | shopify | other",
  "niche": "Niche hàng đang bán (ví dụ: POD t-shirts, Amazon FBA electronics)",
  "language": "vi | en | mixed",
  "needs": ["warehouse_us", "express_vn_us", "pod_fulfillment", "3pl", "fba_prep"],
  "thg_service_needed": "warehouse | express | pod | quote_needed | unknown",
  "pain_signal": "Mô tả thực tế vấn đề họ đang gặp",
  "estimated_volume": "Ước tính volume (50-100 orders/day)",
  "contact_clues": ["profile URL", "email nếu có"],
  "market": "US | EU | AU | UK | mixed",
  "seller_stage": "newbie | operator | scaling | unknown",
  "ai_score": số 1-100,
  "automation_payload": {
    "dm": "Tin nhắn DM tiếng Việt, ngắn, đề cập thẳng pain point, kết thúc bằng câu hỏi mở",
    "comment": "Reply comment ngắn 1-2 câu, tự nhiên không spam",
    "linkedin": "LinkedIn message tiếng Anh, chuyên nghiệp"
  },
  "is_provider": false
}
CHỈ TRẢ JSON ARRAY. Nếu không tìm được, trả []. Source PHẢI bắt đầu https://.`;

// ─── System Prompt: MODE FACEBOOK HINT ──────────────────────────────────────
const SYSTEM_PROMPT_FB_HINT = `Bạn là chuyên gia sales và community manager cho THG Logistics — công ty fulfillment VN/CN→US/EU.

=== NHIỆM VỤ ===
Dựa trên query của sales staff, tạo BỘ CÔNG CỤ TÌM KIẾM THỰC CHIẾN cho các Facebook Group Việt Nam.
KHÔNG tìm kiếm web — chỉ generate công cụ để staff dùng TAY trong Facebook.

=== ĐẦU RA YÊU CẦU ===
Trả về JSON array, mỗi phần tử là một "tactic" để dùng trực tiếp trên Facebook:
{
  "tactic_type": "search_keyword | post_template | comment_template | dm_template | group_focus",
  "target_group": "Tên nhóm Facebook cụ thể (từ danh sách được cung cấp)",
  "group_id": "ID group",
  "content": "Nội dung thực tế để copy-paste hoặc keyword để search trong group",
  "use_case": "Mô tả ngắn khi nào dùng tactic này",
  "expected_signal": "Dấu hiệu nhận biết đây là lead phù hợp",
  "pain_addressed": "Pain point của tệp này",
  "priority": "high | medium | low",
  "opener_script": {
    "inbox": "Tin nhắn inbox tiếng Việt, cá nhân hóa, không spam, dưới 100 từ",
    "comment": "Comment trả lời dưới post, tự nhiên, không quảng cáo lộ liễu"
  }
}
CHỈ TRẢ JSON ARRAY. Tạo 5-10 tactics thực dụng nhất.`;

// ─── Fetch với Exponential Backoff ───────────────────────────────────────────
async function fetchWithRetry(url, data, maxRetries = 3) {
    let lastError;
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await axios.post(url, data, {
                headers: { 'Content-Type': 'application/json' },
                timeout: 45000
            });
            return response.data;
        } catch (err) {
            lastError = err;
            const status = err.response?.status;
            if (status === 429 || status >= 500) {
                const delay = Math.pow(2, i) * 1500;
                console.log(`[Discovery] Retry ${i + 1}/${maxRetries} after ${delay}ms (status ${status})`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            break;
        }
    }
    throw lastError;
}

// ─── Extract JSON array từ raw text ──────────────────────────────────────────
function extractJsonArray(rawText) {
    if (!rawText) return null;
    try {
        const parsed = JSON.parse(rawText.trim());
        if (Array.isArray(parsed)) return parsed;
    } catch (e) { }
    const match = rawText.match(/\[[\s\S]*\]/);
    if (match) {
        try { return JSON.parse(match[0]); } catch (e) { }
    }
    return null;
}

// ─── Map Web lead → raw_posts schema ─────────────────────────────────────────
function mapLeadToRawPost(lead, query, discoveryRunId) {
    const postText = [
        lead.pain_signal || '',
        lead.niche ? `Niche: ${lead.niche}` : '',
        Array.isArray(lead.needs) ? `Needs: ${lead.needs.join(', ')}` : '',
        lead.estimated_volume ? `Volume: ${lead.estimated_volume}` : '',
        lead.market ? `Market: ${lead.market}` : '',
        lead.platform_found ? `Platform: ${lead.platform_found}` : '',
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
        post_language: lead.language === 'vi' ? 'vietnamese' : 'foreign',
        links_found: JSON.stringify(lead.contact_clues || []),
        raw_payload: JSON.stringify(lead)
    };
}

// ─── Map Web lead → post_classifications schema ───────────────────────────────
function mapLeadToClassification(lead, rawPostId) {
    const service = lead.thg_service_needed || 'unknown';
    const aiScore = typeof lead.ai_score === 'number' ? lead.ai_score : 65;
    const hasClues = Array.isArray(lead.contact_clues) && lead.contact_clues.length > 0;
    const payload = lead.automation_payload || {};
    const opener = payload.dm || payload.comment || lead.pain_signal || `Web discovery: ${lead.niche || 'seller'}`;

    return {
        raw_post_id: rawPostId,
        model_name: 'gemini-discovery',
        is_relevant: true,
        entity_type: 'seller',
        seller_likelihood: Math.min(100, aiScore + 5),
        pain_score: Math.min(100, aiScore - 5),
        intent_score: Math.min(100, aiScore),
        resolution_confidence: hasClues ? 75 : 35,
        contactability_score: hasClues ? 80 : 30,
        competitor_probability: 5,
        pain_tags: JSON.stringify(lead.needs || []),
        market_tags: JSON.stringify(lead.market ? [lead.market] : ['US']),
        seller_stage_estimate: lead.seller_stage || 'unknown',
        recommended_lane: hasClues ? 'resolved_lead' : 'partial_lead',
        reason_summary: lead.pain_signal || `Web discovery: ${lead.niche || 'seller'}`,
        confidence: hasClues ? 'medium' : 'low',
        raw_response: JSON.stringify(lead),
        thg_service_needed: service,
        suggested_opener: opener,
        strategic_summary: JSON.stringify({
            dm: payload.dm || '',
            comment: payload.comment || '',
            linkedin: payload.linkedin || '',
            pain_signal: lead.pain_signal || '',
            estimated_volume: lead.estimated_volume || '',
            ai_score: aiScore,
            platform_found: lead.platform_found || 'web',
        }),
        sales_priority_score: aiScore,
        identity_clues: JSON.stringify({
            websites: (lead.contact_clues || []).filter(c => c.includes('.') && !c.includes('@')),
            emails: (lead.contact_clues || []).filter(c => c.includes('@')),
            pages: [],
            phones: []
        })
    };
}

// ─── Map FB Hint tactic → raw_posts schema (lưu để staff tra cứu) ────────────
function mapFbHintToRawPost(tactic, query, discoveryRunId) {
    return {
        source_platform: 'web_discovery',
        source_type: 'fb_hint',
        external_post_id: `fbhint_${discoveryRunId}_${encodeURIComponent(tactic.target_group || '').substring(0, 30)}_${Math.random().toString(36).substring(2, 7)}`,
        group_name: tactic.target_group || 'FB Hint',
        group_id: tactic.group_id || 'fb_hint',
        author_name: `[FB Hint] ${tactic.tactic_type}`,
        author_profile_url: tactic.group_id ? `https://www.facebook.com/groups/${tactic.group_id}` : '',
        post_url: tactic.group_id ? `https://www.facebook.com/groups/${tactic.group_id}` : '',
        post_text: [
            `[${tactic.tactic_type?.toUpperCase()}] ${tactic.use_case}`,
            `Content: ${tactic.content}`,
            `Expected: ${tactic.expected_signal}`,
            `Priority: ${tactic.priority}`,
        ].join(' | '),
        post_language: 'vietnamese',
        links_found: JSON.stringify([]),
        raw_payload: JSON.stringify(tactic)
    };
}

// ─── Main: Run Discovery ──────────────────────────────────────────────────────
async function runDiscovery(query, options = {}) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured in .env');

    // mode: 'web' (Google Search grounding) | 'facebook' (FB hint generator, no grounding)
    const mode = options.mode || 'web';
    const maxLeads = options.maxLeads || 5;
    const discoveryRunId = Date.now();

    console.log(`[Discovery] 🔍 Mode="${mode}" Query="${query}" (max ${maxLeads})`);

    let payload;

    if (mode === 'facebook') {
        // Facebook Hint mode — không dùng google_search (không cào được FB group)
        // Chỉ generate công cụ thực chiến cho staff dùng tay
        const groupList = FB_TARGET_GROUPS.map(g => `- "${g.name}" (ID: ${g.id})`).join('\n');
        const fbPrompt = `Query của staff: "${query}"

Danh sách Facebook Groups của THG:
${groupList}

Tạo bộ tactics tìm kiếm và tiếp cận seller trong các group trên.
Tập trung vào tệp: người Việt bán hàng quốc tế, cần ship VN/CN→US, đặt hàng TQ.
Mỗi tactic phải cực kỳ cụ thể và có thể copy-paste trực tiếp.`;

        payload = {
            contents: [{ role: 'user', parts: [{ text: fbPrompt }] }],
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT_FB_HINT }] },
            generationConfig: { temperature: 0.2, maxOutputTokens: 3000 }
            // KHÔNG có tools: google_search — không cần và không giúp được cho Facebook
        };
    } else {
        // Web Discovery mode — dùng Google Search grounding
        // Tối ưu query cho Vietnamese seller content trên web public
        const enhancedQuery = buildWebQuery(query);
        payload = {
            contents: [{
                role: 'user',
                parts: [{ text: `Tìm ${maxLeads} seller/business tiềm năng cần dịch vụ logistics THG:\n${enhancedQuery}` }]
            }],
            tools: [{ google_search: {} }],
            systemInstruction: { parts: [{ text: SYSTEM_PROMPT_WEB }] },
            generationConfig: { temperature: 0.1, maxOutputTokens: 4000 }
        };
    }

    const url = `${GEMINI_API_URL}?key=${apiKey}`;
    const result = await fetchWithRetry(url, payload);

    const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) throw new Error('Gemini returned empty response');

    const items = extractJsonArray(rawText);
    if (!items || !Array.isArray(items) || items.length === 0) {
        throw new Error('Không tìm được kết quả phù hợp. Thử thay đổi query hoặc mode.');
    }

    console.log(`[Discovery] ✅ Gemini returned ${items.length} items (mode=${mode})`);

    if (mode === 'facebook') {
        return await saveFbHints(items, query, discoveryRunId, maxLeads);
    } else {
        return await saveWebLeads(items, query, discoveryRunId);
    }
}

// ─── Build enhanced web query ─────────────────────────────────────────────────
function buildWebQuery(query) {
    // Nếu query đã có tiếng Việt thì giữ nguyên, thêm context
    const hasVietnamese = /[àáảãạăắặẳẵặâấầậẩẫđèéẻẽẹêếềệểễìíỉĩịòóỏõọôốồộổỗơớờợởỡùúủũụưứừựửữỳýỷỹỵ]/i.test(query);

    if (hasVietnamese) {
        return `${query}
Nguồn ưu tiên: Reddit (r/Entrepreneur, r/ecommerce, r/FulfillmentByAmazon, r/dropship),
diễn đàn Việt (webtretho, vozforums), Etsy community forums,
Facebook public pages (không phải group private), blog seller VN.
Tìm các bài viết người thật đang hỏi về vận chuyển, kho, fulfill — không phải bài quảng cáo dịch vụ.`;
    }

    return `${query}
Priority sources: Reddit (r/Entrepreneur, r/ecommerce, r/FulfillmentByAmazon, r/smallbusiness, r/dropship, r/EtsySellers),
Vietnamese seller forums and communities, Etsy community discussions,
LinkedIn Vietnamese seller groups, Shopify community forums.
Find REAL sellers asking about shipping/fulfillment — exclude service provider articles.`;
}

// ─── Save Web Leads ───────────────────────────────────────────────────────────
async function saveWebLeads(leads, query, discoveryRunId) {
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

    const saved = [], skipped = [];

    for (const lead of cleanLeads) {
        if (!lead.name && !lead.source) { skipped.push(lead); continue; }

        const rawPost = mapLeadToRawPost(lead, query, discoveryRunId);
        try {
            const rawPostId = database.insertRawPost(rawPost);
            const cls = mapLeadToClassification(lead, rawPostId);
            database.insertClassification(cls);

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
                platform_found: lead.platform_found || 'web',
                lane: cls.recommended_lane,
                service: lead.thg_service_needed,
                ai_score: lead.ai_score || 65,
                automation_payload: lead.automation_payload || null,
                pain_signal: lead.pain_signal || '',
            });
            console.log(`[Discovery] ✅ Saved web lead: ${lead.name} → ${cls.recommended_lane} (${lead.thg_service_needed})`);
        } catch (err) {
            if (err.message?.includes('UNIQUE constraint')) {
                skipped.push(lead);
            } else {
                console.error(`[Discovery] ❌ Save failed for ${lead.name}:`, err.message);
                skipped.push(lead);
            }
        }
    }

    return {
        mode: 'web',
        query,
        total_found: leads.length,
        after_filter: cleanLeads.length,
        saved: saved.length,
        skipped: skipped.length,
        leads: saved,
        discovery_run_id: discoveryRunId
    };
}

// ─── Save FB Hints ────────────────────────────────────────────────────────────
async function saveFbHints(tactics, query, discoveryRunId, maxLeads) {
    const saved = [];

    for (const tactic of tactics.slice(0, maxLeads * 2)) {
        const rawPost = mapFbHintToRawPost(tactic, query, discoveryRunId);
        try {
            const rawPostId = database.insertRawPost(rawPost);
            // Lưu classification minimal cho fb_hint
            database.insertClassification({
                raw_post_id: rawPostId,
                model_name: 'gemini-fb-hint',
                is_relevant: true,
                entity_type: 'seller',
                seller_likelihood: tactic.priority === 'high' ? 80 : tactic.priority === 'medium' ? 60 : 40,
                pain_score: 70,
                intent_score: 75,
                resolution_confidence: 50,
                contactability_score: 70,
                competitor_probability: 0,
                pain_tags: JSON.stringify([]),
                market_tags: JSON.stringify(['US']),
                seller_stage_estimate: 'unknown',
                recommended_lane: 'fb_hint',
                reason_summary: tactic.use_case || '',
                confidence: 'medium',
                raw_response: JSON.stringify(tactic),
                thg_service_needed: 'quote_needed',
                suggested_opener: tactic.opener_script?.inbox || tactic.content || '',
                strategic_summary: JSON.stringify(tactic.opener_script || {}),
                sales_priority_score: tactic.priority === 'high' ? 85 : tactic.priority === 'medium' ? 65 : 45,
                identity_clues: JSON.stringify({ websites: [], emails: [], pages: [], phones: [] })
            });

            saved.push({
                rawPostId,
                tactic_type: tactic.tactic_type,
                target_group: tactic.target_group,
                group_id: tactic.group_id,
                group_url: tactic.group_id ? `https://www.facebook.com/groups/${tactic.group_id}` : '',
                content: tactic.content,
                use_case: tactic.use_case,
                expected_signal: tactic.expected_signal,
                priority: tactic.priority,
                opener_script: tactic.opener_script || {},
                pain_addressed: tactic.pain_addressed || '',
            });
        } catch (err) {
            console.error(`[Discovery-FB] Save failed:`, err.message);
        }
    }

    console.log(`[Discovery] ✅ Saved ${saved.length} FB hint tactics`);

    return {
        mode: 'facebook',
        query,
        total_found: tactics.length,
        after_filter: tactics.length,
        saved: saved.length,
        skipped: 0,
        tactics: saved,
        discovery_run_id: discoveryRunId
    };
}

module.exports = { runDiscovery, FB_TARGET_GROUPS };
