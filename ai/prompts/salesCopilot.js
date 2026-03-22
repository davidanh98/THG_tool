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

        // 2. Fetch Account/Clues if any
        const account = database.findAccountByIdentity('fb_profile', rawPost.author_profile_url);
        const identities = account ? database._db.prepare(`SELECT * FROM identity_clues WHERE account_id = ?`).all(account.id) : [];

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
${identities.map(i => `- ${i.type}: ${i.value}`).join('\n')}

Hãy soạn Lead Card chiến lược:`;

        // 4. Call AI (GPT-4o for strategy, fallback to mini)
        let response = null;
        try {
            response = await aiProvider.generateText(sysPrompt, usrPrompt, {
                model: 'gpt-4o',
                jsonMode: true
            });
        } catch (aiErr) {
            console.warn(`[SalesCopilot] ⚠️ GPT-4o failed, falling back to Mini: ${aiErr.message}`);
        }

        if (!response) {
            response = await aiProvider.generateText(sysPrompt, usrPrompt, {
                model: 'gpt-4o-mini',
                jsonMode: true
            });
        }

        if (!response) {
            console.error('[SalesCopilot] ❌ AI returned null response');
            return null;
        }

        const cardData = JSON.parse(response);

        // 5. Save to DB
        const cardId = database.insertLeadCard({
            raw_post_id: rawPostId,
            account_id: account ? account.id : null,
            lane: classification.recommended_lane,
            strategic_summary: cardData.strategic_summary,
            suggested_opener: cardData.suggested_opener,
            objection_prevention: cardData.objection_prevention,
            next_best_action: cardData.next_best_action,
            sales_priority_score: cardData.sales_priority_score || classification.intent_score
        });

        console.log(`[SalesCopilot] ✅ Lead Card Generated: #${cardId} (Priority: ${cardData.sales_priority_score})`);
        return cardId;

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
    const reply = await buildAgentReply(context.salesName || 'THG Agent', message, context);
    return reply;
}

module.exports = { generateLeadCard, generateResponses, generateCopilotReply };
