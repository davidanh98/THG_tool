/**
 * THG Agent — SIS v2 Dynamic Prompt Builder
 * 
 * Builds context-aware prompts by combining:
 * 1. Base THG context
 * 2. Relevant knowledge chunks (from KB)
 * 3. SIS v2 SIS Scoring Rubric (6-Metric)
 * 4. 4-Lane Routing Logic
 */

const config = require('../../backend/config');
const { getContextForPrompt } = require('./knowledgeBase');
const { getFeedbackExamples } = require('./memoryStore');

/**
 * Build the system prompt dynamically for a given post (SIS v2)
 */
function buildSystemPrompt(postContent) {
    const base = `Bạn là SIS Classifier — Chuyên gia phân tích tín hiệu thương mại (Signal-Centric Intelligence) cho THG Logistics.

Nhiệm vụ: Phân tích các bài đăng/bình luận trên Facebook để xác định ý định, nỗi đau (pain) và giải mã danh tính seller.

---
🎯 CHIẾN LƯỢC SIS v2:
1. "Signal" quan trọng hơn "Website": Chúng ta không săn lùng website một cách mù quáng. Chúng ta săn lùng "Nỗi đau" (Pain) và "Ý định" (Intent).
2. Phân loại Lane (Luồng): 
   - Resolved: Đã rõ danh tính/brand -> Ưu tiên Sales.
   - Partial: Có vẻ là seller xịn nhưng chưa rõ brand -> Theo dõi thêm.
   - Anonymous: Clone/Ẩn danh nhưng pain rõ -> Lưu làm Market Intel.
   - Competitor: Đối thủ đang chào hàng -> Intelligence.
   - Discard: Rác, nội dung không liên quan, hoặc SAI TUYẾN (vận chuyển VỀ VN, từ Mỹ/nước ngoài về VN, nội địa VN).

---
📊 QUY TẮC CHẤM ĐIỂM (6-SCORE RUBRIC):

1. Seller Likelihood (0-100): Khả năng là seller thật?
   - (+) Dùng thuật ngữ: line US, hold hàng, tracking, Basecost, Profit, Store, Shopify, Etsy, Amazon, TikTok Shop US.
   - (+) Nhắc volume: đơn/ngày, đang scale, đơn nhiều.

2. Pain Score (0-100): Mức độ "đau" thật sự?
   - (+) Ship chậm, delivery dài, khách complain, vendor fail, stuck customs, giá cao, support kém.

3. Intent Score (0-100): Đang THẬT SỰ tìm giải pháp hay chỉ than vãn?
   - (+) "Cần gấp", "ai đang dùng kho US", "cần agent", "đang tìm đơn vị mới", "xin giá".

4. Resolution Confidence (0-100): Khả năng truy ra business/brand từ các manh mối (Identity Clues)?
   - (+) Có link website, domain, page, email, IG handle, Brand name.
   - (-) Nick clone rỗng, profile khóa, không để lại thông tin gì.

5. Contactability Score (0-100): Có đường nào chạm được (reach) không?
   - (+) Email public, website form, page active, có SĐT.

6. Competitor Probability (0-100): Có phải đối thủ hoặc service spam?
   - (+) "Bên em nhận", "Inbox báo giá", để lại SĐT/Zalo, giới thiệu dịch vụ logistics khác.

---
🚫 DEAD-RULES (LUẬT TỬ HÌNH - TUYỆT ĐỐI TUÂN THỦ):
- BẤT KỲ BÀI ĐĂNG NÀO TÌM DỊCH VỤ SHIP **VỀ VIỆT NAM** (TỪ MỸ VỀ, TỪ TQ VỀ, TỪ CHÂU ÂU VỀ...): -> BẮT BUỘC ĐÁNH RỚT: \`is_relevant=false\` VÀ \`recommended_lane="discard"\`.
- CHÚNG TA CHỈ NHẬN HÀNG TỪ VN -> ĐI NƯỚC NGOÀI. TUYỆT ĐỐI KHÔNG LÀM CHIỀU NGƯỢC LẠI.
- BÀI VIẾT QUẢNG CÁO DỊCH VỤ, BÁN TOOL, XƯỞNG SẢN XUẤT CHÀO HÀNG -> BẮT BUỘC ĐÁNH RỚT LÀ RÁC CỦA ĐỐI THỦ: \`is_relevant=false\` VÀ \`recommended_lane="discard"\`.
- BÀI VIẾT TUYỂN DỤNG, TÌM VIỆC LÀM -> BẮT BUỘC ĐÁNH RỚT: \`is_relevant=false\` VÀ \`recommended_lane="discard"\`.

🌎 ĐA NGÔN NGỮ (MULTILINGUAL):
- Bài đăng bằng tiếng Anh (Foreign) tìm dịch vụ fulfillment, 3PL, Dropship, Sourcing TỪ Việt Nam BẮT BUỘC phải được giữ lại và khai thác! Không được đánh rớt bài tiếng Anh.
- Hãy phân loại \`language\` thành "vietnamese" hoặc "foreign".


${config.THG_CONTEXT}`;

    const kbContext = getContextForPrompt(postContent);
    const feedbackSection = buildFeedbackSection();

    return [base, kbContext, feedbackSection,
        '\nTrả về JSON DUY NHẤT theo schema yêu cầu. Không kèm giải thích.'
    ].filter(Boolean).join('\n\n');
}

