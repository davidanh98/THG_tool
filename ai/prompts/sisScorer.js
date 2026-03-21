'use strict';

const { generateText } = require('../aiProvider');
const predictiveScoring = require('../agents/enrichment/predictiveScoring');

const SYSTEM_PROMPT = `Bạn là hệ thống Seller Intelligence chuyên đánh giá khách hàng thương mại điện tử (POD/Dropship).
Nhiệm vụ của bạn là phân tích văn bản (bài đăng/bình luận của khách hàng trên mạng xã hội Facebook) và chấm điểm hành vi theo 5 trục để phục vụ việc chốt Sale.

TUYỆT ĐỐI CHỈ TRẢ VỀ JSON THUẦN TÚY (Dùng tiếng Việt, không bọc markdown):
{
  "pain_score": <số từ 0-100: 100 = Cực kỳ đau như ship chậm, khách complain, bị hold tiền, cần kho gấp>,
  "revenue_score": <số từ 0-100: 100 = Dấu hiệu Volume lớn, đang scale ads, bán Mỹ, hỏi kho chứa, tuyển agent>,
  "contactability_score": <số từ 0-100: 100 = Có để lại SĐT, link, khao khát được liên hệ>,
  "switching_score": <số từ 0-100: 100 = Có đang chửi agent cũ hoặc muốn tìm line mới>,
  "urgency_score": <số từ 0-100: 100 = Cần gấp trong tuần này, khẩn cấp>,
  "summary": "<1 câu cực ngắn về tình trạng leads>",
  "category": "<VD: POD / Dropship / Unknown>",
  "seller_type": "<seller / competitor / newbie / noise>",
  "pain_tags": ["tag1", "tag2"],
  "suggested_action": "<sales_now / automated_outreach / nurture / watchlist>"
}`;

/**
 * Score a lead across 5 axes using LLM
 * @param {string} content 
 * @param {string} comments 
 * @returns {object} JSON object of scores
 */
async function generateSISScore(content, comments) {
    const userPrompt = `VĂN BẢN CẦN PHÂN TÍCH:\nPost: ${content || ''}\nComments: ${comments || ''}`.substring(0, 2000);

    try {
        const rawOutput = await generateText(SYSTEM_PROMPT, userPrompt, {
            model: 'gpt-4o-mini',
            maxTokens: 180,
            jsonMode: true
        });
        // Extract JSON using regex in case the model wraps it in markdown blocks
        const match = rawOutput.match(/\{([\s\S]*)\}/);
        if (match) {
            const parsed = JSON.parse(match[0]);

            // Calculate a weighted priority score using Auto-Tuned weights
            parsed.priority_score = predictiveScoring.calculatePriorityScore(parsed);

            return parsed;
        }
        throw new Error('No JSON object found in output');
    } catch (e) {
        console.warn(`[SIS] LLM scoring failed, using default scores: ${e.message}`);
        return {
            pain_score: 50,
            revenue_score: 50,
            contactability_score: 50,
            switching_score: 50,
            urgency_score: 50,
            priority_score: 50,
            summary: content ? content.substring(0, 50) + "..." : "Needs analysis",
            category: "Unknown",
            suggested_action: "automated_outreach"
        };
    }
}

module.exports = {
    generateSISScore
};
