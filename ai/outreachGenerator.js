/**
 * 🎯 Outreach Generator — AI-Powered Personalized Messages for Leads
 * 
 * Generates highly personalized outreach messages for each lead:
 * - References the lead's SPECIFIC post content & pain point
 * - Matches the assigned sales staff's communication style
 * - Supports 3 tones: friendly / professional / urgent
 * - Auto-detects language (VN / EN)
 * 
 * Provider cascade: Ollama (free/unlimited) → Cerebras → Sambanova → Groq → Gemini
 * 
 * @module ai/outreachGenerator
 */
'use strict';

const OpenAI = require('openai');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const config = require('../backend/config');

// ─── Provider Clients ────────────────────────────────────────────────────────
let ollamaClient = null;
let cerebras = null;
let sambanova = null;
let groq = null;
let geminiModel = null;

try {
    // Ollama — self-hosted, FREE, no rate limit (primary)
    const OLLAMA_BASE_URL = config.OLLAMA_BASE_URL || 'http://127.0.0.1:11434';
    ollamaClient = new OpenAI({
        apiKey: 'ollama',
        baseURL: `${OLLAMA_BASE_URL}/v1`,
    });
    console.log(`[OutreachGen] ✅ Ollama loaded (primary — ${config.OLLAMA_MODEL || 'qwen2.5:3b'} @ ${OLLAMA_BASE_URL})`);
} catch (e) {
    console.warn(`[OutreachGen] ⚠️ Ollama not available: ${e.message}`);
}

try {
    if (config.CEREBRAS_API_KEY) {
        cerebras = new OpenAI({ apiKey: config.CEREBRAS_API_KEY, baseURL: 'https://api.cerebras.ai/v1' });
    }
    if (config.SAMBANOVA_API_KEY) {
        sambanova = new OpenAI({ apiKey: config.SAMBANOVA_API_KEY, baseURL: 'https://api.sambanova.ai/v1' });
    }
    if (config.GROQ_API_KEY) {
        groq = new Groq({ apiKey: config.GROQ_API_KEY });
    }
    if (config.GEMINI_API_KEY) {
        const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
        geminiModel = genAI.getGenerativeModel({ model: config.GEMINI_MODEL || 'gemini-2.0-flash' });
    }
} catch (e) {
    console.error(`[OutreachGen] ⚠️ Provider init error: ${e.message}`);
}

const OLLAMA_MODEL = config.OLLAMA_MODEL || 'qwen2.5:3b';

const PROVIDERS = [
    { name: 'Ollama', client: ollamaClient, model: OLLAMA_MODEL, type: 'openai', timeout: 90000 },
    { name: 'Cerebras', client: cerebras, model: 'llama3.3-70b', type: 'openai', timeout: 30000 },
    { name: 'Sambanova', client: sambanova, model: 'Meta-Llama-3.3-70B-Instruct', type: 'openai', timeout: 30000 },
    { name: 'Groq', client: groq, model: 'llama-3.1-8b-instant', type: 'groq', timeout: 30000 },
].filter(p => p.client);

console.log(`[OutreachGen] 🔄 Provider chain: ${PROVIDERS.map(p => p.name).join(' → ')}`);

// ─── THG Service Context ─────────────────────────────────────────────────────
// ─── Agent Profiles & Contact Info ─────────────────────────────────────────────
const AGENT_PROFILES = {
    'Đức Anh': 'Zalo: 0949716391\nTele: @hairypoter98',
    'Thu Nguyệt': 'Zalo: 0367689834\nTele: @Moonzzz03',
    'Khải Huyền': 'Zalo: 0965309416\nFacebook: https://www.facebook.com/hana.thgfulfill3979',
};

function getAgentContact(staffName) {
    return AGENT_PROFILES[staffName] || AGENT_PROFILES['Đức Anh'];
}

