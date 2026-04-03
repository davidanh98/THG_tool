---
description: Xây dựng Node.js Worker & Shadow API 
---

Mục tiêu: Viết script cốt lõi để gọi API lấy bài viết mà không dùng Playwright.

Phân tích Payload GraphQL: Tách chính xác doc_id và cấu trúc variables (chứa Group ID) từ request bắt được ở Phase 1.

Phát triển HTTP Client: Dùng axios hoặc fetch trong Node.js để đóng gói request. Cấu hình cẩn thận Headers để match 100% với User-Agent và Cookie trong Supabase.

Tích hợp Proxy: Đảm bảo request từ axios đi qua IP Proxy tĩnh đã mua bằng thư viện https-proxy-agent.

Xử lý Response & Lỗi: Viết hàm parse JSON trả về để lấy text bài viết. Thiết lập khối try/catch: nếu API trả về 401 hoặc mã lỗi xác minh, lập tức update status = 'checkpoint' trong bảng fb_accounts.