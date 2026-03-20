'use strict';

const { generateText } = require('../aiProvider');
const predictiveScoring = require('../agents/enrichment/predictiveScoring');

const SIS_PROMPT = `Bạn là hệ thống Seller Intelligence chuyên đánh giá khách hàng thương mại điện tử (POD/Dropship).
Nhiệm vụ của bạn là phân tích văn bản (bài đăng/bình luận của khách hàng trên mạng xã hội Facebook) và chấm điểm hành vi theo 5 trục để phục vụ việc chốt Sale.

VĂN BẢN CẦN PHÂN TÍCH:
"""
{TEXT}
"""

HÃY QUYẾT ĐỊNH NEXT ACTION:
- "sales_now": Nhanh, gấp, đau mạnh -> Cho Sales gọi ngay.
- "automated_outreach": Nhu cầu chung chung -> Bắn comment mồi.
- "nurture": Khảo sát, hỏi han -> Đưa vào danh sách nuôi dưỡng.
- "watchlist": Tín hiệu rác, newbie hỏi vu vơ.

Bạn PHẢI TRẢ VỀ KẾT QUẢ DƯỚI DẠNG CHUỖI JSON HỢP LỆ (KHÔNG CÓ MARKDOWN BỌC NGOÀI, CHỈ JSON THUẦN TÚY BẮT ĐẦU BẰNG { VÀ KẾT THÚC BẰNG }):
{
  "pain_score": <số từ 0-100: 100 = Cực kỳ đau như ship chậm, khách complain, bị hold tiền, cần kho gấp>,
  "revenue_score": <số từ 0-100: 100 = Dấu hiệu Volume lớn, đang scale ads, bán Mỹ, hỏi kho chứa, tuyển agent>,
  "contactability_score": <số từ 0-100: 100 = Có để lại SĐT, link, khao khát được liên hệ>,
  "switching_score": <số từ 0-100: 100 = Có đang chửi agent cũ hoặc muốn tìm line mới>,
  "urgency_score": <số từ 0-100: 100 = Cần gấp trong tuần này, khẩn cấp>,
  "summary": "<1 câu tóm tắt chính xác cực ngắn về tình trạng của lead>",
  "category": "<VD: POD / Dropship / Fashion / Home Decor / Unknown>",
  "suggested_action": "<sales_now / automated_outreach / nurture / watchlist>",
  "extracted_identities": [ // Danh sách các SĐT, Email, Link Web xuất hiện trong bài viết (nếu có)
     { "type": "phone" | "email" | "domain" | "zalo" | "whatsapp" | "other", "value": "giá trị" }
  ]
}`;

/**
 * Score a lead across 5 axes using LLM
 * @param {string} content 
 * @param {string} comments 
 * @returns {object} JSON object of scores
 */
async function generateSISScore(content, comments) {
    const fullText = `Post: ${content || ''}\nComments: ${comments || ''}`;
    const prompt = SIS_PROMPT.replace('{TEXT}', fullText.substring(0, 2000));

    try {
        const rawOutput = await generateText(prompt);
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
