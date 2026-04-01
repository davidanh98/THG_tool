/**
 * THG Sourcing Service — Full Automation Pipeline v2.2
 *
 * Architecture:
 *   Step 1: Gemini Vision/Text → product identification + keywords
 *   Step 2: SerpAPI → search site:detail.1688.com + alibaba.com → real product URLs
 *   Step 3: Gemini → enrich supplier data + specs estimation + format JSON
 *
 * SerpAPI: https://serpapi.com — free tier 100 req/month
 * Uses SERPAPI_KEY env var. Falls back to Gemini grounding if key not set.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');

let _genAI = null;
let _genAINew = null;

function getGenAI() {
    if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    return _genAI;
}
function getGenAINew() {
    if (!_genAINew) _genAINew = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });
    return _genAINew;
}

function parseJson(text) {
    const stripped = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const arrStart = stripped.indexOf('[');
    const arrEnd = stripped.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
        try { return JSON.parse(stripped.slice(arrStart, arrEnd + 1)); } catch (e) { }
    }
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON in response');
    return JSON.parse(stripped.slice(start, end + 1));
}

// ─── Step 1a: Gemini Vision (image input) ─────────────────────────────────────
async function analyzeImage(imageBase64, mimeType) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Analyze this product image. IGNORE logos/brands. Identify only the BASE PRODUCT TYPE.

Return JSON only:
{
  "product_name_vn": "tên loại sản phẩm tiếng Việt",
  "product_name_cn": "tên tiếng Trung (5-8 chữ Hán)",
  "product_name_en": "English product type (short)",
  "search_keywords_cn": "keyword 1688 (3-5 từ Trung)",
  "search_keywords_en": "Alibaba keywords (3-5 words)",
  "key_features": "material, style (no brand names)",
  "category": "product category",
  "estimated_weight_kg": "estimated weight per unit (kg)"
}`;

    const result = await model.generateContent([
        { text: prompt },
        { inlineData: { mimeType, data: imageBase64 } },
    ]);
    return parseJson(result.response.text());
}

// ─── Step 1b: Gemini Text (product name input) ────────────────────────────────
async function analyzeText(productName) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Bạn là chuyên gia sourcing hàng Trung Quốc. Phân tích sản phẩm: "${productName}"

Return JSON only:
{
  "product_name_vn": "tên tiếng Việt chuẩn",
  "product_name_cn": "tên tiếng Trung (5-8 chữ Hán, phù hợp search 1688)",
  "product_name_en": "English name (short, for Alibaba search)",
  "search_keywords_cn": "keyword tìm xưởng 1688 (3-5 từ Trung)",
  "search_keywords_en": "Alibaba keywords (3-5 words)",
  "key_features": "material, typical features",
  "category": "product category",
  "estimated_weight_kg": "ước tính cân nặng 1 đơn vị (kg)"
}`;

    const result = await model.generateContent([{ text: prompt }]);
    return parseJson(result.response.text());
}

// ─── Step 2a: SerpAPI search ──────────────────────────────────────────────────
async function serpSearch(query, num = 5) {
    const key = process.env.SERPAPI_KEY;
    if (!key) throw new Error('SERPAPI_KEY not configured');

    const params = {
        engine: 'google',
        q: query,
        num,
        api_key: key,
        hl: 'zh-CN',
        gl: 'cn',
    };

    const res = await axios.get('https://serpapi.com/search', { params, timeout: 15000 });
    return res.data?.organic_results || [];
}

// ─── Step 2b: Find real supplier URLs via SerpAPI ─────────────────────────────
async function findSupplierUrls(product) {
    const kwCn = product.search_keywords_cn || product.product_name_cn || '';
    const kwEn = product.search_keywords_en || product.product_name_en || '';

    const realUrls = [];

    // Search 1: 1688 detail pages (Chinese keywords)
    // Search 2: Alibaba product pages (English keywords)
    const searches = [
        { query: `site:detail.1688.com ${kwCn}`, platform: '1688' },
        { query: `site:www.alibaba.com "${kwEn}" product-detail`, platform: 'alibaba' },
    ];

    await Promise.allSettled(searches.map(async ({ query, platform }) => {
        try {
            console.log(`[Sourcing] 🔍 SerpAPI: "${query}"`);
            const results = await serpSearch(query, 5);

            for (const r of results) {
                const url = r.link || '';
                const title = r.title || '';
                const snippet = r.snippet || '';

                const is1688 = url.includes('detail.1688.com') || (url.includes('1688.com') && url.includes('offer'));
                const isAlibaba = url.includes('alibaba.com/product-detail') || url.includes('alibaba.com/p-detail');

                if ((platform === '1688' && is1688) || (platform === 'alibaba' && isAlibaba)) {
                    if (!realUrls.find(u => u.url === url)) {
                        const offerId = url.match(/offer\/(\d+)\.html/)?.[1]
                            || url.match(/\/(\d{10,})/)?.[1] || '';

                        realUrls.push({
                            url,
                            title: title.replace(/ - 1688\.com$/, '').replace(/ \| Alibaba\.com$/, ''),
                            snippet,
                            platform,
                            offer_id: offerId,
                        });
                    }
                }
            }

            console.log(`[Sourcing] ✅ SerpAPI [${platform}]: ${realUrls.filter(u => u.platform === platform).length} URLs`);
        } catch (err) {
            console.error(`[Sourcing] ⚠️ SerpAPI [${platform}] error: ${err.message}`);
        }
    }));

    return realUrls;
}

// ─── Step 2 fallback: Gemini Google Search Grounding ─────────────────────────
async function findSupplierUrlsViaGrounding(product) {
    const ai = getGenAINew();
    const kwCn = product.search_keywords_cn || product.product_name_cn || '';
    const kwEn = product.search_keywords_en || product.product_name_en || '';

    const prompt = `Tìm xưởng sản xuất sỉ cho: "${product.product_name_cn}" (${product.product_name_en}).
Keywords 1688: ${kwCn} | Keywords Alibaba: ${kwEn}
Search 1688.com và alibaba.com, trả về JSON array với direct_url, platform, price, moq, weight, material.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] },
        });

        const groundingMeta = response.candidates?.[0]?.groundingMetadata;
        const realUrls = [];

        if (groundingMeta?.groundingChunks?.length) {
            for (const chunk of groundingMeta.groundingChunks) {
                const url = chunk.web?.uri || '';
                const title = chunk.web?.title || '';
                const is1688 = url.includes('detail.1688.com') || (url.includes('1688.com') && url.includes('offer'));
                const isAlibaba = url.includes('alibaba.com/product-detail');
                if (is1688 || isAlibaba) {
                    if (!realUrls.find(r => r.url === url)) {
                        realUrls.push({
                            url, title,
                            platform: is1688 ? '1688' : 'alibaba',
                            offer_id: url.match(/offer\/(\d+)\.html/)?.[1] || '',
                        });
                    }
                }
            }
        }

        return realUrls;
    } catch (err) {
        console.error(`[Sourcing] ⚠️ Grounding fallback failed: ${err.message}`);
        return [];
    }
}

// ─── Step 3: Gemini enrich → full supplier profiles ──────────────────────────
async function buildFinalResult(product, realUrls) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

    const kw1688 = encodeURIComponent(product.search_keywords_cn || product.product_name_cn || '');
    const kwAlibaba = encodeURIComponent(product.search_keywords_en || product.product_name_en || '');
    const searchUrl1688 = `https://s.1688.com/selloffer/offerlist.htm?keywords=${kw1688}`;

    // Build supplier context from real URLs
    const suppliersContext = realUrls.length > 0
        ? realUrls.map((s, i) => `
Supplier ${i + 1} [${s.platform}]:
  URL (THẬT): ${s.url}
  Offer ID: ${s.offer_id || 'N/A'}
  Title: ${s.title}
  Snippet: ${s.snippet || 'N/A'}`).join('\n')
        : `KHÔNG tìm được URL thật — hãy ước tính 2-3 profiles từ kiến thức ngành`;

    const prompt = `Bạn là chuyên gia sourcing hàng Trung Quốc cho THG logistics.

Sản phẩm: ${product.product_name_vn} (CN: ${product.product_name_cn}, EN: ${product.product_name_en})
Đặc điểm: ${product.key_features || ''}
Cân nặng ước tính: ${product.estimated_weight_kg || 'N/A'} kg

=== KẾT QUẢ TÌM KIẾM THẬT (SerpAPI/Google) ===
${suppliersContext}

Nhiệm vụ: Tạo profile đầy đủ cho TỪNG supplier trên.

QUAN TRỌNG:
- Trường "direct_url": COPY NGUYÊN URL THẬT từ dữ liệu trên — KHÔNG tự bịa URL mới
- Nếu snippet có giá/MOQ → dùng đó; nếu không → ước tính hợp lý
- Weight: PHẢI có (ước tính nếu chưa biết)
- Nếu không có URL thật → tạo profile ước tính, KHÔNG điền direct_url

Trả về JSON ARRAY, mỗi supplier:
{
  "rank": 1,
  "offer_id": "từ URL",
  "factory_name_cn": "tên xưởng (từ title)",
  "factory_name_vn": "mô tả tiếng Việt",
  "direct_url": "URL THẬT từ dữ liệu gốc bên trên",
  "search_url": "${searchUrl1688}",
  "platform": "1688 hoặc alibaba",
  "trust_score": 70,
  "match_reason": "lý do phù hợp",
  "logistics": {
    "weight": "vd: 0.8 kg/đôi (bắt buộc)",
    "cbm": "vd: 0.5 m³/100 units",
    "material": "chất liệu",
    "min_order": "MOQ",
    "price_range": "giá",
    "lead_time": "vd: 15-25 ngày",
    "certifications": ""
  },
  "supplier_info": {
    "years_in_business": "",
    "rating": ""
  }
}

Append thêm negotiation object:
{
  "negotiation": true,
  "script_cn": "你好，我想批量采购${product.product_name_cn}，请问可以提供报价和MOQ吗？我们是越南THG物流公司，长期合作。",
  "script_vn": "Xin chào, tôi muốn đặt sỉ ${product.product_name_vn}. Xưởng báo giá + MOQ được không? Công ty THG VN, hợp tác lâu dài.",
  "qc_checklist": ["Xác nhận cân nặng thực tế", "Kiểm tra chất liệu", "Đối chiếu kích thước", "Kiểm tra đóng gói", "Yêu cầu mẫu trước đơn lớn"]
}

CHỈ TRẢ JSON ARRAY.`;

    const result = await model.generateContent([{ text: prompt }]);
    const parsed = parseJson(result.response.text());
    const arr = Array.isArray(parsed) ? parsed : [parsed];

    // Safety: re-inject real URLs in case Gemini changed them
    let supplierIdx = 0;
    arr.forEach(item => {
        if (item.negotiation) return;
        const realUrl = realUrls[supplierIdx];
        if (realUrl?.url) {
            item.direct_url = realUrl.url;         // ALWAYS use verified URL
            item.platform = realUrl.platform;
            item.offer_id = item.offer_id || realUrl.offer_id;
        }
        if (!item.search_url) item.search_url = searchUrl1688;
        supplierIdx++;
    });

    return arr;
}

// ─── Main Export ──────────────────────────────────────────────────────────────
async function runSourcing({ imageBase64, mimeType, productName, searchType }) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY chưa cấu hình trong .env');

    const isTextSearch = searchType === 'text' || (!imageBase64 && productName);
    console.log(`[Sourcing] 🔍 Pipeline bắt đầu... mode=${isTextSearch ? 'text' : 'image'}`);

    // Step 1: Identify product
    let product;
    if (isTextSearch) {
        product = await analyzeText(productName);
        console.log(`[Sourcing] ✅ Step 1 (Text): ${product.product_name_vn} | CN: ${product.search_keywords_cn}`);
    } else {
        product = await analyzeImage(imageBase64, mimeType);
        console.log(`[Sourcing] ✅ Step 1 (Image): ${product.product_name_vn} | EN: ${product.search_keywords_en}`);
    }

    // Step 2: Find real supplier URLs
    let realUrls = [];
    if (process.env.SERPAPI_KEY) {
        console.log('[Sourcing] 🔍 Step 2: SerpAPI search...');
        realUrls = await findSupplierUrls(product);
        console.log(`[Sourcing] ✅ Step 2 (SerpAPI): ${realUrls.length} real URLs found`);
        realUrls.forEach(r => console.log(`  [${r.platform}] ${r.url}`));
    } else {
        console.log('[Sourcing] ⚠️ SERPAPI_KEY not set — falling back to Gemini grounding');
        realUrls = await findSupplierUrlsViaGrounding(product);
        console.log(`[Sourcing] ✅ Step 2 (Grounding): ${realUrls.length} real URLs found`);
    }

    // Step 3: Enrich & format
    console.log('[Sourcing] 🔍 Step 3: Gemini enriching supplier data...');
    const enrichedArray = await buildFinalResult(product, realUrls);

    // Separate suppliers from negotiation
    const suppliers = enrichedArray.filter(s => !s.negotiation);
    const negotiationData = enrichedArray.find(s => s.negotiation) || {};

    const result = {
        product_name: product.product_name_vn,
        product_name_cn: product.product_name_cn,
        product_name_en: product.product_name_en,
        search_type: isTextSearch ? 'text' : 'image',
        search_query: isTextSearch ? productName : product.product_name_vn,
        suppliers,
        negotiation_script: {
            cn: negotiationData.script_cn || '',
            vn: negotiationData.script_vn || '',
        },
        qc_checklist: negotiationData.qc_checklist || [],
        total_suppliers: suppliers.length,
        search_urls: {
            alibaba: `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(product.search_keywords_en || '')}`,
            '1688': `https://s.1688.com/selloffer/offerlist.htm?keywords=${encodeURIComponent(product.search_keywords_cn || '')}`,
        },
    };

    console.log(`[Sourcing] ✅ Done: ${suppliers.length} suppliers | ${realUrls.filter(u => !!u.url).length} with real URLs`);
    return { product, result };
}

module.exports = { runSourcing };
