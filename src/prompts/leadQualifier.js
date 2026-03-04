const Groq = require('groq-sdk');
const config = require('../config');

const groq = new Groq({ apiKey: config.GROQ_API_KEY });

let geminiModel = null;
try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    if (config.GEMINI_API_KEY) {
        const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
        geminiModel = genAI.getGenerativeModel({ model: config.GEMINI_MODEL || 'gemini-2.0-flash' });
        console.log('[Classifier] ✅ Gemini AI fallback loaded');
    }
} catch (e) { }

const AI_MODELS = [
    config.AI_MODEL || 'llama-3.3-70b-versatile',
    'meta-llama/llama-4-scout-17b-16e-instruct',
    'llama-3.1-8b-instant',
    'qwen-qwq-32b',
];

// ═══════════════════════════════════════════════════════
// FIX 1: Thêm SCORING RUBRIC rõ ràng vào system prompt
// Trước đây chỉ nói "0-100" — model không biết 80 nghĩa là gì
// ═══════════════════════════════════════════════════════
const SYSTEM_PROMPT = `Bạn là Kỹ sư Data E-commerce làm việc cho THG Logistics. Nhiệm vụ của bạn là đọc bài đăng mạng xã hội và lọc ra CHÍNH XÁC những Seller/Doanh nghiệp đang CÓ NHU CẦU TÌM KIẾM dịch vụ hậu cần (Người mua).

${config.THG_CONTEXT}

🚨 QUY TẮC SỐNG CÒN (LOẠI BỎ FALSE POSITIVE):
1. NẾU bài viết mang tính chất QUẢNG CÁO, CHÀO MỜI dịch vụ từ các công ty vận chuyển, xưởng in, kho bãi khác -> "author_role": "logistics_agency", "intent": "offering_service", "is_potential": false.
2. NẾU bài viết chỉ chia sẻ kiến thức, khoe đơn, không hỏi tìm đối tác -> "is_potential": false.
3. CHỈ chọn "is_potential": true khi TÁC GIẢ là người ĐANG TÌM KIẾM giải pháp hoặc ĐANG HỎI/CẦN GIÚP ĐỠ.
4. ĐẶC THÙ TIKTOK COMMENT: Nếu nội dung rất ngắn như "xin giá", "check ib", "đi line us bao lâu", "có kho PA không" => "is_potential": true, đây là tín hiệu mua hàng rõ ràng.
5. ĐẶC THÙ REDDIT: Nếu phàn nàn về nhà cung cấp cũ ("My current supplier is too slow") => "is_potential": true.

🎯 PHÂN LOẠI DỊCH VỤ THG (Nếu is_potential = true):
- "THG Fulfillment": POD/Dropship chưa có hàng, cần xưởng in/mua hộ và ship.
- "THG Express": Có sẵn hàng ở VN/CN, cần book chuyến ship đi US/CA nhanh.
- "THG Warehouse": Cần thuê kho tại Mỹ để stock hàng và ship nội địa.
- "None": Không khớp hoặc là bài quảng cáo.

📊 THANG ĐIỂM SCORE (0-100) — ĐỌC KỸ PHẦN NÀY:

score 85-100 = Buyer rõ ràng, có urgency cao, nêu rõ nhu cầu cụ thể, sẵn sàng mua ngay
  Ví dụ: "Có 2 tạ hàng cần ship sang Mỹ trong tuần, ai nhận inbox"
  Ví dụ: "Mình đang muốn bắt đầu POD trên TikTok Shop US mà chưa chọn được xưởng nào"
  Ví dụ: "Cần tìm 3PL kho US gấp, đang bị Amazon penalty vì giao chậm"

score 65-84 = Buyer có nhu cầu, đang research, chưa quá gấp
  Ví dụ: "Ai dùng dịch vụ fulfill nào ổn không, mình đang so sánh giá"
  Ví dụ: "Bắt đầu bán TikTok US, cần tư vấn về shipping"
  Ví dụ: "Recommend đơn vị ship VN→Mỹ giá tốt"

score 40-64 = Có thể là buyer nhưng không chắc chắn, cần xác nhận thêm
  Ví dụ: "Ai có kinh nghiệm POD không" (hỏi chung, chưa rõ cần dịch vụ hay chỉ hỏi)
  Ví dụ: "TikTok Shop US khó không mọi người" (hỏi chung)

score 0-39 = Không phải buyer HOẶC không liên quan
  Ví dụ: Bài quảng cáo, chia sẻ kiến thức, không liên quan logistics

⚠️ QUY TẮC BẮT BUỘC VỀ SCORE:
- Nếu is_potential = true → score PHẢI >= 60. Không có ngoại lệ.
- Nếu is_potential = false → score PHẢI = 0. Không có ngoại lệ.
- Đừng cho score 8, 15, 20 cho buyer — nếu là buyer thật thì tối thiểu 60.

📝 VÍ DỤ MẪU (FEW-SHOT):
- Input: "Bên mình có kho CA nhận xử lý FBM, giá rẻ."
  => {"author_role":"logistics_agency","intent":"offering_service","is_potential":false,"score":0,"service_match":"None","reasoning":"Đối thủ quảng cáo kho","urgency":"low"}

- Input: "Mới tập tành làm POD, anh em cho hỏi app nào in áo thun rẻ ship US ổn ạ?"
  => {"author_role":"seller_ecom","intent":"seeking_service","is_potential":true,"score":75,"service_match":"THG Fulfillment","reasoning":"Seller mới đang tìm đơn vị POD, nhu cầu rõ ràng","urgency":"medium"}

- Input: "Mình đang muốn bắt đầu POD trên TikTok Shop US mà chưa chọn được xưởng fulfill nào"
  => {"author_role":"seller_ecom","intent":"seeking_service","is_potential":true,"score":88,"service_match":"THG Fulfillment","reasoning":"Buyer rõ ràng, đang tích cực tìm xưởng POD cho TikTok US, urgency cao","urgency":"high"}

- Input: "Có 2 tạ hàng ở Tân Bình, cần đi air sang Mỹ trong tuần, ai nhận inbox."
  => {"author_role":"seller_ecom","intent":"seeking_service","is_potential":true,"score":95,"service_match":"THG Express","reasoning":"Buyer có hàng sẵn, cần ship gấp trong tuần, urgency rất cao","urgency":"high"}

- Input (TikTok Comment): "bên m nhận đi hàng lẻ từ kho tân bình ko ad?"
  => {"author_role":"seller_ecom","intent":"seeking_service","is_potential":true,"score":80,"service_match":"THG Express","reasoning":"Comment ngắn nhưng rõ ràng hỏi dịch vụ vận chuyển hàng có sẵn","urgency":"medium"}

Trả về DUY NHẤT JSON được yêu cầu, không kèm text nào khác.`;

