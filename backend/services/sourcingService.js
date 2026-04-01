/**
 * THG Sourcing Service — Full Automation Pipeline v2
 *
 * IMPROVEMENTS:
 * - Multi-supplier: returns top 5 suppliers (was 1)
 * - Text search: accepts product name OR image
 * - Expanded specs: weight, CBM, material, lead time, supplier rating
 * - 1688 via Google: searches Google for 1688 detail pages
 * - DB persistence: saves all results for history
 *
 * Pipeline:
 *   Step 1: Gemini Vision/Text → product identification + keywords
 *   Step 2: Playwright scrape Alibaba.com (multi-supplier) + 1688 via Google
 *   Step 3: Gemini enrich missing data → format JSON array
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

let _genAI = null;
function getGenAI() {
    if (!_genAI) _genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
    return _genAI;
}

function parseJson(text) {
    const stripped = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    // Try array first
    const arrStart = stripped.indexOf('[');
    const arrEnd = stripped.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
        try { return JSON.parse(stripped.slice(arrStart, arrEnd + 1)); } catch (e) { }
    }
    // Try object
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

// ─── Step 2a: Playwright scrape Alibaba.com (multi-supplier) ──────────────────
async function scrapeAlibaba(product) {
    let browser;
    try {
        const { chromium } = require('playwright-extra');
        const StealthPlugin = require('puppeteer-extra-plugin-stealth');
        chromium.use(StealthPlugin());

        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            locale: 'en-US',
        });
        const page = await context.newPage();
        await page.setDefaultTimeout(30000);

        // Search Alibaba.com với English keywords
        const keywords = product.search_keywords_en || product.product_name_en;
        const searchUrl = `https://www.alibaba.com/trade/search?SearchText=${encodeURIComponent(keywords)}&IndexArea=product_en&tab=all`;
        console.log(`[Sourcing] Alibaba search: "${keywords}"`);

        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
        await page.waitForTimeout(3000);

        // Lấy danh sách products từ search results
        const products = await page.evaluate(() => {
            const results = [];
            const seen = new Set();
            const cardSelectors = [
                '.J-offer-wrapper', '.organic-offer-wrapper',
                '[class*="offer-list"] > li', '.search-card-e-wrapper',
                '[class*="product-card"]', '.list-item',
            ];

            let cards = [];
            for (const sel of cardSelectors) {
                const found = [...document.querySelectorAll(sel)];
                if (found.length > 2) { cards = found; break; }
            }

            for (const card of cards.slice(0, 15)) {
                const links = [...card.querySelectorAll('a[href*="alibaba.com"]')];
                const productLink = links.find(l =>
                    l.href.includes('/product-detail/') ||
                    l.href.includes('/p-detail/') ||
                    l.href.includes('.html')
                );
                if (!productLink || seen.has(productLink.href)) continue;
                seen.add(productLink.href);

                const title = card.querySelector(
                    '[class*="title"], h4, .subject, [class*="subject"]'
                )?.textContent?.trim() || productLink.textContent?.trim() || '';

                const price = card.querySelector('[class*="price"]')?.textContent?.trim() || '';
                const moq = card.querySelector('[class*="moq"], [class*="min-order"]')?.textContent?.trim() || '';
                const supplier = card.querySelector('[class*="company"], [class*="supplier"]')?.textContent?.trim() || '';

                if (!title) continue;
                results.push({ url: productLink.href, title, price, moq, supplier });
            }
            return results;
        });

        console.log(`[Sourcing] Alibaba search returned ${products.length} products`);
        if (products.length === 0) return [];

        // Score & sort by keyword match
        const kw = (product.search_keywords_en || product.product_name_en || '').toLowerCase();
        const kwParts = kw.split(/\s+/).filter(w => w.length > 2);
        const scored = products.map(p => ({
            ...p,
            score: kwParts.filter(w => p.title.toLowerCase().includes(w)).length,
        })).sort((a, b) => b.score - a.score);

        // Visit top 5 product pages for detailed specs
        const topProducts = scored.slice(0, 5);
        const suppliers = [];

        for (const prod of topProducts) {
            try {
                await page.goto(prod.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForTimeout(2000);

                const specs = await page.evaluate(() => {
                    const data = {
                        weight: '', dimensions: '', material: '',
                        supplierName: '', supplierCountry: '',
                        supplierYears: '', supplierRating: '',
                        moqDetail: '', priceDetail: '', leadTime: '',
                        certifications: '', productUrl: window.location.href,
                    };

                    // Supplier name
                    const supplierSelectors = [
                        '.company-name', '[class*="company-name"]',
                        '.supplier-name', '[class*="supplier-name"]',
                        'a[href*=".en.alibaba.com"]',
                    ];
                    for (const sel of supplierSelectors) {
                        const el = document.querySelector(sel);
                        if (el?.textContent?.trim()) { data.supplierName = el.textContent.trim(); break; }
                    }

                    // Supplier years badge
                    const yearsBadge = document.querySelector('[class*="year"], [class*="Year"]');
                    if (yearsBadge) data.supplierYears = yearsBadge.textContent.trim();

                    const allText = document.body.innerText || '';

                    // Weight — expanded patterns
                    const weightPatterns = [
                        /(?:gross\s+)?weight[:\s]+([0-9.]+\s*(?:kg|g|lbs?|oz|KG|G)[^\n,;]*)/i,
                        /(?:net\s+)?weight[:\s]+([0-9.]+\s*(?:kg|g|lbs?|oz|KG|G)[^\n,;]*)/i,
                        /weight[^:]*:\s*([0-9.]+\s*(?:kg|g|lbs?|oz)[^\n]{0,30})/i,
                        /([0-9.]+\s*(?:kg|KG))\s*(?:\/\s*(?:pc|piece|pcs|pair|set))/i,
                        /(\d+(?:\.\d+)?)\s*grams?\b/i,
                    ];
                    for (const re of weightPatterns) {
                        const m = allText.match(re);
                        if (m) { data.weight = m[1].trim().slice(0, 50); break; }
                    }

                    // Material
                    const materialPatterns = [
                        /material[:\s]+([^\n,;]{3,60})/i,
                        /fabric[:\s]+([^\n,;]{3,60})/i,
                        /(?:made\s+(?:of|from))[:\s]+([^\n,;]{3,60})/i,
                    ];
                    for (const re of materialPatterns) {
                        const m = allText.match(re);
                        if (m) { data.material = m[1].trim().slice(0, 60); break; }
                    }

                    // Dimensions / CBM
                    const dimPatterns = [
                        /(?:dimension|size|package\s+size)[:\s]+([^\n]{5,80})/i,
                        /(\d+)\s*[x×]\s*(\d+)\s*[x×]\s*(\d+)\s*(?:cm|mm|m)\b/i,
                        /CBM[:\s]+([0-9.]+)/i,
                        /cubic\s+meter[:\s]+([0-9.]+)/i,
                    ];
                    for (const re of dimPatterns) {
                        const m = allText.match(re);
                        if (m) { data.dimensions = m[0].trim().slice(0, 80); break; }
                    }

                    // Lead time
                    const leadTimePatterns = [
                        /lead\s*time[:\s]+([^\n,;]{3,60})/i,
                        /delivery[:\s]+(\d+[-–]\d+\s*days?)/i,
                        /shipping[:\s]+(\d+[-–]\d+\s*(?:days?|business\s*days?))/i,
                        /(\d+[-–]\d+\s*days?)\s*(?:after\s+(?:payment|order))/i,
                    ];
                    for (const re of leadTimePatterns) {
                        const m = allText.match(re);
                        if (m) { data.leadTime = m[1].trim().slice(0, 60); break; }
                    }

                    // Certifications
                    const certPatterns = [
                        /certif(?:ication|icate)[s]?[:\s]+([^\n]{3,100})/i,
                        /(ISO\s*\d+|CE|FDA|SGS|BSCI|RoHS|REACH|GMP|LFGB|EN\s*\d+)/gi,
                    ];
                    for (const re of certPatterns) {
                        const m = allText.match(re);
                        if (m) { data.certifications = (Array.isArray(m) ? m.join(', ') : m[1]).trim().slice(0, 100); break; }
                    }

                    // Spec table extraction
                    const rows = document.querySelectorAll('table tr, [class*="spec"] [class*="item"], [class*="attribute"] [class*="item"]');
                    for (const row of rows) {
                        const text = row.textContent?.toLowerCase() || '';
                        const getVal = () => {
                            const cells = row.querySelectorAll('td, [class*="value"], span');
                            for (const cell of cells) {
                                const v = cell.textContent?.trim();
                                if (v && v.length > 1 && v.length < 80) return v;
                            }
                            return '';
                        };
                        if (!data.weight && text.includes('weight')) {
                            const v = getVal();
                            if (/[0-9]/.test(v) && /kg|g|lb|oz/i.test(v)) data.weight = v.slice(0, 50);
                        }
                        if (!data.material && (text.includes('material') || text.includes('fabric'))) {
                            data.material = getVal().slice(0, 60);
                        }
                        if (!data.dimensions && (text.includes('dimension') || text.includes('size') || text.includes('cbm'))) {
                            data.dimensions = getVal().slice(0, 80);
                        }
                        if (!data.leadTime && (text.includes('lead time') || text.includes('delivery'))) {
                            data.leadTime = getVal().slice(0, 60);
                        }
                    }

                    // MOQ + Price
                    const moqPatterns = [
                        /min\.?\s*order[^:]*:\s*([0-9,]+\s*(?:pieces?|pairs?|pcs?|sets?|units?)[^\n,;]*)/i,
                        /minimum\s+order[^:]*:\s*([0-9,]+[^\n,;]{0,30})/i,
                    ];
                    for (const re of moqPatterns) {
                        const m = allText.match(re);
                        if (m) { data.moqDetail = m[1].trim().slice(0, 50); break; }
                    }

                    const priceMatch = allText.match(/\$\s*([0-9.]+)\s*[-–]\s*\$?\s*([0-9.]+)/);
                    if (priceMatch) data.priceDetail = `$${priceMatch[1]} - $${priceMatch[2]}`;

                    return data;
                });

                suppliers.push({
                    title: prod.title,
                    supplier: specs.supplierName || prod.supplier,
                    supplierYears: specs.supplierYears,
                    supplierRating: specs.supplierRating,
                    price: specs.priceDetail || prod.price,
                    moq: specs.moqDetail || prod.moq,
                    weight: specs.weight,
                    material: specs.material,
                    dimensions: specs.dimensions,
                    leadTime: specs.leadTime,
                    certifications: specs.certifications,
                    url: specs.productUrl || prod.url,
                    platform: 'alibaba',
                    searchScore: prod.score,
                });

                console.log(`[Sourcing] ✅ Supplier ${suppliers.length}: "${specs.supplierName || prod.supplier}" weight="${specs.weight}" material="${specs.material}"`);
            } catch (err) {
                console.log(`[Sourcing] ⚠️ Failed to scrape product page: ${err.message}`);
            }
        }

        return suppliers;

    } catch (err) {
        console.error('[Sourcing] Alibaba scrape error:', err.message);
        return [];
    } finally {
        if (browser) await browser.close().catch(() => { });
    }
}

// ─── Step 2b: 1688 via Google search redirect ─────────────────────────────────
async function search1688ViaGoogle(product) {
    let browser;
    try {
        const { chromium } = require('playwright-extra');
        const StealthPlugin = require('puppeteer-extra-plugin-stealth');
        chromium.use(StealthPlugin());

        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        });

        const context = await browser.newContext({
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            locale: 'zh-CN',
        });
        const page = await context.newPage();
        await page.setDefaultTimeout(25000);

        const kwCn = product.search_keywords_cn || product.product_name_cn || '';
        if (!kwCn) return [];

        // Google search for 1688 detail pages
        const googleUrl = `https://www.google.com/search?q=site:detail.1688.com+${encodeURIComponent(kwCn)}&num=8`;
        console.log(`[Sourcing] 1688 Google search: "${kwCn}"`);

        await page.goto(googleUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
        await page.waitForTimeout(2000);

        // Extract 1688 URLs from Google results
        const urls = await page.evaluate(() => {
            const links = [...document.querySelectorAll('a[href*="detail.1688.com"]')];
            const results = [];
            const seen = new Set();
            for (const a of links) {
                let href = a.href;
                // Google wraps links in redirect — extract actual URL
                const match = href.match(/url\?q=([^&]+)/);
                if (match) href = decodeURIComponent(match[1]);
                if (!href.includes('detail.1688.com') || seen.has(href)) continue;
                seen.add(href);
                const title = a.querySelector('h3')?.textContent?.trim() || a.textContent?.trim()?.slice(0, 100) || '';
                results.push({ url: href, title });
            }
            return results.slice(0, 5);
        });

        console.log(`[Sourcing] 1688 Google found ${urls.length} detail pages`);
        if (urls.length === 0) return [];

        // Visit top 3 detail pages
        const suppliers = [];
        for (const item of urls.slice(0, 3)) {
            try {
                await page.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 25000 });
                await page.waitForTimeout(2500);

                const specs = await page.evaluate(() => {
                    const data = {
                        supplierName: '', weight: '', material: '', dimensions: '',
                        moq: '', price: '', leadTime: '', productUrl: window.location.href,
                    };

                    const allText = document.body.innerText || '';

                    // Supplier name — 1688 specific
                    const shopSelectors = [
                        '.shop-name', '[class*="shop-name"]',
                        '.company-name', '[class*="company-name"]',
                        '.supplier-name',
                    ];
                    for (const sel of shopSelectors) {
                        const el = document.querySelector(sel);
                        if (el?.textContent?.trim()) { data.supplierName = el.textContent.trim(); break; }
                    }

                    // Weight (Chinese patterns)
                    const weightPatterns = [
                        /(?:重量|净重|毛重)[：:]\s*([0-9.]+\s*(?:kg|g|千克|克)[^\n]*)/i,
                        /(?:weight)[：:]\s*([0-9.]+\s*(?:kg|g)[^\n]*)/i,
                        /([0-9.]+)\s*(?:kg|千克|公斤)\s*(?:\/\s*(?:个|件|双|套|对))/i,
                    ];
                    for (const re of weightPatterns) {
                        const m = allText.match(re);
                        if (m) { data.weight = m[1]?.trim().slice(0, 50) || m[0].slice(0, 50); break; }
                    }

                    // Material (Chinese)
                    const matPatterns = [
                        /(?:材质|材料|面料)[：:]\s*([^\n]{3,60})/,
                        /material[：:]\s*([^\n]{3,60})/i,
                    ];
                    for (const re of matPatterns) {
                        const m = allText.match(re);
                        if (m) { data.material = m[1].trim().slice(0, 60); break; }
                    }

                    // Dimensions
                    const dimPatterns = [
                        /(?:尺寸|规格|包装尺寸)[：:]\s*([^\n]{5,80})/,
                        /(\d+)\s*[x×*]\s*(\d+)\s*[x×*]\s*(\d+)\s*(?:cm|mm)/i,
                    ];
                    for (const re of dimPatterns) {
                        const m = allText.match(re);
                        if (m) { data.dimensions = (m[1] || m[0]).trim().slice(0, 80); break; }
                    }

                    // MOQ (Chinese)
                    const moqPatterns = [
                        /(?:起订量|最小起订|起批量|最低起订)[：:]\s*([0-9,]+\s*(?:件|个|双|套|对|箱)?[^\n]*)/,
                        /(\d+)\s*(?:件|个|双)起/,
                    ];
                    for (const re of moqPatterns) {
                        const m = allText.match(re);
                        if (m) { data.moq = m[1]?.trim().slice(0, 50) || m[0].slice(0, 50); break; }
                    }

                    // Price — ¥ or 元
                    const priceMatch = allText.match(/[¥￥]\s*([0-9.]+)\s*[-–~]\s*[¥￥]?\s*([0-9.]+)/);
                    if (priceMatch) data.price = `¥${priceMatch[1]} - ¥${priceMatch[2]}`;
                    else {
                        const singlePrice = allText.match(/[¥￥]\s*([0-9.]+)/);
                        if (singlePrice) data.price = `¥${singlePrice[1]}`;
                    }

                    // Lead time
                    const ltMatch = allText.match(/(?:发货|交期|交货)[：:]\s*([^\n]{3,40})/);
                    if (ltMatch) data.leadTime = ltMatch[1].trim().slice(0, 40);

                    return data;
                });

                // Extract offer ID from URL
                const offerIdMatch = item.url.match(/offer\/(\d+)/) || item.url.match(/(\d{10,20})/);
                const offerId = offerIdMatch ? offerIdMatch[1] : '';

                suppliers.push({
                    title: item.title,
                    supplier: specs.supplierName,
                    price: specs.price,
                    moq: specs.moq,
                    weight: specs.weight,
                    material: specs.material,
                    dimensions: specs.dimensions,
                    leadTime: specs.leadTime,
                    certifications: '',
                    url: specs.productUrl || item.url,
                    offerId,
                    platform: '1688',
                    searchScore: 0,
                });

                console.log(`[Sourcing] ✅ 1688 supplier: "${specs.supplierName}" weight="${specs.weight}" price="${specs.price}"`);
            } catch (err) {
                console.log(`[Sourcing] ⚠️ 1688 page scrape failed: ${err.message}`);
            }
        }

        return suppliers;

    } catch (err) {
        console.error('[Sourcing] 1688 Google search error:', err.message);
        return [];
    } finally {
        if (browser) await browser.close().catch(() => { });
    }
}

// ─── Step 3: Enrich + Format multi-supplier JSON ──────────────────────────────
async function buildFinalResult(product, allSuppliers) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

    const kw1688 = encodeURIComponent(product.search_keywords_cn || product.product_name_cn || '');
    const kwAlibaba = encodeURIComponent(product.search_keywords_en || product.product_name_en || '');
    const searchUrl1688 = `https://s.1688.com/selloffer/offerlist.htm?keywords=${kw1688}`;
    const searchUrlAlibaba = `https://www.alibaba.com/trade/search?SearchText=${kwAlibaba}`;

    const suppliersData = allSuppliers.length > 0
        ? allSuppliers.map((s, i) => `
Supplier ${i + 1} [${s.platform}]:
  - Tên: ${s.supplier || 'N/A'}
  - Sản phẩm: ${s.title || 'N/A'}
  - Giá: ${s.price || 'N/A'}
  - MOQ: ${s.moq || 'N/A'}
  - Cân nặng: ${s.weight || 'chưa tìm được'}
  - Chất liệu: ${s.material || 'N/A'}
  - Kích thước: ${s.dimensions || 'N/A'}
  - Lead time: ${s.leadTime || 'N/A'}
  - Chứng nhận: ${s.certifications || 'N/A'}
  - URL: ${s.url}
`).join('\n')
        : 'Không scrape được — dùng kiến thức chuyên ngành để ước tính.';

    const prompt = `Bạn là chuyên gia sourcing hàng Trung Quốc cho công ty logistics THG.

Sản phẩm: ${product.product_name_vn} (EN: ${product.product_name_en}, CN: ${product.product_name_cn})
Đặc điểm: ${product.key_features}
Cân nặng ước tính: ${product.estimated_weight_kg || 'N/A'}

=== DỮ LIỆU SCRAPE THẬT ===
${suppliersData}

Dựa trên dữ liệu trên, tạo profile cho TẤT CẢ suppliers tìm được (tối đa 5).
- Nếu weight chưa có → ước tính chính xác dựa trên loại sản phẩm
- Nếu material chưa có → ước tính dựa trên loại sản phẩm  
- Nếu không có supplier nào → tạo 1 profile ước tính

Trả về JSON ARRAY, mỗi phần tử:
{
  "rank": 1,
  "offer_id": "ID từ URL hoặc rỗng",
  "factory_name_cn": "Tên nhà cung cấp/xưởng",
  "factory_name_vn": "Dịch nghĩa hoặc mô tả",
  "direct_url": "URL sản phẩm",
  "search_url": "${searchUrl1688}",
  "platform": "alibaba hoặc 1688",
  "trust_score": 0-100,
  "match_reason": "Lý do chọn supplier này",
  "logistics": {
    "weight": "Cân nặng (bắt buộc — vd: 0.8 kg/đôi)",
    "cbm": "CBM ước tính cho 100 units (vd: 0.5 m³) hoặc kích thước đóng gói",
    "material": "Chất liệu chính",
    "min_order": "MOQ",
    "price_range": "Giá",
    "lead_time": "Thời gian giao hàng (vd: 7-15 ngày)",
    "certifications": "Chứng nhận nếu có"
  },
  "supplier_info": {
    "years_in_business": "Số năm hoạt động",
    "rating": "Rating nếu có"
  }
}

Kèm thêm 1 object cuối cùng trong array (không đếm vào supplier) với key "negotiation":
{
  "negotiation": true,
  "script_cn": "你好，我想批量采购${product.product_name_cn}...",
  "script_vn": "Xin chào, tôi muốn đặt hàng sỉ ${product.product_name_vn}...",
  "qc_checklist": ["Xác nhận cân nặng thực tế", "Kiểm tra chất liệu", "Đối chiếu kích thước", "Kiểm tra đóng gói"]
}

CHỈ TRẢ JSON ARRAY.`;

    const result = await model.generateContent([{ text: prompt }]);
    const parsed = parseJson(result.response.text());

    // Ensure it's an array
    const arr = Array.isArray(parsed) ? parsed : [parsed];

    // Ensure search_url is set on all supplier entries
    arr.forEach(item => {
        if (item.negotiation) return;
        if (!item.search_url) item.search_url = searchUrl1688;
        if (!item.direct_url && item.url) item.direct_url = item.url;
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

    // Step 2: Scrape suppliers from multiple sources (parallel)
    console.log('[Sourcing] 🔍 Step 2: Scraping Alibaba + 1688...');
    const [alibabaSuppliers, suppliers1688] = await Promise.allSettled([
        scrapeAlibaba(product),
        search1688ViaGoogle(product),
    ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : []));

    const allSuppliers = [...alibabaSuppliers, ...suppliers1688];
    console.log(`[Sourcing] ✅ Step 2: ${alibabaSuppliers.length} Alibaba + ${suppliers1688.length} 1688 = ${allSuppliers.length} total`);

    // Step 3: Enrich & format
    const enrichedArray = await buildFinalResult(product, allSuppliers);

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
