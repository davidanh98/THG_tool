/**
 * SIS v2 Sales Copilot — The Strategic Brain
 * 
 * Functions:
 * 1. SYNTHESIZE: High-resolution 'Lead Cards' from raw signals + clues.
 * 2. AUDIT: Automated pain analysis (Mini Audit).
 * 3. STRATEGIZE: Next Best Action & Objection Prevention.
 * 4. DRAFT: Context-aware openers (Suggested Opener).
 */

const aiProvider = require('../aiProvider');
const { buildAgentReply } = require('../agents/promptBuilder');
const database = require('../../backend/core/data_store/database');

/**
 * Generate a Strategic Lead Card for a commercial signal
 * @param {number} rawPostId - The ID of physics/signal in raw_posts
 */
async function generateLeadCard(rawPostId) {
    console.log(`[SalesCopilot] 🧠 Synthesizing Lead Card for Signal #${rawPostId}...`);

    try {
        // 1. Fetch Context
        const rawPost = database._db.prepare(`SELECT * FROM raw_posts WHERE id = ?`).get(rawPostId);
        const classification = database._db.prepare(`SELECT * FROM post_classifications WHERE raw_post_id = ?`).get(rawPostId);

        if (!rawPost || !classification) {
            console.warn(`[SalesCopilot] ⚠️ Missing context for Lead Card (RawPost: ${!!rawPost}, Cls: ${!!classification})`);
            return null;
        }

        // 2. Fetch Account/Clues if any from the flattened classification
        let identities = { emails: [], websites: [], pages: [], phones: [] };
        try { identities = JSON.parse(classification.identity_clues || '{}'); } catch (e) { }

        // 3. Build Strategic Prompt
        const sysPrompt = `Bạn là Trợ lý Chiến lược Sales cấp cao tại THG Logistics. 
Nhiệm vụ của bạn là phân tích một tín hiệu thương mại (commercial signal) và soạn thảo "Lead Card" để nhân viên Sales có thể chốt đơn ngay lập tức.

DỮ LIỆU THG:
- USP: Fulfillment US (kho Pennsylvania/Texas), Ship nội địa 2-5 ngày, Xưởng in POD/Dropship tại VN/CN/US.
- Đối tượng: Seller POD, Dropship, Amazon FBA, Tiktok Shop US.

YÊU CẦU OUTPUT (JSON):
{
  "strategic_summary": "Phân tích Mini Audit về Pain của khách (VD: Margin thấp do ship đắt, hoặc delay do ship từ TQ)",
  "suggested_opener": "Câu chào cá nhân hóa, đánh thẳng vào Pain (không dùng văn mẫu)",
  "objection_prevention": "Dự đoán 1 phản bác lớn nhất của khách và cách xử lý",
  "next_best_action": "Hành động tối ưu (VD: DM Page, Comment bài viết, hoặc Gọi điện nếu có số)",
  "sales_priority_score": 0-100
}`;

        const usrPrompt = `
TÍN HIỆU: "${rawPost.post_text}"
RUBRIC: 
- Thể loại: ${classification.entity_type}
- Pain Score: ${classification.pain_score}
- Intent Score: ${classification.intent_score}
- Resolution Confidence: ${classification.resolution_confidence}%
- Pain Tags: ${classification.pain_tags}

DANH TÍNH ĐÃ BIẾT (Clues):
${identities.emails?.length ? `- Emails: ${identities.emails.join(', ')}` : ''}
${identities.phones?.length ? `- Phones: ${identities.phones.join(', ')}` : ''}
${identities.websites?.length ? `- Websites: ${identities.websites.join(', ')}` : ''}

Hãy soạn Lead Card chiến lược:`;

        // 4. Call AI — gpt-4o cho lead mạnh (pain/intent >= 80), gpt-4o-mini cho phần còn lại
        const isHighPriority = (classification.pain_score >= 80 || classification.intent_score >= 80);
        const model = isHighPriority ? 'gpt-4o' : 'gpt-4o-mini';
        console.log(`[SalesCopilot] 🤖 Model: ${model} (pain=${classification.pain_score}, intent=${classification.intent_score})`);

        let response = null;
        try {
            response = await aiProvider.generateText(sysPrompt, usrPrompt, {
                model,
                jsonMode: true
            });
        } catch (aiErr) {
            console.error(`[SalesCopilot] ❌ ${model} failed: ${aiErr.message}`);
            if (isHighPriority) {
                // Fallback về mini nếu gpt-4o fail
                try {
                    response = await aiProvider.generateText(sysPrompt, usrPrompt, { model: 'gpt-4o-mini', jsonMode: true });
                } catch (fallbackErr) {
                    console.error(`[SalesCopilot] ❌ Fallback mini also failed: ${fallbackErr.message}`);
                }
            }
        }

        if (!response) {
            console.error('[SalesCopilot] ❌ AI returned null response');
            return null;
        }

        const cardData = JSON.parse(response);

        // 5. Save to DB (Update the single post_classifications record)
        database.updateLeadCard(rawPostId, {
            strategic_summary: cardData.strategic_summary,
            suggested_opener: cardData.suggested_opener,
            objection_prevention: cardData.objection_prevention,
            next_best_action: cardData.next_best_action,
            sales_priority_score: cardData.sales_priority_score || classification.intent_score
        });

        console.log(`[SalesCopilot] ✅ Lead Card Generated & Merged for Post #${rawPostId} (Priority: ${cardData.sales_priority_score})`);
        return rawPostId;

    } catch (err) {
        console.error(`[SalesCopilot] ❌ Synthesis failed for Signal #${rawPostId}:`, err.message);
        return null;
    }
}