const USER_PROMPT_TEMPLATE = `Phân tích bài đăng/comment sau:

Platform: {platform}
Nội dung: {content}

Trả về JSON (object đơn, không phải array):
{
  "author_role": "seller_ecom" | "logistics_agency" | "spammer" | "unknown",
  "intent": "seeking_service" | "offering_service" | "sharing_knowledge" | "other",
  "is_potential": boolean,
  "score": number (NẾU is_potential=true thì PHẢI >= 60, NẾU false thì = 0),
  "service_match": "THG Fulfillment" | "THG Express" | "THG Warehouse" | "None",
  "reasoning": "Giải thích ngắn gọn",
  "urgency": "low" | "medium" | "high"
}`;

const PROVIDER_REGEX = /(chúng tôi nhận gửi|quy trình gửi hàng|lợi ích khi gửi hàng với chúng tôi|nhận gửi hàng đi|chuyên tuyến việt|cước phí cạnh tranh|cam kết giao tận tay|hỗ trợ tư vấn, chăm sóc khách hàng 24\/7|we offer fulfillment|shipping services from us|dịch vụ vận chuyển uy tín|không phát sinh chi phí|bao thuế bao luật|nhận pick up|đóng gói miễn phí|hút chân không|lh em ngay|lh em|liên hệ em|ib em ngay|ib em|inbox em|cmt em|chấm em|check ib|check inbox|dạ em nhận|em chuyên nhận|gửi hàng đi mỹ inbox|nhận vận chuyển|zalo: 0)/i;
const IRRELEVANT_REGEX = /(recipe|cooking|football|soccer|gaming|movie|trailer|music video|crypto airdrop|token launch|weight loss|diet pill)/i;

