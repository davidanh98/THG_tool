/**
 * THG Sourcing Service — Full Automation Pipeline
 *
 * Step 1: Gemini Vision (server-side) → xác định sản phẩm + Chinese keywords
 * Step 2: Playwright stealth → scrape real offers từ 1688.com
 * Step 3: Gemini text → chọn offer phù hợp nhất + generate output
 *
 * Tại sao backend:
 * - Gemini google_search frontend không crawl được 1688 (JS-rendered, Baidu-indexed)
 * - Playwright cần Node.js environment
 * - GEMINI_API_KEY không cần expose ra client
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

let _genAI = null;
function getGenAI() {
    if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    return _genAI;
}

// ─── Parse JSON từ Gemini text ────────────────────────────────────────────────
function parseJson(text) {
    const stripped = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON in response');
    return JSON.parse(stripped.slice(start, end + 1));
}

// ─── Step 1: Gemini Vision — nhận diện sản phẩm ──────────────────────────────
async function analyzeImage(imageBase64, mimeType) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Phân tích ảnh sản phẩm này. Nếu có logo/số/tên custom trên sản phẩm (ví dụ: số áo team thể thao, tên thương hiệu riêng), BỎ QUA logo đó — chỉ xác định LOẠI sản phẩm gốc (base product).

Ví dụ: áo thể thao in logo team → "áo polo thể thao", không phải "áo team X"

Trả về JSON:
{
  "product_name_vn": "tên loại sản phẩm gốc tiếng Việt (ngắn gọn)",
  "product_name_cn": "tên tiếng Trung ngắn (5-10 chữ Hán, VD: 运动夹克)",
  "search_keywords_cn": "keyword tìm xưởng sỉ trên 1688 (3-5 từ Trung cách nhau dấu phẩy, VD: 运动夹克,批发,厂家)",
  "key_features": "chất liệu chính, màu sắc, kiểu dáng nổi bật",
  "category": "danh mục sản phẩm"
}
Chỉ trả JSON, không giải thích.`;

    const result = await model.generateContent([
        { text: prompt },
        { inlineData: { mimeType, data: imageBase64 } },
    ]);

    return parseJson(result.response.text());
}

// ─── Step 2: Tìm supplier URLs qua Gemini REST API + google_search grounding ──
// Key insight: Gemini REST response có groundingMetadata.groundingChunks chứa
// REAL URLs mà Gemini tìm được — đây là nguồn đáng tin, không phải text output.
// Tìm cả 1688, Taobao, AliExpress (cùng Alibaba ecosystem).
async function findSupplierUrls(keywords, productNameVn) {
    const axios = require('axios');
    const apiKey = process.env.GEMINI_API_KEY;

    // Tìm trên nhiều platform: 1688, Taobao, AliExpress, DHgate
    const prompt = `Tìm nhà cung cấp sỉ (wholesale supplier/factory) cho sản phẩm: "${keywords}" (${productNameVn}).
Tìm trên: 1688.com, taobao.com, aliexpress.com, dhgate.com, made-in-china.com
Ưu tiên xưởng gốc trực tiếp (factory direct), giá sỉ, MOQ thấp.
Trả về thông tin: tên nhà cung cấp, giá, MOQ, cân nặng sản phẩm nếu có.`;

    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1500 },
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    const response = await axios.post(url, payload, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 45000,
    });

    const candidate = response.data?.candidates?.[0];
    const textResponse = candidate?.content?.parts?.map(p => p.text || '').join('') || '';

    // Đọc grounding chunks — đây là URLs THẬT Gemini tìm được, không phải hallucination
    const groundingChunks = candidate?.groundingMetadata?.groundingChunks || [];
    console.log(`[Sourcing] Grounding chunks: ${groundingChunks.length}`);

    const offers = [];
    const seen = new Set();

    for (const chunk of groundingChunks) {
        const uri = chunk.web?.uri || '';
        const title = chunk.web?.title || '';

        // 1688 offer URL
        const m1688 = uri.match(/detail\.1688\.com\/offer\/(\d{8,15})\.html/);
        if (m1688 && !seen.has(m1688[1])) {
            seen.add(m1688[1]);
            offers.push({ offer_id: m1688[1], platform: '1688', title, uri, url: `https://detail.1688.com/offer/${m1688[1]}.html` });
        }

        // Taobao item URL
        const mTaobao = uri.match(/item\.taobao\.com\/item\.htm[^"]*[?&]id=(\d{8,15})/);
        if (mTaobao && !seen.has('tb_' + mTaobao[1])) {
            seen.add('tb_' + mTaobao[1]);
            offers.push({ offer_id: mTaobao[1], platform: 'taobao', title, uri, url: `https://item.taobao.com/item.htm?id=${mTaobao[1]}` });
        }

        // AliExpress item URL (same Alibaba ecosystem, easier to access)
        const mAli = uri.match(/aliexpress\.com\/item\/(\d{8,20})\.html/);
        if (mAli && !seen.has('ali_' + mAli[1])) {
            seen.add('ali_' + mAli[1]);
            offers.push({ offer_id: mAli[1], platform: 'aliexpress', title, uri, url: uri });
        }
    }

    console.log(`[Sourcing] Real URLs from grounding: ${offers.length} (1688:${offers.filter(o=>o.platform==='1688').length}, Taobao:${offers.filter(o=>o.platform==='taobao').length}, AliExpress:${offers.filter(o=>o.platform==='aliexpress').length})`);

    return { offers, textResponse };
}

// ─── Step 3: Gemini tổng hợp supplier data từ offers + text response ──────────
async function buildSupplierResult(product, offers, textResponse) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

    const kw = encodeURIComponent(product.search_keywords_cn || product.product_name_cn || '');
    const searchUrl1688 = `https://s.1688.com/selloffer/offerlist.htm?keywords=${kw}`;

    // Ưu tiên: 1688 > taobao > aliexpress
    const best = offers.find(o => o.platform === '1688')
        || offers.find(o => o.platform === 'taobao')
        || offers[0];

    const offersList = offers.slice(0, 5).map((o, i) =>
        `[${i + 1}] platform=${o.platform} | offer_id=${o.offer_id} | title="${o.title}" | url=${o.url}`
    ).join('\n');

    const prompt = `Bạn là chuyên gia sourcing hàng Trung Quốc.

Sản phẩm: ${product.product_name_vn} (CN: ${product.product_name_cn})
Đặc điểm: ${product.key_features} | Danh mục: ${product.category}

URLs THẬT tìm được từ Google (grounding data):
${offersList || '(không tìm được URL nào)'}

Thông tin bổ sung từ tìm kiếm:
${textResponse.slice(0, 800)}

NHIỆM VỤ:
- Nếu có URLs thật trên: chọn offer phù hợp nhất, dùng offer_id và url ĐÚNG từ danh sách
- Nếu không có URL nào: vẫn trả JSON với offer_id="" và trust_score=0
- Dùng thông tin tìm được để điền logistics (weight, price, MOQ)
- KHÔNG được tự bịa offer_id

Trả về JSON:
{
  "product_name": "${product.product_name_vn}",
  "verified_match": {
    "offer_id": "${best?.offer_id || ''}",
    "factory_name_cn": "tên xưởng tiếng Trung từ title hoặc thông tin tìm được",
    "factory_name_vn": "dịch nghĩa",
    "direct_url": "${best?.url || ''}",
    "search_url": "${searchUrl1688}",
    "platform": "${best?.platform || '1688'}",
    "trust_score": ${offers.length > 0 ? 82 : 0},
    "match_reason": "lý do"
  },
  "logistics": {
    "weight": "trọng lượng ước tính từ loại sản phẩm (vd: 0.3 kg)",
    "min_order": "MOQ từ thông tin tìm được",
    "price_range": "giá từ thông tin tìm được"
  },
  "negotiation_script": {
    "cn": "kịch bản chat Trung ngắn để đặt sỉ ${product.product_name_cn}",
    "vn": "dịch tiếng Việt"
  },
  "qc_checklist": ["kiểm tra 1", "kiểm tra 2", "kiểm tra 3", "kiểm tra 4"]
}
Chỉ trả JSON.`;

    const result = await model.generateContent([{ text: prompt }]);
    const parsed = parseJson(result.response.text());

    // Enforce: nếu Gemini bịa offer_id khác với danh sách thật → dùng best thật
    const validIds = new Set(offers.map(o => o.offer_id));
    const vm = parsed.verified_match;
    if (vm?.offer_id && !validIds.has(vm.offer_id)) {
        if (best) {
            vm.offer_id = best.offer_id;
            vm.direct_url = best.url;
            vm.platform = best.platform;
            vm.trust_score = 65;
        } else {
            vm.offer_id = '';
            vm.direct_url = '';
            vm.trust_score = 0;
        }
    }
    if (vm && !vm.search_url) vm.search_url = searchUrl1688;

    return parsed;
}

// ─── Fallback khi không tìm được gì ──────────────────────────────────────────
function buildFallback(product) {
    const kw = encodeURIComponent(product.search_keywords_cn || product.product_name_cn || '');
    return {
        product_name: product.product_name_vn || 'Sản phẩm',
        verified_match: {
            offer_id: '',
            factory_name_cn: '',
            factory_name_vn: 'Không tìm được — thử tìm thủ công',
            direct_url: '',
            search_url: `https://s.1688.com/selloffer/offerlist.htm?keywords=${kw}`,
            platform: '1688',
            trust_score: 0,
            match_reason: 'Không tìm được sản phẩm phù hợp qua Google. Dùng nút "Tìm trên 1688" để tìm thủ công với keyword đã chuẩn bị.',
        },
        logistics: { weight: '', min_order: '', price_range: '' },
        negotiation_script: { cn: '', vn: '' },
        qc_checklist: [],
    };
}

// ─── Main Export ──────────────────────────────────────────────────────────────
async function runSourcing(imageBase64, mimeType) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY chưa được cấu hình trong .env');

    console.log('[Sourcing] 🔍 Pipeline bắt đầu...');

    // Step 1
    const product = await analyzeImage(imageBase64, mimeType);
    console.log(`[Sourcing] ✅ Step 1: ${product.product_name_vn} | KW: ${product.search_keywords_cn}`);

    // Step 2: Tìm URLs thật qua Gemini grounding (Google Search)
    const keywords = product.search_keywords_cn || product.product_name_cn;
    const { offers, textResponse } = await findSupplierUrls(keywords, product.product_name_vn);

    if (offers.length === 0 && !textResponse) {
        console.log('[Sourcing] ⚠️ Không tìm được gì — fallback');
        return buildFallback(product);
    }

    // Step 3: Tổng hợp kết quả
    const result = await buildSupplierResult(product, offers, textResponse);
    console.log(`[Sourcing] ✅ Done: "${result.verified_match?.factory_name_cn}" platform=${result.verified_match?.platform} offer_id=${result.verified_match?.offer_id || 'none'}`);
    return result;
}

module.exports = { runSourcing };
