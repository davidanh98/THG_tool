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

// ─── Step 2: Playwright stealth scrape 1688 search ───────────────────────────
async function scrape1688(keywords) {
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
            locale: 'zh-CN',
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
        });
        const page = await context.newPage();

        const searchUrl = `https://s.1688.com/selloffer/offerlist.htm?keywords=${encodeURIComponent(keywords)}`;
        console.log(`[Sourcing] Scraping: ${searchUrl}`);

        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(2500);

        const offers = await page.evaluate(() => {
            const results = [];
            const seen = new Set();

            // Lấy tất cả link có offer ID thực
            const allLinks = document.querySelectorAll('a[href*="detail.1688.com/offer/"]');

            for (const link of allLinks) {
                const m = (link.href || '').match(/detail\.1688\.com\/offer\/(\d{8,15})\.html/);
                if (!m || seen.has(m[1])) continue;
                seen.add(m[1]);

                const offerId = m[1];
                // Leo lên container cha gần nhất
                const card = link.closest('li, article, div[class*="item"], div[class*="offer"], div[class*="card"]');

                const title = card?.querySelector('[class*="subject"], [class*="title"]')?.textContent?.trim()
                    || link.title || link.textContent?.trim() || '';
                const company = card?.querySelector('[class*="company"]')?.textContent?.trim() || '';
                const price = card?.querySelector('[class*="price"]')?.textContent?.trim() || '';
                const moq = card?.querySelector('[class*="moq"], [class*="amount"], [class*="quantity"]')?.textContent?.trim() || '';

                results.push({ offer_id: offerId, title, company, price, moq, url: `https://detail.1688.com/offer/${offerId}.html` });
                if (results.length >= 6) break;
            }
            return results;
        });

        console.log(`[Sourcing] 1688 returned ${offers.length} offers`);
        return offers;

    } catch (err) {
        console.error('[Sourcing] 1688 scrape error:', err.message);
        return [];
    } finally {
        if (browser) await browser.close().catch(() => {});
    }
}

// ─── Step 3: Gemini chọn offer phù hợp + generate output ─────────────────────
async function pickBestSupplier(product, offers) {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

    const kw = encodeURIComponent(product.search_keywords_cn || product.product_name_cn || '');
    const searchUrl = `https://s.1688.com/selloffer/offerlist.htm?keywords=${kw}`;

    const offersText = offers.map((o, i) =>
        `[${i + 1}] offer_id=${o.offer_id} | title="${o.title}" | company="${o.company}" | price="${o.price}" | moq="${o.moq}"`
    ).join('\n');

    const prompt = `Bạn là chuyên gia sourcing hàng Trung Quốc.

Sản phẩm cần tìm:
- Tên: ${product.product_name_vn} (CN: ${product.product_name_cn})
- Đặc điểm: ${product.key_features}
- Danh mục: ${product.category}

Kết quả THỰC TẾ scrape từ 1688.com:
${offersText}

Chọn offer PHÙ HỢP NHẤT (ưu tiên: xưởng gốc, giá sỉ, MOQ thấp).
QUAN TRỌNG: offer_id PHẢI là một trong các ID trên, không được tự tạo.

Trả về JSON:
{
  "product_name": "${product.product_name_vn}",
  "verified_match": {
    "offer_id": "ID thực từ danh sách trên",
    "factory_name_cn": "tên xưởng/công ty tiếng Trung",
    "factory_name_vn": "dịch nghĩa tên xưởng",
    "direct_url": "https://detail.1688.com/offer/[ID].html",
    "search_url": "${searchUrl}",
    "platform": "1688",
    "trust_score": 80,
    "match_reason": "lý do chọn offer này"
  },
  "logistics": {
    "weight": "ước tính kg dựa trên loại sản phẩm",
    "min_order": "MOQ từ data",
    "price_range": "giá từ data"
  },
  "negotiation_script": {
    "cn": "kịch bản chat tiếng Trung để đặt hàng sỉ ${product.product_name_cn}",
    "vn": "dịch tiếng Việt kịch bản trên"
  },
  "qc_checklist": ["mục kiểm tra 1", "mục kiểm tra 2", "mục kiểm tra 3", "mục kiểm tra 4"]
}
Chỉ trả JSON.`;

    const result = await model.generateContent([{ text: prompt }]);
    const parsed = parseJson(result.response.text());

    // Verify offer_id là ID thực từ danh sách đã scrape
    const validIds = new Set(offers.map(o => o.offer_id));
    const vm = parsed.verified_match;
    if (vm?.offer_id && !validIds.has(vm.offer_id)) {
        const first = offers[0];
        vm.offer_id = first.offer_id;
        vm.direct_url = first.url;
        vm.factory_name_cn = first.company || vm.factory_name_cn;
        vm.trust_score = 60;
        vm.match_reason = `[Auto-corrected] ${vm.match_reason}`;
    }
    if (vm) {
        vm.search_url = searchUrl;
        vm.platform = 'taobao' in (vm.direct_url || '') ? 'taobao' : '1688';
    }

    return parsed;
}

// ─── Fallback khi 1688 không trả kết quả ─────────────────────────────────────
function buildFallback(product) {
    const kw = encodeURIComponent(product.search_keywords_cn || product.product_name_cn || '');
    return {
        product_name: product.product_name_vn || 'Sản phẩm',
        verified_match: {
            offer_id: '',
            factory_name_cn: '',
            factory_name_vn: 'Không tìm được xưởng trực tiếp',
            direct_url: '',
            search_url: `https://s.1688.com/selloffer/offerlist.htm?keywords=${kw}`,
            platform: '1688',
            trust_score: 0,
            match_reason: '1688 không trả kết quả — có thể do IP bị chặn hoặc sản phẩm quá custom. Dùng nút "Tìm trên 1688" để tìm thủ công.',
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

    // Step 2
    const keywords = product.search_keywords_cn || product.product_name_cn;
    const offers = await scrape1688(keywords);

    if (offers.length === 0) {
        console.log('[Sourcing] ⚠️ 1688 không có kết quả — fallback');
        return buildFallback(product);
    }

    // Step 3
    const result = await pickBestSupplier(product, offers);
    console.log(`[Sourcing] ✅ Done: ${result.verified_match?.factory_name_cn} (ID: ${result.verified_match?.offer_id})`);
    return result;
}

module.exports = { runSourcing };
