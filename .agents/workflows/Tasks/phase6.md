---
description: Risk Agent
---

Trước khi chạy code, bạn cần đảm bảo cấu trúc 2 bảng này trên Supabase:

system_logs: id, account_uid, error_type, message, created_at.

system_configs: key (ví dụ: GLOBAL_DELAY, DAILY_LIMIT), value (số nguyên), updated_at, reason.

Dưới đây là mã nguồn hoàn chỉnh cho file risk_agent.js:

JavaScript
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { OpenAI } = require('openai');
const axios = require('axios');

// Khởi tạo các kết nối
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Cấu hình Telegram
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

/**
 * BƯỚC 1: Kéo log lỗi trong 1 giờ qua
 */
async function fetchRecentErrorLogs() {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    
    const { data: logs, error } = await supabase
        .from('system_logs')
        .select('*')
        .gte('created_at', oneHourAgo);

    if (error) throw new Error(`Lỗi kéo log: ${error.message}`);
    return logs;
}

/**
 * BƯỚC 2: Đưa log cho OpenAI phân tích và ép kiểu trả về JSON
 */
async function analyzeRiskWithAI(logs) {
    if (!logs || logs.length === 0) return null;

    const prompt = `
    Bạn là Risk Management Agent của hệ thống tự động hóa THG Fulfill.
    Dưới đây là danh sách các lỗi hệ thống ghi nhận được trong 1 giờ qua từ dàn tài khoản Facebook via.
    Hãy phân tích pattern lỗi và đề xuất cách điều chỉnh thông số hệ thống để chống bị Checkpoint.
    
    Dữ liệu Logs:
    ${JSON.stringify(logs)}

    Hệ thống hiện tại có 2 thông số cần điều chỉnh:
    1. GLOBAL_DELAY (thời gian nghỉ giữa các comment, tính bằng giây. Mặc định 60s).
    2. DAILY_LIMIT (số comment tối đa/ngày/account. Mặc định 3).

    Hãy trả về ĐÚNG định dạng JSON sau, không kèm text nào khác:
    {
        "status": "safe" | "warning" | "critical",
        "analysis_reason": "Lý do ngắn gọn vì sao điều chỉnh",
        "recommended_configs": {
            "GLOBAL_DELAY": <số giây đề xuất mới>,
            "DAILY_LIMIT": <số lượng giới hạn mới>
        },
        "pause_system": true | false
    }
    `;

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: prompt }],
        response_format: { type: "json_object" }, // Ép OpenAI trả về JSON chuẩn
        temperature: 0.2 // Hạ nhiệt độ để AI trả lời nhất quán, logic
    });

    return JSON.parse(response.choices[0].message.content);
}

/**
 * BƯỚC 3: Tự động cập nhật Database (Điều chỉnh Code Runtime)
 */
async function applyNewConfigs(aiDecision) {
    const updates = [];
    
    // Tạo mảng promise để update nhiều cấu hình cùng lúc
    for (const [key, value] of Object.entries(aiDecision.recommended_configs)) {
        updates.push(
            supabase
                .from('system_configs')
                .update({ 
                    value: value, 
                    reason: aiDecision.analysis_reason,
                    updated_at: new Date().toISOString()
                })
                .eq('key', key)
        );
    }

    await Promise.all(updates);
    console.log("[Risk Agent] Đã cập nhật cấu hình hệ thống thành công.");
}

/**
 * BƯỚC 4: Gửi cảnh báo Telegram
 */
async function sendTelegramAlert(aiDecision, logCount) {
    const icon = aiDecision.status === 'critical' ? '🚨' : '⚠️';
    const pauseMsg = aiDecision.pause_system ? "\n⛔ **HỆ THỐNG ĐÃ TẠM DỪNG KHẨN CẤP**" : "";

    const message = `
${icon} **RISK AGENT REPORT - THG FULFILL** ${icon}
📊 **Ghi nhận:** ${logCount} lỗi trong giờ qua.
🧠 **AI Phân tích:** ${aiDecision.analysis_reason}

🛠️ **Hành động tự động điều chỉnh:**
- \`GLOBAL_DELAY\` $\\rightarrow$ ${aiDecision.recommended_configs.GLOBAL_DELAY} giây
- \`DAILY_LIMIT\` $\\rightarrow$ ${aiDecision.recommended_configs.DAILY_LIMIT} comment/ngày
${pauseMsg}
    `;

    await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
        parse_mode: 'Markdown'
    });
}

/**
 * HÀM MAIN: Luồng điều phối
 */
async function runRiskAgent() {
    try {
        console.log("[Risk Agent] Đang khởi chạy quét rủi ro...");
        
        // 1. Kéo log
        const logs = await fetchRecentErrorLogs();
        if (logs.length === 0) {
            console.log("[Risk Agent] Hệ thống an toàn, không có lỗi bất thường.");
            return;
        }

        console.log(`[Risk Agent] Phát hiện ${logs.length} lỗi. Đang gửi cho AI phân tích...`);
        
        // 2. AI Phân tích
        const aiDecision = await analyzeRiskWithAI(logs);
        
        // 3. Nếu AI đánh giá rủi ro, thực hiện đổi cấu hình
        if (aiDecision.status === 'warning' || aiDecision.status === 'critical') {
            await applyNewConfigs(aiDecision);
            await sendTelegramAlert(aiDecision, logs.length);
            
            if (aiDecision.pause_system) {
                // Logic ngắt khẩn cấp: Ví dụ update config 'SYSTEM_STATUS' = 'PAUSED'
                await supabase.from('system_configs').update({ value: 0 }).eq('key', 'IS_ACTIVE');
            }
        } else {
             console.log("[Risk Agent] Lỗi rải rác, hệ thống vẫn trong ngưỡng an toàn.");
        }

    } catch (error) {
        console.error("[Risk Agent] Lỗi thực thi:", error);
    }
}

// Chạy cronjob định kỳ (Ví dụ: 30 phút chạy 1 lần)
// Nếu chạy trên local, dùng setInterval. Nếu deploy lên server, kết hợp với node-cron
runRiskAgent();
setInterval(runRiskAgent, 30 * 60 * 1000); 
Cách hoạt động thực tế:

Các Worker làm nhiệm vụ cào bài và comment của bạn sẽ luôn phải gọi supabase.from('system_configs').select('value').eq('key', 'GLOBAL_DELAY') trước khi thực hiện hàm delay().

Giả sử Facebook bỗng nhiên có đợt càn quét, Worker gặp lỗi liên tục và ghi vào bảng system_logs.

Script risk_agent.js này chạy lên, chẩn đoán tình hình, và tự động tăng biến GLOBAL_DELAY từ 60 lên 300 giây.

Các Worker đang chạy ở chu kỳ tiếp theo khi đọc Database sẽ nhận giá trị 300 giây và tự động giãn cách thời gian comment ra, lập tức né được đợt quét của thuật toán Meta mà không cần bạn phải mở laptop lên sửa code hay restart server.