/**
 * Legacy Support: Generate responses for lead-gen pipeline
 */
async function generateResponses(leads) {
    // For SIS v2, we treat this as a batch card generator for high-intent signals
    const results = [];
    for (const lead of leads) {
        const raw = database._db.prepare(`SELECT id FROM raw_posts WHERE external_post_id = ?`).get(lead.post_url || lead.id);
        if (raw) {
            await generateLeadCard(raw.id);
            const card = database.getLeadCardByPost(raw.id);
            results.push({ ...lead, suggested_response: card?.suggested_opener || 'Drafting strategy...' });
        } else {
            results.push(lead);
        }
    }
    return results;
}

/**
 * Draft a reply for a specific conversation (Manual/Auto Takeover)
 */
async function generateCopilotReply(message, context) {
    const customPrompt = database.getSetting ? database.getSetting('AI_KNOWLEDGE_BASE', '') : '';

    const system = `Bạn là trợ lý tư vấn khách hàng của THG Logistics. Nhiệm vụ của bạn là đọc tin nhắn của khách và soạn thảo 1 câu trả lời MẪU thân thiện, tự nhiên.
Đặc biệt nếu là Ca Đêm (Night Shift): Hãy lịch sự, ngắn gọn và hướng dẫn khách để lại thông tin cụ thể để sáng mai Sales chăm sóc.

${customPrompt ? `--- HƯỚNG DẪN TRẢ LỜI CỦA CÔNG TY (KNOWLEDGE BASE) ---\n${customPrompt}\n---` : ''}

Quy định: Chỉ trả về nội dung câu trả lời gửi cho khách. Không dùng markdown, không giải thích.`;

    const user = `Khách hàng: "${message}"\nHãy viết một câu trả lời cho tình huống này:`;

    try {
        const response = await aiProvider.generateText(system, user, { model: 'gpt-4o-mini' });
        return response || 'Tôi có thể giúp gì cho bạn?';
    } catch (err) {
        console.error('[Copilot] Lỗi generate reply:', err.message);
        return 'Dạ, chúng tôi có thể giúp gì cho bạn?';
    }
}

async function classifyIntent(message) {
    const sys = `Bạn là công cụ phân loại Ý Định (Intent). Đọc tin nhắn dưới đây và trả về 1 trong các giá trị sau (CHỈ TRẢ VỀ TEXT): "price_inquiry", "service_inquiry", "urgent_need", "spam", "general".`;
    try {
        const res = await aiProvider.generateText(sys, message, { model: 'gpt-4o-mini' });
        const intent = res.toLowerCase().trim();
        if (["price_inquiry", "service_inquiry", "urgent_need", "spam", "general"].includes(intent)) return intent;
        return 'general';
    } catch (err) {
        return 'general';
    }
}

/**
 * Classify which THG service a customer message is about.
 * Returns: "warehouse" | "express" | "pod" | "quote_needed" | "unknown"
 * Used to auto-assign Meta Inbox conversations to the right staff.
 */
async function classifyService(message) {
    const sys = `Bạn là công cụ phân loại dịch vụ cho THG Logistics. Đọc tin nhắn khách và trả về ĐÚNG 1 trong các giá trị (CHỈ TRẢ VỀ TEXT, không giải thích):
- "warehouse" — khách hỏi về kho US, lưu kho, FBA prep, 3PL, pick & pack
- "express" — khách hỏi về ship nhanh US, giao gấp, đường bay express, urgent shipment
- "pod" — khách hỏi về POD, in áo/mug/poster, print on demand, dropship fulfillment
- "quote_needed" — khách hỏi giá chung chung, so sánh dịch vụ, chưa xác định rõ
- "unknown" — không đủ thông tin, hoặc không liên quan đến dịch vụ của THG`;
    try {
        const res = await aiProvider.generateText(sys, `Tin nhắn: "${message.substring(0, 400)}"`, { model: 'gpt-4o-mini' });
        const service = res.toLowerCase().trim();
        if (["warehouse", "express", "pod", "quote_needed", "unknown"].includes(service)) return service;
        return 'unknown';
    } catch (err) {
        return 'unknown';
    }
}

module.exports = { generateLeadCard, generateResponses, generateCopilotReply, classifyIntent, classifyService };