// ─── THG Service Context ─────────────────────────────────────────────────────
const THG_CONTEXT = `
THG Fulfill hỗ trợ in ấn – đóng gói – xử lý đơn POD/Dropship cho nhiều dòng sản phẩm hot như phonecase, sweater, ornament và các sản phẩm custom khác.
👉 Website chính thức: ${config.THG_WEBSITE || 'https://www.thgfulfill.com/'}
Hiện THG có:
✅ Basecost tốt, sản xuất trực tiếp US – dễ scale
✅ In nhanh, giao US chỉ 2–5 ngày
✅ Team hỗ trợ xử lý lỗi/khiếu nại
✅ Tracking realtime
✅ Hỗ trợ lưu kho miễn phí tại TQ & US
`.trim();

const THG_CONTEXT_EN = `
THG Fulfill supports printing, packaging, and processing POD/Dropship orders for hot products like phone cases, sweaters, ornaments, and custom products.
👉 Official Website: ${config.THG_WEBSITE || 'https://www.thgfulfill.com/'}
We offer:
✅ Great base cost, direct US production - easy to scale
✅ Fast printing, US delivery in just 2-5 days
✅ Dedicated support team for errors/complaints
✅ Real-time tracking
✅ Free warehousing in China & US
`.trim();

// ─── Prompt Builders ─────────────────────────────────────────────────────────

/**
 * Build outreach prompt for Vietnamese leads
 */
function buildPromptVN(lead, staffName, tone) {
    const toneGuide = {
        friendly: 'Thân thiện, gần gũi, dùng emoji vừa phải. Xưng "mình" hoặc tên staff.',
        professional: 'Chuyên nghiệp, lịch sự, ít emoji. Xưng "em" hoặc tên staff.',
        urgent: 'Khẩn trương nhưng không push bán. Nhấn mạnh thời gian là cơ hội.',
    };

    return `Bạn là ${staffName}, chuyên viên Sales của THG Fulfill. Một khách hàng sộp vừa đăng bài trong group Facebook:

━━━ BÀI POST CỦA KHÁCH ━━━
"${(lead.content || '').substring(0, 500)}"

━━━ HỒ SƠ TÂM LÝ & CHIẾN LƯỢC CHỐT SALE ━━━
• Tâm lý & Nỗi đau (Pain points): ${lead.buyer_signals || 'Chưa xác định'}
• Góc độ chốt Sale (Sales Angle): ${lead.summary || 'Chưa xác định'}

━━━ YÊU CẦU ━━━
Dựa TRỰC TIẾP vào "Hồ Sơ Tâm Lý" bên trên, hãy viết 1 tin nhắn tư vấn GÃI ĐÚNG CHỖ NGỨA của khách.

CẤU TRÚC BẮT BUỘC:
1. Mở đầu: Viết 1-2 câu ĐẦU TIÊN thật tự nhiên, ĐÁNH TRÚNG VÀO NỖI ĐAU của khách (không chào hỏi sáo rỗng kiểu bot).
2. Phần giữa: Trình bày form thông tin dịch vụ sau một cách tự nhiên (bạn có thể điều chỉnh văn phong cho hợp tâm lý khách, nhưng phải giữ nguyên ý chính):
${THG_CONTEXT}
3. Phần cuối: CTA kêu gọi hành động dựa theo Góc độ chốt Sale (Angle) phía trên.

GIỌNG VĂN: ${toneGuide[tone] || toneGuide.friendly}. Hãy tỏ ra là một Sale người thật cực kỳ nhanh nhạy.

BẮT BUỘC CHÈN NGUYÊN BẢN ĐOẠN CONTACT NÀY TẠI CUỐI TIN NHẮN (KHÔNG ĐƯỢC CHẾ THÊM HAY SỬA ĐỔI):
Nếu mình đang kinh doanh POD/Dropship, cứ liên hệ em để được hỗ trợ nhé!
${getAgentContact(staffName)}

CHỈ trả về nội dung tin nhắn hoàn chỉnh, tuyệt đối không có <think> hay giải thích.`;
}

/**
 * Build outreach prompt for English leads
 */