let currentModelIndex = 0;
let consecutiveErrors = 0;

// ═══════════════════════════════════════════════════════
// FIX 2: Batch dùng text parsing thay vì json_object
// response_format: json_object không cho phép trả array
// → model wrap vào object → Object.values() parse sai thứ tự
// ═══════════════════════════════════════════════════════
async function classifyBatch(posts) {
    const postsList = posts.map((p, i) =>
        `[POST ${i + 1}] Platform: ${p.platform}\nContent: ${(p.content || '').substring(0, 600)}`
    ).join('\n\n---\n\n');

    const batchUserPrompt = `Phân tích ${posts.length} bài đăng dưới đây. 

${postsList}

Trả về JSON object với key "results" là array ${posts.length} phần tử, theo đúng thứ tự POST 1, 2, 3...:
{
  "results": [
    {"author_role":"...","intent":"...","is_potential":bool,"score":number,"service_match":"...","reasoning":"...","urgency":"..."},
    ...
  ]
}

Nhớ: is_potential=true → score PHẢI >= 60. is_potential=false → score = 0.`;

    for (let i = currentModelIndex; i < AI_MODELS.length; i++) {
        try {
            const model = AI_MODELS[i];
            const response = await groq.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: batchUserPrompt },
                ],
                temperature: 0.1,
                max_tokens: 500 * posts.length,
                // FIX: KHÔNG dùng response_format: json_object cho batch
                // vì nó ngăn model trả về array trực tiếp
            });

            const text = response.choices[0].message.content;

            // FIX: Parse "results" key trực tiếp, fallback sang tìm array
            let arr;
            try {
                const parsed = JSON.parse(text);
                arr = parsed.results || parsed.items || parsed.data;
                if (!Array.isArray(arr)) {
                    arr = Object.values(parsed).find(v => Array.isArray(v));
                }
            } catch (e) {
                const match = text.match(/\[[\s\S]*\]/);
                if (match) arr = JSON.parse(match[0]);
            }

            if (!Array.isArray(arr) || arr.length === 0) {
                throw new Error('No valid array in response');
            }

            consecutiveErrors = 0;
            if (i !== currentModelIndex) {
                currentModelIndex = i;
                console.log(`[Classifier] 🔄 Switched to model: ${model}`);
            }

            return arr.map(result => parseResult(result));

        } catch (err) {
            const isLimit = err.message?.includes('429') || err.message?.includes('rate_limit');
            if (isLimit && i < AI_MODELS.length - 1) {
                console.warn(`[Classifier] ⚠️ ${AI_MODELS[i]} hết limit → thử ${AI_MODELS[i + 1]}...`);
                continue;
            }
            if (isLimit) {
                consecutiveErrors++;
                const geminiResults = await classifyBatchWithGemini(posts);
                if (geminiResults) return geminiResults;
            }
            console.warn(`[Classifier] ⚠️ Batch failed (${err.message}), falling back to individual`);
            const individual = [];
            for (const post of posts) {
                individual.push(await classifyPost(post));
            }
            return individual;
        }
    }
    return posts.map(() => makeFallback());
}

