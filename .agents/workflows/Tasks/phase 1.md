---
description: Số lượng tài khoản tối ưu (Account Rotation & State Management)
---

Để vận hành 4 tài khoản Via an toàn, bạn không thể hardcode (gắn cứng) token vào code. Cần xây dựng một cơ chế Rotation (Xoay vòng) dựa trên database để đảm bảo tải trọng được chia đều và kiểm soát được trạng thái sống/chết của tài khoản. Hiện tại tôi đang có 4 tài khoản trong hệ thống, 4 tài khoản số clone là clone chết bạn xóa đi nhé 


Mục tiêu: Biến Worker thành một tiến trình ngầm (Daemon) chạy độc lập, tự động mô phỏng thời gian nghỉ của người thật.

Thuật toán Round-robin: Viết logic query Supabase để lấy 1 Group UID có last_scraped_at cũ nhất, và 1 account có status = 'active' & daily_count < 10.

Micro Jitter: Thêm hàm setTimeout ngẫu nhiên (30-120 giây) ngay trong luồng thực thi của Worker sau mỗi lần gọi API.

Macro Jitter (Daemon Loop): Viết vòng lặp đệ quy cho Worker. Sau khi cào xong một lô 2-3 bài, hệ thống sẽ "ngủ" một khoảng ngẫu nhiên (ví dụ 45 - 90 phút) trước khi thực hiện lô tiếp theo.