function buildPromptEN(lead, staffName, tone) {
    const toneGuide = {
        friendly: 'Friendly and approachable, use occasional emojis. Casual but professional.',
        professional: 'Professional and polished, minimal emojis. Business-appropriate.',
        urgent: 'Urgent but not pushy. Emphasize time-sensitive opportunity.',
    };

    return `You are ${staffName}, a Sales representative at THG Logistics. A potential customer just posted in a Facebook group:

━━━ CUSTOMER'S POST ━━━
"${(lead.content || '').substring(0, 500)}"

━━━ PSYCHOLOGICAL PROFILE & SALES STRATEGY ━━━
• Psychology & Pain points: ${lead.buyer_signals || 'Not determined'}
• Pitch Angle: ${lead.summary || 'Not determined'}

━━━ THG SERVICES ━━━
${THG_CONTEXT_EN}

━━━ REQUIREMENTS ━━━
Write a highly persuasive outreach message directly utilizing the Psychological Profile above.

Must:
1. OPEN by addressing the EXACT pain point mentioned in the profile.
2. Structure the pitch based on the "Pitch Angle" suggestion.
3. Subtly weave in the THG Services context as the perfect solution.
4. Tone: ${toneGuide[tone] || toneGuide.friendly}

DO NOT:
- Use generic greetings like "Hello dear" or "I saw your post".
- Copy-paste robotic templates.
- Be overly pushy if the customer profile indicates caution.

Return ONLY the message content, no explanations.`;
}

/**
 * Build a comment reply prompt (shorter, more casual)
 */
function buildCommentPrompt(lead, staffName, language) {
    if (language === 'vietnamese') {
        return `Bạn là ${staffName} (Sale tại THG Fulfill). Khách hàng vừa đăng bài:
"${(lead.content || '').substring(0, 300)}"

━━━ INSIGHT BẮT MẠCH ━━━
• Tâm lý & Vấn đề: ${lead.buyer_signals || ''}
• Gợi ý chốt: ${lead.summary || ''}

YÊU CẦU:
Viết 1 COMMENT REPLY (khoảng 3-4 câu) ĐÁNH TRÚNG TÂM LÝ khách hàng dựa trên "Insight Bắt Mạch" phía trên.
Đọc vị xem họ cần gì, bức xúc gì để Comment cho mượt mà (chứ không phải 1 cái bot spam).
Giới thiệu khéo léo dịch vụ THG Fulfill và kèm y chang contact của bạn ở dưới cùng:
Nếu mình đang kinh doanh POD/Dropship, cứ liên hệ em để được hỗ trợ nhé!
${getAgentContact(staffName)}

CHỈ trả về nội dung text của comment.`;
    }
    return `You are ${staffName} (Sales rep at THG Fulfill). Customer posted:
"${(lead.content || '').substring(0, 300)}"

━━━ INSIGHT PROFILE ━━━
• Psychology & Pain points: ${lead.buyer_signals || ''}
• Pitch Angle: ${lead.summary || ''}

Write a natural 3-4 sentence comment reply. Address their psychological state directly based on the insight profile, then casually pitch THG Fulfill's POD services.
Return ONLY the comment text.`;
}

// ─── AI Call with Provider Cascade ───────────────────────────────────────────

/**
 * Call an OpenAI-compatible provider
 */