// ═══════════════════════════════════════════════════════
// FIX 3: parseResult có safety check — enforce score rules
// ═══════════════════════════════════════════════════════
function parseResult(result) {
    const role = result.author_role || 'unknown';
    const isProvider = role === 'logistics_agency' || role === 'spammer';
    const isPotential = result.is_potential === true && !isProvider;

    let score = Math.min(100, Math.max(0, result.score || 0));

    // FIX: Enforce scoring rules nếu model vẫn trả sai
    if (isPotential && score < 60) {
        console.warn(`[Classifier] ⚠️ Model trả score ${score} cho buyer — tự động bump lên 60`);
        score = 60;
    }
    if (!isPotential) score = 0;

    return {
        isLead: isPotential,
        role: isPotential ? 'buyer' : (isProvider ? 'provider' : 'irrelevant'),
        score,
        category: result.service_match === 'None' ? 'NotRelevant' : (result.service_match || 'General'),
        summary: result.reasoning || '',
        urgency: isPotential ? (result.urgency || 'low') : 'low',
        buyerSignals: isPotential ? (result.reasoning || '') : '',
    };
}

async function classifyPost(post) {
    if (PROVIDER_REGEX.test(post.content)) {
        return { isLead: false, role: 'provider', score: 0, category: 'NotRelevant', summary: 'Provider regex match', urgency: 'low', buyerSignals: '' };
    }

    const userPrompt = USER_PROMPT_TEMPLATE
        .replace('{platform}', post.platform)
        .replace('{content}', post.content.substring(0, 1500));

    for (let i = currentModelIndex; i < AI_MODELS.length; i++) {
        try {
            const model = AI_MODELS[i];
            const response = await groq.chat.completions.create({
                model,
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.1,
                max_tokens: 400,
                response_format: { type: 'json_object' }, // OK for single post
            });

            const result = JSON.parse(response.choices[0].message.content);
            consecutiveErrors = 0;
            if (i !== currentModelIndex) {
                currentModelIndex = i;
                console.log(`[Classifier] 🔄 Switched to model: ${model}`);
            }
            return parseResult(result);

        } catch (err) {
            const isLimit = err.message?.includes('429') || err.message?.includes('rate_limit');
            if (isLimit && i < AI_MODELS.length - 1) {
                console.warn(`[Classifier] ⚠️ ${AI_MODELS[i]} hết limit → thử ${AI_MODELS[i + 1]}...`);
                continue;
            }
            if (isLimit) {
                consecutiveErrors++;
                if (consecutiveErrors >= 5) return makeFallback();
                const waitSec = Math.min(30, 5 * consecutiveErrors);
                await new Promise(r => setTimeout(r, waitSec * 1000));
                i = 0;
                continue;
            }
            console.error('[Classifier] ✗ Error:', err.message);
            const geminiResult = await classifyWithGemini(post);
            return geminiResult || makeFallback();
        }
    }
    const geminiResult = await classifyWithGemini(post);
    return geminiResult || makeFallback();
}

async function classifyBatchWithGemini(posts) {
    if (!geminiModel) return null;
    try {
        const postsList = posts.map((p, i) =>
            `[POST ${i + 1}] Platform: ${p.platform}\nContent: ${(p.content || '').substring(0, 600)}`
        ).join('\n\n');
        const prompt = SYSTEM_PROMPT + `\n\nPhân tích ${posts.length} bài. Trả về {"results": [...]}:\n\n${postsList}`;
        const result = await geminiModel.generateContent(prompt);
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;
        const parsed = JSON.parse(jsonMatch[0]);
        const arr = parsed.results || Object.values(parsed).find(v => Array.isArray(v));
        if (!Array.isArray(arr)) return null;
        return arr.map(r => parseResult(r));
    } catch (err) {
        console.error('[Classifier] ❌ Gemini batch failed:', err.message);
        return null;
    }
}

