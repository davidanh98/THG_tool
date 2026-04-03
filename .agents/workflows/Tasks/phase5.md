---
description: Phase 5: Hệ thống Phản ứng (Reaction System)
---

5.1. Nhánh 1: Alert qua Telegram (Real-time Notification)
Việc gửi alert giúp team Sales của bạn nắm bắt được "biến" ngay lập tức để có thể can thiệp thủ công nếu cần.

Công cụ: Sử dụng thư viện telegraf hoặc đơn giản là gọi axios đến Telegram Bot API.

Nội dung Alert: Phải bao gồm Link bài viết (để click vào xem ngay), Điểm tiềm năng (Score), Lý do AI chọn (Reasoning) và nút bấm nhanh.

JavaScript
const axios = require('axios');

async function sendTelegramAlert(leadData) {
  const message = `
🔥 **PHÁT HIỆN LEAD TIỀM NĂNG (Score: ${leadData.score}/100)**
📝 **Nội dung:** ${leadData.content.substring(0, 100)}...
💡 **AI Phân tích:** ${leadData.reasoning}
🔗 **Link:** https://facebook.com/${leadData.post_id}
  `;

  await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: process.env.TELEGRAM_CHAT_ID,
    text: message,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [[
        { text: "Xem bài viết", url: `https://facebook.com/${leadData.post_id}` }
      ]]
    }
  });
}
5.2. Nhánh 2: Actor Agent - Tự động Comment/Nhắn tin
Đây là phần nhạy cảm nhất. Để tránh checkpoint, bạn không được dùng nội dung giống hệt nhau cho mọi bài viết.

Cá nhân hóa nội dung bằng OpenAI: Trước khi comment, hãy ném nội dung bài viết gốc vào OpenAI một lần nữa với Prompt: "Dựa trên bài đăng này, hãy viết một lời phản hồi tự nhiên, chuyên nghiệp từ phía THG Fulfill (vận chuyển US/dropshipping), đừng giống như quảng cáo spam."

Cơ chế xoay vòng tài khoản Ghi (Actor Pool):
Sử dụng một bảng riêng actor_accounts trong Supabase. Những tài khoản này phải là Via cực cứng (có tương tác thật).

Kỹ thuật thực thi:

Comment: Dùng request GraphQL comment_create (giống như cách bạn cào bài nhưng là method POST để ghi dữ liệu). Comment thường an toàn hơn nhắn tin trực tiếp (DM).

Message (Inbox): Cực kỳ rủi ro nếu tài khoản chưa từng là bạn bè. Lời khuyên: Chỉ nên tự động comment điều hướng khách hàng check inbox, sau đó team Sales vào nhắn tin thủ công hoặc dùng tool chuyên dụng cho chat.

5.3. Logic điều phối (Orchestration) trong Node.js
JavaScript
async function handleHighPotentialLead(lead) {
  // 1. Gửi Alert ngay lập tức
  await sendTelegramAlert(lead);

  // 2. Nếu điểm > 85, kích hoạt Actor Agent
  if (lead.score >= 85) {
    // Gọi OpenAI soạn nội dung comment cá nhân hóa
    const personalizedComment = await generateAIComment(lead.content);
    
    // Lấy 1 tài khoản Actor đang rảnh
    const actor = await getAvailableActorAccount();
    
    // Thực hiện comment qua Shadow API (GraphQL)
    const result = await postFbComment(actor, lead.post_id, personalizedComment);
    
    if(result.success) {
       await logAction(actor.id, 'comment', lead.post_id);
    }
  }
}
Các lưu ý "Sống còn" cho Production (Anti-Ban)
Throttling (Giới hạn tốc độ Ghi): Một tài khoản Actor chỉ nên comment tối đa 3-5 lần/ngày, mỗi lần cách nhau ít nhất 30-60 phút. Nếu làm quá nhanh, Facebook sẽ đánh dấu spam và khóa tính năng comment ngay lập tức.

Giờ hoạt động: Chỉ cho Agent đi comment vào khung giờ người thật làm việc (ví dụ 8h sáng - 10h tối). Tránh việc 3 giờ sáng vẫn đi comment tự động.

Spin Tax / AI Variation: Luôn bắt OpenAI tạo ra ít nhất 3 biến thể nội dung khác nhau cho mỗi lần comment để tránh việc Facebook quét trùng lặp nội dung.

Priority Queue: Dùng hệ thống hàng đợi (như BullMQ hoặc đơn giản là bảng queue trong Supabase) để xử lý việc comment. Đừng để hệ thống vừa cào xong là nhảy vào comment ngay lập tức, hãy để nó "delay" ngẫu nhiên từ 5-15 phút để giống người thật đang đọc bài rồi mới phản hồi.