async function callOpenAIProvider(client, model, prompt, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await client.chat.completions.create({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.7,
            max_tokens: 400,
        }, { signal: controller.signal });
        return response.choices[0].message.content.trim();
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Call Gemini as last resort
 */
async function callGemini(prompt) {
    if (!geminiModel) throw new Error('Gemini not configured');
    const result = await geminiModel.generateContent({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
    });
    return result.response.text().trim();
}

/**
 * Generate outreach message with provider cascade
 * @param {string} prompt - Full prompt
 * @returns {string} AI-generated message
 */
async function generateWithCascade(prompt) {
    // Try each provider in order (Ollama → Cerebras → Sambanova → Groq)
    for (const provider of PROVIDERS) {
        try {
            console.log(`[OutreachGen] 🔄 Trying ${provider.name}...`);
            const result = await callOpenAIProvider(provider.client, provider.model, prompt, provider.timeout || 15000);
            console.log(`[OutreachGen] ✅ ${provider.name} success`);
            return result;
        } catch (e) {
            console.warn(`[OutreachGen] ⚠️ ${provider.name} failed: ${e.message}`);
        }
    }

    // Last resort: Gemini
    try {
        console.log(`[OutreachGen] 🔄 Trying Gemini (last resort)...`);
        const result = await callGemini(prompt);
        console.log(`[OutreachGen] ✅ Gemini success`);
        return result;
    } catch (e) {
        console.error(`[OutreachGen] ❌ All providers failed: ${e.message}`);
        throw new Error('All AI providers failed');
    }
}

// ─── Smart Contextual Asset Selector ─────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const ASSETS_BASE = path.join(__dirname, '..', 'data', 'assets');
const IMAGES_BASE = path.join(ASSETS_BASE, 'images');
let _assetTags = null;

function loadAssetTags() {
    if (_assetTags) return _assetTags;
    try {
        _assetTags = JSON.parse(fs.readFileSync(path.join(ASSETS_BASE, 'asset_tags.json'), 'utf8'));
        return _assetTags;
    } catch { return { categories: {} }; }
}

/**
 * Pick the best matching asset image based on lead content
 * @param {object} lead - Lead object with content, buyer_signals, summary
 * @returns {string|null} Absolute path to image or null
 */
function getContextualAsset(lead = {}) {
    try {
        const tags = loadAssetTags();
        const text = [
            lead.content || '', lead.buyer_signals || '', lead.summary || ''
        ].join(' ').toLowerCase();

        // Score each category by keyword matches
        let bestCat = 'general';
        let bestScore = 0;
        for (const [cat, info] of Object.entries(tags.categories)) {
            if (!info.keywords || info.keywords.length === 0) continue;
            let score = 0;
            for (const kw of info.keywords) {
                if (text.includes(kw.toLowerCase())) score++;
            }
            if (score > bestScore) { bestScore = score; bestCat = cat; }
        }

        console.log(`[AssetPicker] 🎯 Category: ${bestCat} (score: ${bestScore})`);

        // Get images from the matched category folder
        const catDir = path.join(IMAGES_BASE, bestCat);
        if (!fs.existsSync(catDir)) {
            // Fallback to general
            const generalDir = path.join(IMAGES_BASE, 'general');
            if (!fs.existsSync(generalDir)) return null;
            const files = fs.readdirSync(generalDir).filter(f => f.match(/\.(jpg|jpeg|png|gif|webp)$/i));
            return files.length > 0 ? path.join(generalDir, files[Math.floor(Math.random() * files.length)]) : null;
        }

        const files = fs.readdirSync(catDir).filter(f => f.match(/\.(jpg|jpeg|png|gif|webp)$/i));
        if (files.length === 0) {
            // Fallback to general
            const generalDir = path.join(IMAGES_BASE, 'general');
            if (!fs.existsSync(generalDir)) return null;
            const gFiles = fs.readdirSync(generalDir).filter(f => f.match(/\.(jpg|jpeg|png|gif|webp)$/i));
            return gFiles.length > 0 ? path.join(generalDir, gFiles[Math.floor(Math.random() * gFiles.length)]) : null;
        }

        return path.join(catDir, files[Math.floor(Math.random() * files.length)]);
    } catch (e) {
        console.warn(`[AssetPicker] ⚠️ ${e.message}`);
        return null;
    }
}

// Backward-compatible alias
function getAssetImage() { return getContextualAsset(); }

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate personalized DM outreach message for a lead
 * @param {object} lead - Lead from database (must include content, category, summary, language)
 * @param {object} opts
 * @param {string} opts.staffName - Sales staff name (default 'Đức Anh')
 * @param {string} opts.tone - 'friendly' | 'professional' | 'urgent'
 * @returns {{ message: string, language: string, type: string }}
 */
async function generateDM(lead, opts = {}) {
    const { staffName = 'Đức Anh', tone = 'friendly' } = opts;
    const language = lead.language || 'vietnamese';

    const prompt = language === 'vietnamese'
        ? buildPromptVN(lead, staffName, tone)
        : buildPromptEN(lead, staffName, tone);

    let message = await generateWithCascade(prompt);

    // Clean up AI quirks
    message = cleanMessage(message);
    const imagePath = getContextualAsset(lead);

    return { message, imagePath, language, type: 'dm' };
}

/**
 * Generate comment reply for a lead's post
 * @param {object} lead
 * @param {object} opts
 * @returns {{ message: string, language: string, type: string }}
 */
async function generateComment(lead, opts = {}) {
    const { staffName = 'Đức Anh' } = opts;
    const language = lead.language || 'vietnamese';

    const prompt = buildCommentPrompt(lead, staffName, language);
    let message = await generateWithCascade(prompt);
    message = cleanMessage(message);
    const imagePath = getContextualAsset(lead);

    return { message, imagePath, language, type: 'comment' };
}

/**
 * Generate follow-up message (for leads already contacted but no reply)
 * @param {object} lead
 * @param {string} previousMessage - Last message sent
 * @param {object} opts
 * @returns {{ message: string, language: string, type: string }}
 */
async function generateFollowUp(lead, previousMessage, opts = {}) {
    const { staffName = 'Đức Anh' } = opts;
    const language = lead.language || 'vietnamese';

    let prompt;
    if (language === 'vietnamese') {
        prompt = `Bạn là ${staffName} (THG Logistics). Trước đó bạn đã gửi tin nhắn cho khách:
"${previousMessage}"

Nhưng khách chưa reply. Viết TIN NHẮN FOLLOW-UP nhẹ nhàng (2-3 câu):
- Nhắc lại vấn đề khách cần
- Không push bán
- Tone thân thiện
CHỈ trả về nội dung tin nhắn.`;
    } else {
        prompt = `You are ${staffName} (THG Logistics). You previously sent:
"${previousMessage}"

But the customer hasn't replied. Write a GENTLE FOLLOW-UP (2-3 sentences):
- Reference their original need
- Don't be pushy
- Friendly tone
Return ONLY the message.`;
    }

    let message = await generateWithCascade(prompt);
    message = cleanMessage(message);

    return { message, language, type: 'followup' };
}

/**
 * Batch generate outreach for multiple leads
 * @param {object[]} leads - Array of leads
 * @param {object} opts
 * @returns {Array<{leadId: number, message: string, language: string, type: string}>}
 */
async function batchGenerate(leads, opts = {}) {
    const results = [];
    const BATCH_DELAY_MS = 2000; // 2s between calls to avoid rate limits

    for (let i = 0; i < leads.length; i++) {
        try {
            const result = await generateDM(leads[i], opts);
            results.push({ leadId: leads[i].id, ...result });
            console.log(`[OutreachGen] 📝 ${i + 1}/${leads.length} - Lead #${leads[i].id} done`);
        } catch (e) {
            console.error(`[OutreachGen] ❌ Lead #${leads[i].id} failed: ${e.message}`);
            results.push({ leadId: leads[i].id, message: null, error: e.message });
        }

        // Delay between calls
        if (i < leads.length - 1) {
            await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
        }
    }

    return results;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Clean up common AI response quirks
 */
function cleanMessage(text) {
    if (!text) return '';
    // Remove surrounding quotes
    text = text.replace(/^["'""]|["'""]$/g, '').trim();
    // Remove "Subject:" or "Chủ đề:" prefixes
    text = text.replace(/^(Subject|Chủ đề)\s*:\s*/i, '').trim();
    // Remove markdown bold
    text = text.replace(/\*\*/g, '').trim();
    return text;
}

module.exports = {
    generateDM,
    generateComment,
    generateFollowUp,
    batchGenerate,
};