/**
 * Build feedback section from past human text corrections
 */
function buildFeedbackSection() {
    const examples = getFeedbackExamples(5);
    if (examples.length === 0) return '';

    const lines = examples.map(ex => {
        const content = (ex.content || '').substring(0, 80);
        const aiLabel = `${ex.role} (score ${ex.score})`;
        const humanNote = ex.feedback_note || ex.human_feedback || 'n/a';
        return `- Post: "${content}..."
  AI đánh: ${aiLabel}
  Sale feedback: ${humanNote}`;
    });

    return `🔄 HỌC TỪ FEEDBACK CỦA TEAM SALE:
${lines.join('\n')}

→ Hãy học từ feedback này để tinh chỉnh độ nhạy của 6 metric.`;
}

/**
 * Build the user prompt for a single post (SIS v2)
 */
function buildUserPrompt(post) {
    const typeLabel = post.item_type === 'comment' ? 'COMMENT' : 'POST';
    const parentCtx = post.parent_excerpt ? `\nParent Context: ${post.parent_excerpt}` : '';

    return `Phân tích tín hiệu ${typeLabel} sau:

Platform: ${post.platform}
Group: ${post.group_name || post.source_group || 'Unknown'}
Content: ${(post.content || '').substring(0, 1500)}${parentCtx}

Trả về JSON object:
{
  "is_relevant": boolean,
  "entity_type": "seller" | "competitor" | "newbie" | "noise" | "unknown",
  "seller_likelihood": number (0-100),
  "pain_score": number (0-100),
  "intent_score": number (0-100),
  "resolution_confidence": number (0-100),
  "contactability_score": number (0-100),
  "competitor_probability": number (0-100),
  "pain_tags": ["shipping_delay", "us_fulfillment_need", etc],
  "market_tags": ["US", "AU", "EU", etc],
  "seller_stage_estimate": "newbie" | "operator" | "scaling" | "unknown",
  "language_signals": ["thuật ngữ kỹ thuật"],
  "language": "vietnamese" | "foreign",
  "possible_identity_clues": ["website.com, @handle, brand_name"],
  "recommended_lane": "resolved_lead" | "partial_lead" | "anonymous_signal" | "competitor_intel" | "discard",
  "reason_summary": "Giải thích ngắn gọn tại sao chọn lane này.",
  "confidence": "low" | "medium" | "high"
}`;
}

/**
 * Build the batch prompt for multiple posts (SIS v2)
 */
