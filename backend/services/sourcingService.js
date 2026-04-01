/**
 * THG Sourcing Service — Full Automation Pipeline v2.1
 *
 * Architecture:
 *   Step 1: Gemini Vision/Text → product identification + keywords
 *   Step 2: Gemini + Google Search Grounding → find real 1688/Alibaba supplier URLs
 *   Step 3: Gemini enrich + format → multi-supplier JSON with specs
 *
 * Key Change v2.1: Replaced Playwright scrapers (unreliable on VPS) with
 * Gemini Google Search grounding for real supplier URL discovery.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleGenAI } = require('@google/genai');

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

    const prompt = `Analyze this product image carefully. If there are custom logos, brand names, or team numbers on the product, IGNORE them — identify only the BASE PRODUCT TYPE.

Return JSON:
{
  "product_name_vn": "tên loại sản phẩm gốc tiếng Việt",
  "product_name_cn": "tên tiếng Trung (5-8 chữ Hán)",
  "product_name_en": "product type in English (short, for Alibaba search)",
  "search_keywords_cn": "keyword tìm xưởng 1688 (3-5 từ Trung, cách nhau dấu phẩy)",
  "search_keywords_en": "english keywords for Alibaba.com search (3-5 words)",
  "key_features": "material, color, style (no brand names)",
  "category": "product category",
  "estimated_weight_kg": "ước tính cân nặng 1 đơn vị (kg) — dựa trên loại sản phẩm"
}
Return JSON only.`;

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

Return JSON:
{
  "product_name_vn": "tên tiếng Việt chuẩn",
  "product_name_cn": "tên tiếng Trung (5-8 chữ Hán, phù hợp search 1688)",
  "product_name_en": "English name (short, for Alibaba search)",
  "search_keywords_cn": "keyword tìm xưởng 1688 (3-5 từ Trung, cách nhau dấu phẩy)",
  "search_keywords_en": "english keywords for Alibaba.com search (3-5 words)",
  "key_features": "material, typical features (no brand names)",
  "category": "product category",
  "estimated_weight_kg": "ước tính cân nặng 1 đơn vị (kg)"
}
Return JSON only.`;

    const result = await model.generateContent([{ text: prompt }]);
    return parseJson(result.response.text());
}

// ─── Step 2: Gemini + Google Search Grounding → find REAL suppliers ───────────
async function searchSuppliersWithGrounding(product) {
    const ai = getGenAINew();

    const kwCn = product.search_keywords_cn || product.product_name_cn || '';
    const kwEn = product.search_keywords_en || product.product_name_en || '';

    const prompt = `Tìm xưởng sản xuất sỉ cho: "${product.product_name_cn}" (${product.product_name_en}).
Keywords 1688: ${kwCn} | Keywords Alibaba: ${kwEn}

Search 1688.com và alibaba.com. Với mỗi supplier tìm được, trích xuất:
- factory_name_cn: tên xưởng
- direct_url: URL trang sản phẩm CỤ THỂ (dạng detail.1688.com/offer/xxx.html hoặc alibaba.com/product-detail/xxx.html)
- platform: "1688" hoặc "alibaba"
- price, moq, weight, material, lead_time, supplier_years

Trả về JSON array (tối đa 5), CHỈ JSON.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { tools: [{ googleSearch: {} }] },
        });

        // ─── PRIORITY: Extract REAL verified URLs from groundingChunks ───────
        const groundingMeta = response.candidates?.[0]?.groundingMetadata;
        const realUrls = [];

        if (groundingMeta?.groundingChunks?.length) {
            console.log(`[Sourcing] ✅ Grounding chunks: ${groundingMeta.groundingChunks.length}`);
            for (const chunk of groundingMeta.groundingChunks) {
                const url = chunk.web?.uri || '';
                const title = chunk.web?.title || '';
                const is1688 = url.includes('detail.1688.com') || (url.includes('1688.com') && url.includes('offer'));
                const isAlibaba = url.includes('alibaba.com/product-detail') || url.includes('alibaba.com/p-detail');
                if (is1688 || isAlibaba) {
                    // Avoid duplicate URLs
                    if (!realUrls.find(r => r.url === url)) {
                        realUrls.push({
                            url,
                            title,
                            platform: is1688 ? '1688' : 'alibaba',
                            offer_id: url.match(/offer\/(\d+)\.html/)?.[1] || url.match(/\/(\d{10,})/)?.[1] || '',
                        });
                    }
                }
            }
            console.log(`[Sourcing] ✅ Real product URLs from grounding: ${realUrls.length}`);
            realUrls.forEach(r => console.log(`  [${r.platform}] ${r.url}`));
        }

        // ─── Parse Gemini text for supplier names/specs ──────────────────────
        const text = response.text || '';
        let aiSuppliers = [];
        try {
            const parsed = parseJson(text);
            aiSuppliers = Array.isArray(parsed) ? parsed : [parsed];
        } catch (e) {
            console.log(`[Sourcing] ⚠️ Gemini text JSON parse failed`);
        }

        // ─── Merge: real URLs (primary) + AI text for specs ─────────────────
        if (realUrls.length > 0) {
            const merged = realUrls.map((realUrl, i) => {
                // Try to find AI supplier matching same platform, use by index fallback
                const aiMatch = aiSuppliers.find((s, si) =>
                    s.platform === realUrl.platform && si === i
                ) || aiSuppliers.find(s => s.platform === realUrl.platform)
                    || aiSuppliers[i] || {};

                return {
                    factory_name_cn: aiMatch.factory_name_cn || realUrl.title || '',
                    factory_name_vn: aiMatch.factory_name_vn || '',
                    direct_url: realUrl.url,   // ← ALWAYS use the real grounding URL
                    platform: realUrl.platform,
                    offer_id: realUrl.offer_id,
                    price: aiMatch.price || '',
                    moq: aiMatch.moq || '',
                    weight: aiMatch.weight || '',
                    material: aiMatch.material || '',
                    dimensions: aiMatch.dimensions || '',
                    lead_time: aiMatch.lead_time || '',
                    supplier_years: aiMatch.supplier_years || '',
                    certifications: aiMatch.certifications || '',
                };
            });

            console.log(`[Sourcing] ✅ ${merged.length} suppliers with verified URLs`);
            return merged.slice(0, 5);
        }

        // Fallback: use AI text suppliers if no grounding URLs
        if (aiSuppliers.length > 0) {
            console.log(`[Sourcing] ⚠️ No grounding URLs found, using AI estimate (${aiSuppliers.length} suppliers)`);
            return aiSuppliers.slice(0, 5);
        }

        return [];
    } catch (err) {
        console.error(`[Sourcing] ⚠️ Google Search grounding failed: ${err.message}`);
        return [];
    }
}

// ─── Step 3: Enrich + Format multi-supplier JSON ──────────────────────────────
async function buildFinalResult(product, groundedSuppliers) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

    const kw1688 = encodeURIComponent(product.search_keywords_cn || product.product_name_cn || '');
    const kwAlibaba = encodeURIComponent(product.search_keywords_en || product.product_name_en || '');
    const searchUrl1688 = `https://s.1688.com/selloffer/offerlist.htm?keywords=${kw1688}`;
    const searchUrlAlibaba = `https://www.alibaba.com/trade/search?SearchText=${kwAlibaba}`;

    const suppliersData = groundedSuppliers.length > 0
        ? groundedSuppliers.map((s, i) => `
Supplier ${i + 1} [${s.platform || 'unknown'}]:
  - Xưởng: ${s.factory_name_cn || 'N/A'}
  - URL: ${s.direct_url || 'N/A'}
  - Offer ID: ${s.offer_id || 'N/A'}
  - Giá: ${s.price || 'N/A'}
  - MOQ: ${s.moq || 'N/A'}
  - Cân nặng: ${s.weight || 'chưa tìm được'}
  - Chất liệu: ${s.material || 'N/A'}
  - Kích thước: ${s.dimensions || 'N/A'}
  - Lead time: ${s.lead_time || 'N/A'}
  - Kinh nghiệm: ${s.supplier_years || 'N/A'}
  - Chứng nhận: ${s.certifications || 'N/A'}
`).join('\n')
        : 'Không tìm được supplier cụ thể — dùng kiến thức chuyên ngành để tạo profile ước tính.';

    const prompt = `Bạn là chuyên gia sourcing hàng Trung Quốc cho công ty logistics THG.

Sản phẩm: ${product.product_name_vn} (EN: ${product.product_name_en}, CN: ${product.product_name_cn})
Đặc điểm: ${product.key_features || ''}
Cân nặng ước tính: ${product.estimated_weight_kg || 'N/A'}

=== DỮ LIỆU TÌM ĐƯỢC TỪ GOOGLE SEARCH ===
${suppliersData}

Tạo profile đầy đủ cho từng supplier. QUAN TRỌNG:
1. Trường "direct_url" PHẢI giữ NGUYÊN URL từ dữ liệu gốc — TUYỆT ĐỐI không thay đổi, không tạo URL mới
2. Nếu weight/material chưa có → ước tính dựa trên loại sản phẩm
3. Nếu không có supplier nào → tạo 2-3 profiles ước tính, KHÔNG có direct_url

Trả về JSON ARRAY, mỗi phần tử:
{
  "rank": 1,
  "offer_id": "ID từ URL gốc",
  "factory_name_cn": "Tên xưởng",
  "factory_name_vn": "Mô tả tiếng Việt",
  "direct_url": "COPY NGUYÊN URL từ dữ liệu gốc bên trên",
  "search_url": "${searchUrl1688}",
  "platform": "1688 hoặc alibaba",
  "trust_score": 75,
  "match_reason": "Lý do phù hợp",
  "logistics": {
    "weight": "vd: 0.8 kg/đơn vị",
    "cbm": "vd: 0.5 m³/100 units",
    "material": "chất liệu chính",
    "min_order": "MOQ",
    "price_range": "giá",
    "lead_time": "vd: 7-15 ngày",
    "certifications": ""
  },
  "supplier_info": {
    "years_in_business": "số năm",
    "rating": ""
  }
}

Thêm 1 object negotiation cuối:
{
  "negotiation": true,
  "script_cn": "你好，我想批量采购${product.product_name_cn}，请问贵厂可以提供报价和MOQ吗？我们是越南物流公司THG，长期合作。",
  "script_vn": "Xin chào, tôi muốn đặt hàng sỉ ${product.product_name_vn}. Xưởng báo giá và MOQ được không? Công ty THG Việt Nam, hợp tác lâu dài.",
  "qc_checklist": ["Xác nhận cân nặng thực tế", "Kiểm tra chất liệu", "Đối chiếu kích thước", "Kiểm tra đóng gói", "Yêu cầu mẫu trước đơn lớn"]
}

CHỈ TRẢ JSON ARRAY.`;

    const result = await model.generateContent([{ text: prompt }]);
    const parsed = parseJson(result.response.text());
    const arr = Array.isArray(parsed) ? parsed : [parsed];

    // ─── Re-inject real URLs: Gemini may have changed them — restore from groundedSuppliers
    const realUrlMap = {};
    groundedSuppliers.forEach((s, i) => {
        if (s.direct_url) realUrlMap[i] = s.direct_url;
        if (s.offer_id) realUrlMap[`id_${s.offer_id}`] = s.direct_url;
    });

    let supplierIdx = 0;
    arr.forEach(item => {
        if (item.negotiation) return;
        // Restore real URL if Gemini changed it
        const originalUrl = realUrlMap[supplierIdx];
        if (originalUrl) {
            item.direct_url = originalUrl;
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
        console.log(`[Sourcing] ✅ Step 1 (Text): ${product.product_name_vn} | EN: ${product.search_keywords_en}`);
    } else {
        product = await analyzeImage(imageBase64, mimeType);
        console.log(`[Sourcing] ✅ Step 1 (Image): ${product.product_name_vn} | EN: ${product.search_keywords_en} | CN: ${product.search_keywords_cn}`);
    }

    // Step 2: Find real suppliers using Gemini + Google Search grounding
    console.log('[Sourcing] 🔍 Step 2: Gemini + Google Search grounding...');
    const groundedSuppliers = await searchSuppliersWithGrounding(product);
    console.log(`[Sourcing] ✅ Step 2: ${groundedSuppliers.length} suppliers found via Google Search`);

    // Step 3: Enrich & format
    console.log('[Sourcing] 🔍 Step 3: Enriching supplier data...');
    const enrichedArray = await buildFinalResult(product, groundedSuppliers);

    // Separate suppliers from negotiation data
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

    console.log(`[Sourcing] ✅ Done: ${suppliers.length} suppliers found`);
    return { product, result };
}

module.exports = { runSourcing };
