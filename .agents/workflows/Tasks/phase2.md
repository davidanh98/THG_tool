---
description: Thiết kế Schema Supabase
---

id: UUID

uid: String (ID của tài khoản Facebook)

access_token / cookie: String (Dữ liệu xác thực)

user_agent: String (User-Agent của thiết bị Mobile gắn cố định với tài khoản này)

proxy_ip: String (IP tĩnh gắn liền với acc này, cực kỳ quan trọng để không bị đổi IP liên tục)

status: Enum (active, checkpoint, rate_limited)

last_used_at: Timestamp (Dùng để xác định tài khoản nào nghỉ lâu nhất)

daily_count: Integer (Reset về 0 mỗi ngày, nếu >= 10 thì ngừng chạy trong ngày đó)


Mục tiêu: Xây dựng nền móng lưu trữ trên Supabase và chuẩn bị các "nguyên liệu" an toàn để qua mặt hệ thống chống bot.

Thiết lập Supabase: Tạo 3 bảng cốt lõi:

fb_accounts: Lưu trữ cookie, fb_dtsg, user_agent, proxy_ip, status, daily_count.

targets: Chứa UID của các Group e-commerce mục tiêu và cột last_scraped_at.

raw_posts: Chứa dữ liệu thô (Text, Metadata, Author UID, Timestamp) lấy về từ Facebook.

Chuẩn bị Tài nguyên: Mua 2-3 tài khoản Via (ưu tiên Via ngoại lâu năm hoặc Via Việt đã xác minh danh tính) và 1 Static Residential Proxy.

Trích xuất State: Đăng nhập Via vào trình duyệt ẩn danh (qua Proxy), mở DevTools (Network tab), thực hiện cuộn trang trong một Group để bắt request GraphQL. Lấy bộ Headers và lưu vào bảng fb_accounts.