function buildBatchPrompt(posts) {
    const postsList = posts.map((p, i) => {
        const typeLabel = p.item_type === 'comment' ? 'COMMENT' : 'POST';
        const parentCtx = p.parent_excerpt ? ` | Parent: ${p.parent_excerpt.substring(0, 150)}` : '';
        return `[#${i + 1}] Platform: ${p.platform} | Group: ${p.group_name || 'Unknown'} | Type: ${typeLabel}${parentCtx}\nContent: ${(p.content || '').substring(0, 800)}`;
    }).join('\n\n---\n\n');

    return `Phân tích ${posts.length} tín hiệu thương mại sau. Trả về JSON object với key "results" (array):

${postsList}

Chi tiết JSON cho mỗi kết quả:
{
  "is_relevant": bool, // BẮT BUỘC FALSE nếu là hàng nhập VỀ VN, Mỹ VỀ VN, nội địa
  "entity_type": "...",
  "seller_likelihood": 0-100,
  "pain_score": 0-100,
  "intent_score": 0-100,
  "resolution_confidence": 0-100,
  "contactability_score": 0-100,
  "competitor_probability": 0-100,
  "pain_tags": [],
  "market_tags": [],
  "language": "vietnamese" hay "foreign",
  "recommended_lane": "resolved_lead" | "partial_lead" | "anonymous_signal" | "competitor_intel" | "discard", // BẮT BUỘC "discard" NẾU SAI TUYẾN HOẶC LÀ XƯỞNG CHÀO BASECOST/BÁN ACC
  "reason_summary": "Giải thích ngắn gọn (VD: Rác - Xưởng chào Basecost hoặc Nhập hàng về VN)"
}`;
}

/**
 * Build a personalized reply prompt (Sales Copilot logic)
 */
function buildAgentReply(lead, agentProfile) {
    const toneGuide = {
        friendly: 'Nhiệt tình, thân thiện, dùng emoji nhẹ nhàng, xưng hô "mình/bạn".',
        professional: 'Chuyên nghiệp, lịch sự, dùng "chúng tôi/quý khách", không emoji.',
        concise: 'Ngắn gọn, đi thẳng vào vấn đề, tối đa 3-4 câu.',
    };

    const tone = toneGuide[agentProfile.tone] || toneGuide.friendly;
    const kbContext = getContextForPrompt(lead.content || '');

    const system = `Bạn là ${agentProfile.name} — Phái đoàn cao cấp của THG Logistics.
Bạn đang phản hồi một tín hiệu từ SIS v2 với phong cách: ${tone}
${agentProfile.personal_note ? `\nLưu ý cá nhân: "${agentProfile.personal_note}"` : ''}

=== KIẾN THỨC THG (MASTER BRAIN) ===
${config.THG_CONTEXT}
${kbContext ? `\n=== THÔNG TIN LIÊN QUAN ===\n${kbContext}` : ''}

QUY TẮC:
- Nếu LEAD là Resolved: Tấn công trực diện vào brand/website nếu biết.
- Nếu LEAD là Anonymous: Chỉ comment "Expert Hook" (chia sẻ kiến thức/giải pháp cho pain point đã bắt được) để lấy lòng tin, tuyệt đối không chốt sales thô thiển.
- Nhắm vào Pain Point: ${lead.pain_points || 'Nhu cầu logistics'}.
- Trả về CHỈ nội dung tin nhắn.`;

    const user = `Lead Signal: ${lead.author_name || 'Khách hàng'}
Nội dung Content: "${lead.content || ''}"
Pain Point đã bắt: ${lead.pain_summary || lead.pain_points || 'N/A'}
Lane đề xuất: ${lead.lane || 'Resolved'}

Hãy viết tin nhắn/comment reply phù hợp.`;

    return { system, user };
}

module.exports = {
    buildSystemPrompt,
    buildUserPrompt,
    buildBatchPrompt,
    buildAgentReply,
};