async function classifyWithGemini(post) {
    if (!geminiModel) return null;
    try {
        const userPrompt = USER_PROMPT_TEMPLATE
            .replace('{platform}', post.platform)
            .replace('{content}', post.content.substring(0, 1500));
        const prompt = SYSTEM_PROMPT + '\n\n' + userPrompt;
        const result = await geminiModel.generateContent(prompt);
        const text = result.response.text();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) return null;
        return parseResult(JSON.parse(jsonMatch[0]));
    } catch (err) {
        console.error('[Classifier] ❌ Gemini failed:', err.message);
        return null;
    }
}

function makeFallback() {
    return { isLead: false, score: 0, category: 'NotRelevant', summary: 'Lỗi phân tích', urgency: 'low' };
}

const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function classifyPosts(posts) {
    console.log(`[Classifier] 🧠 Classifying ${posts.length} posts...`);
    console.log(`[Classifier] 🔄 Models: ${AI_MODELS.join(' → ')}`);

    const toClassify = [];
    const preFiltered = [];

    for (const post of posts) {
        const content = post.content || '';
        if (content.length < 10) {
            preFiltered.push({ ...post, ...makeFallback(), summary: 'Nội dung quá ngắn' });
            continue;
        }
        if (PROVIDER_REGEX.test(content)) {
            preFiltered.push({ ...post, isLead: false, role: 'provider', score: 0, category: 'NotRelevant', summary: 'Provider regex', urgency: 'low', buyerSignals: '' });
            continue;
        }
        if (IRRELEVANT_REGEX.test(content)) {
            preFiltered.push({ ...post, ...makeFallback(), summary: 'Không liên quan' });
            continue;
        }
        toClassify.push(post);
    }

    console.log(`[Classifier] 🔍 Pre-filter: ${preFiltered.length} posts skipped locally, ${toClassify.length} posts → AI`);

    const BATCH_SIZE = 5;
    const results = [...preFiltered];
    currentModelIndex = 0;
    consecutiveErrors = 0;
    let stopEarly = false;

    for (let i = 0; i < toClassify.length && !stopEarly; i += BATCH_SIZE) {
        const batch = toClassify.slice(i, i + BATCH_SIZE);
        try {
            const batchResults = await classifyBatch(batch);
            if (consecutiveErrors >= 5) stopEarly = true;
            for (let j = 0; j < batch.length; j++) {
                results.push({ ...batch[j], ...(batchResults[j] || makeFallback()) });
            }
        } catch (err) {
            for (const post of batch) results.push({ ...post, ...makeFallback() });
        }

        const done = Math.min(i + BATCH_SIZE, toClassify.length);
        console.log(`[Classifier]   → ${done}/${toClassify.length} classified (batch ${Math.ceil(done / BATCH_SIZE)}/${Math.ceil(toClassify.length / BATCH_SIZE)}, model: ${AI_MODELS[currentModelIndex]})`);

        if (i + BATCH_SIZE < toClassify.length && !stopEarly) await delay(1000);
    }

    if (stopEarly) {
        const classifiedCount = results.length - preFiltered.length;
        for (const post of toClassify.slice(classifiedCount)) {
            results.push({ ...post, ...makeFallback() });
        }
    }

    const leads = results.filter(r => r.isLead && r.score >= config.LEAD_SCORE_THRESHOLD);
    console.log(`[Classifier] ✅ Done! ${leads.length} qualified leads (score ≥ ${config.LEAD_SCORE_THRESHOLD}) out of ${posts.length} total posts`);
    console.log(`[Classifier]    📊 Breakdown: ${preFiltered.length} pre-filtered, ${toClassify.length} sent to AI`);

    const buyerPosts = results.filter(r => r.role === 'buyer');
    if (buyerPosts.length > 0) {
        console.log(`[Classifier] 🎯 Buyer posts found: ${buyerPosts.length}`);
        buyerPosts.forEach(p => {
            const tag = p.score >= config.LEAD_SCORE_THRESHOLD ? '✅' : '⚠️';
            console.log(`[Classifier]   ${tag} Score ${p.score} | ${(p.content || '').substring(0, 80)}`);
        });
    }

    return results;
}

module.exports = { classifyPost, classifyPosts };
