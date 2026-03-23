const aiProvider = require('../aiProvider');
const database = require('../../backend/core/data_store/database');

async function processIncomingMessage(senderId, messageText, platform = 'messenger') {
    console.log(`[MetaInboxAgent] 🤖 Processing msg from ${senderId} on ${platform}`);

    // 1. Prompt for AI Triage
    const sysPrompt = `Bạn là Trợ lý phân loại khách hàng Inbox (Triage Agent) cho THG Logistics (Fulfillment, Warehouse tại Mỹ/TQ/VN, Vận chuyển đi Mỹ/EU).
Nhiệm vụ:
1. Đọc tin nhắn khách.
2. Trích xuất thông tin (tên, email, sđt) nếu có.
3. Phân loại nhu cầu chính: "express", "fulfillment", "warehouse", "sourcing", "noise" (không lq).
4. Soạn một bản "draft_reply" (tin nhắn nháp) cực kỳ tự nhiên, thân thiện để Sales duyệt. Đi thẳng vào vấn đề.

OUTPUT BẮT BUỘC FORMAT JSON:
{
  "needs": ["express", "fulfillment", "warehouse", "sourcing", "noise"],
  "urgency": "high" | "medium" | "low",
  "contact_details": {
    "name": "string",
    "phone": "string",
    "email": "string"
  },
  "source_country": "VN/CN/US/Unknown",
  "dest_country": "US/EU/Global/Unknown",
  "draft_reply": "Câu trả lời gợi ý"
}`;

    const usrPrompt = `TÍN HIỆU TỪ KHÁCH: "${messageText}"\nHãy Triage và Sinh Draft:`;

    try {
        const response = await aiProvider.generateText(sysPrompt, usrPrompt, {
            model: 'gpt-4o-mini',
            jsonMode: true
        });

        if (!response) {
            console.error('[MetaInboxAgent] ❌ AI returned null');
            return null;
        }

        const triageData = JSON.parse(response);
        console.log(`[MetaInboxAgent] ✅ Triage Success: Needs=${triageData.needs}, Urgency=${triageData.urgency}`);
        return triageData;
    } catch (err) {
        console.error(`[MetaInboxAgent] ❌ Triage failed:`, err.message);
        return null;
    }
}

module.exports = {
    processIncomingMessage
};
