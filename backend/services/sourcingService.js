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

// ─── Step 2: Tìm supplier URLs qua Gemini grounding — 2 queries song song ─────
// Query 1 (EN): Tìm Alibaba.com — Google index tốt, same suppliers với 1688
// Query 2 (CN): Tìm 1688/Taobao — backup nếu Alibaba không ra
async function findSupplierUrls(keywords, productNameVn) {
    const axios = require('axios');
    const apiKey = process.env.GEMINI_API_KEY;
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const callSearch = async (prompt) => {
        const res = await axios.post(apiUrl, {
            contents: [{ parts: [{ text: prompt }] }],
            tools: [{ google_search: {} }],
            generationConfig: { temperature: 0.1, maxOutputTokens: 1500 },
        }, { headers: { 'Content-Type': 'application/json' }, timeout: 45000 });

        const candidate = res.data?.candidates?.[0];
        return {
            text: candidate?.content?.parts?.map(p => p.text || '').join('') || '',
            chunks: candidate?.groundingMetadata?.groundingChunks || [],
        };
    };

    // Query 1: Alibaba.com (English) — Google index tốt nhất
    const q1 = `Find wholesale factory suppliers for "${productNameVn}" (${keywords}) on alibaba.com.
Show supplier name, price per unit, MOQ, product weight. Prefer verified factory/manufacturer.`;

    // Query 2: 1688/Taobao (Chinese) — giá gốc hơn nhưng khó index
    const q2 = `在1688.com和taobao.com上找"${keywords}"的批发厂家供应商。
显示供应商名称、单价、起订量(MOQ)、重量。`;

    console.log('[Sourcing] Running 2 parallel search queries...');
    const [r1, r2] = await Promise.all([callSearch(q1), callSearch(q2)]);

    const allChunks = [...r1.chunks, ...r2.chunks];
    const textResponse = r1.text + '\n' + r2.text;

    console.log(`[Sourcing] Grounding chunks: Q1=${r1.chunks.length} Q2=${r2.chunks.length}`);

    const offers = [];
    const seen = new Set();

    for (const chunk of allChunks) {
        const uri = chunk.web?.uri || '';
        const title = chunk.web?.title || '';

        // Alibaba.com product/supplier page — Google index tốt nhất
        const mAlibaba = uri.match(/alibaba\.com\/(product-detail|pla|trade\/search)\/[^?]+/);
        if (mAlibaba && uri.includes('alibaba.com') && !seen.has(uri)) {
            seen.add(uri);
            // Extract product ID if present
            const idMatch = uri.match(/_(\d{10,20})\.html/) || uri.match(/[/_](\d{10,20})[/?]/);
            offers.push({
                offer_id: idMatch?.[1] || '',
                platform: 'alibaba',
                title,
                uri,
                url: uri,
            });
        }

        // 1688 offer URL
        const m1688 = uri.match(/detail\.1688\.com\/offer\/(\d{8,15})\.html/);
        if (m1688 && !seen.has(m1688[1])) {
            seen.add(m1688[1]);
            offers.push({ offer_id: m1688[1], platform: '1688', title, uri, url: `https://detail.1688.com/offer/${m1688[1]}.html` });
        }

        // Taobao item URL
        const mTaobao = uri.match(/item\.taobao\.com\/item\.htm[^"&]*[?&]id=(\d{8,15})/);
        if (mTaobao && !seen.has('tb_' + mTaobao[1])) {
            seen.add('tb_' + mTaobao[1]);
            offers.push({ offer_id: mTaobao[1], platform: 'taobao', title, uri, url: `https://item.taobao.com/item.htm?id=${mTaobao[1]}` });
        }

        // AliExpress item URL
        const mAli = uri.match(/aliexpress\.com\/item\/(\d{8,20})\.html/);
        if (mAli && !seen.has('ali_' + mAli[1])) {
            seen.add('ali_' + mAli[1]);
            offers.push({ offer_id: mAli[1], platform: 'aliexpress', title, uri, url: uri });
        }

        // DHgate product URL
        const mDH = uri.match(/dhgate\.com\/product\/[^/]+\/(\d{8,20})\.html/);
        if (mDH && !seen.has('dh_' + mDH[1])) {
            seen.add('dh_' + mDH[1]);
            offers.push({ offer_id: mDH[1], platform: 'dhgate', title, uri, url: uri });
        }
    }

    // Ưu tiên: 1688 > alibaba > taobao > aliexpress > dhgate
    const priority = ['1688', 'alibaba', 'taobao', 'aliexpress', 'dhgate'];
    offers.sort((a, b) => priority.indexOf(a.platform) - priority.indexOf(b.platform));

    console.log(`[Sourcing] Offers found: ${offers.length}`, offers.map(o => `${o.platform}:${o.offer_id||'?'}`).join(', '));
    return { offers, textResponse };
}

// ─── Step 3: Gemini tổng hợp supplier data ────────────────────────────────────
async function buildSupplierResult(product, offers, textResponse) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

    const kw = encodeURIComponent(product.search_keywords_cn || product.product_name_cn || '');
    const searchUrl1688 = `https://s.1688.com/selloffer/offerlist.htm?keywords=${kw}`;
    const best = offers[0]; // đã được sort theo priority

    const offersList = offers.slice(0, 6).map((o, i) =>
        `[${i + 1}] platform=${o.platform} | id=${o.offer_id || 'n/a'} | title="${o.title}" | url=${o.url}`
    ).join('\n');

    const prompt = `Bạn là chuyên gia sourcing hàng Trung Quốc/Châu Á.

Sản phẩm cần tìm nhà cung cấp: ${product.product_name_vn} (CN: ${product.product_name_cn})
Đặc điểm: ${product.key_features} | Danh mục: ${product.category}

DANH SÁCH URLs THẬT từ Google Search (grounding):
${offersList || 'Không tìm được URL sản phẩm cụ thể.'}

THÔNG TIN từ kết quả tìm kiếm:
${textResponse.slice(0, 1000)}

NHIỆM VỤ:
1. Từ URLs và text trên, xác định NHÀ CUNG CẤP tốt nhất (tên công ty/xưởng)
2. Điền thông tin logistics thực tế từ dữ liệu tìm được
3. Nếu có URL thật trong danh sách → dùng url và id đúng từ danh sách đó
4. Nếu không có URL cụ thể → để offer_id="" nhưng vẫn điền đầy đủ supplier name + logistics từ text
5. KHÔNG tự bịa offer_id

Trả về JSON:
{
  "product_name": "${product.product_name_vn}",
  "verified_match": {
    "offer_id": "${best?.offer_id || ''}",
    "factory_name_cn": "Tên nhà cung cấp/xưởng tiếng Trung (extract từ title hoặc text)",
    "factory_name_vn": "Dịch nghĩa hoặc mô tả nhà cung cấp",
    "direct_url": "${best?.url || ''}",
    "search_url": "${searchUrl1688}",
    "platform": "${best?.platform || '1688'}",
    "trust_score": ${offers.length > 0 ? 80 : 40},
    "match_reason": "Nguồn: [tên platform] — lý do chọn supplier này"
  },
  "logistics": {
    "weight": "cân nặng thực tế hoặc ước tính (vd: 0.8 kg/đôi)",
    "min_order": "MOQ từ data (vd: 1 đôi, 5 đôi, 1 thùng)",
    "price_range": "giá sỉ từ data (vd: ¥80-150/đôi)"
  },
  "negotiation_script": {
    "cn": "Kịch bản chat tiếng Trung để mua sỉ ${product.product_name_cn}, hỏi giá và MOQ",
    "vn": "Dịch tiếng Việt của kịch bản trên"
  },
  "qc_checklist": [
    "Kiểm tra đế giày (độ bám, chất liệu)",
    "Kiểm tra mũi giày và phần lót",
    "Đối chiếu kích cỡ với bảng size",
    "Kiểm tra đường may và độ bền"
  ]
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
