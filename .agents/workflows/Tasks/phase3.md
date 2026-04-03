---
description: Logic Query lấy tài khoản (Round-robin theo thời gian) Khi Worker khởi chạy, nó sẽ tìm tài khoản thỏa mãn điều kiện: "Đang active", "chưa đạt giới hạn ngày", và "đã nghỉ đủ lâu".
---

// Ví dụ Query bằng Supabase JS Client
const getAvailableAccount = async () => {
  const { data, error } = await supabase
    .from('fb_accounts')
    .select('*')
    .eq('status', 'active')
    .lt('daily_count', 10)
    .order('last_used_at', { ascending: true }) // Lấy acc lâu nhất chưa dùng
    .limit(1)
    .single();

  if (error || !data) throw new Error("Không có tài khoản khả dụng");
  return data;
}


2. Triển khai kỹ thuật (Node.js + GraphQL/Mobile API)
Đây là phần lõi. Thay vì cào HTML, bạn giả lập request của Facebook App. Facebook App sử dụng giao thức GraphQL với endpoint nội bộ.

A. Cách lấy Payload chuẩn (Reverse Engineering)

Bạn đăng nhập 1 tài khoản phụ vào trình duyệt web (hoặc giả lập Android).

Bật tab Network trong DevTools (F12) -> Lọc chữ graphql.

Vào một Group bất kỳ, kéo xuống để load bài viết. Bạn sẽ thấy một request POST bắn đến https://www.facebook.com/api/graphql/ (hoặc graph.facebook.com nếu trên mobile).

Copy toàn bộ Headers (đặc biệt là cookie, X-FB-LSD, fb_dtsg) và Payload (chứa doc_id hoặc fb_api_req_friendly_name đại diện cho hàm lấy danh sách bài viết Group).

B. Triển khai bằng Axios (Node.js)
Bạn thiết lập một HTTP Client cấu hình sẵn các thông số để "đóng giả" một thiết bị hợp lệ.

JavaScript
const axios = require('axios');

async function scrapeGroupPosts(account, groupUid) {
  // Payload này thay đổi tùy theo doc_id thực tế bạn sniff được
  const graphqlPayload = {
    doc_id: "123456789012345", // ID của query lấy bài viết Group
    variables: JSON.stringify({
      "groupID": groupUid,
      "cursor": null // Truyền cursor nếu muốn lấy trang tiếp theo
    }),
    fb_dtsg: account.fb_dtsg_token // Lấy từ DB
  };

  try {
    const response = await axios.post(
      'https://www.facebook.com/api/graphql/', 
      new URLSearchParams(graphqlPayload).toString(), // FB thường nhận x-www-form-urlencoded
      {
        headers: {
          'Cookie': account.cookie,
          'User-Agent': account.user_agent, // User-Agent Mobile App
          'Sec-Fetch-Site': 'same-origin',
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Forwarded-For': account.proxy_ip // Fake qua IP Proxy của acc
        }
      }
    );

    // Bóc tách JSON trả về
    const rawData = response.data;
    // Bóc tách text, metadata, thời gian đăng để đẩy vào Intelligence System
    return extractValuableData(rawData); 

  } catch (error) {
    if (error.response && error.response.status === 401) {
       // Xử lý báo lỗi về DB để đổi status account thành checkpoint
       await updateAccountStatus(account.id, 'checkpoint');
    }
  }
}
3. Cơ chế "Ngủ ngẫu nhiên" (Randomized Jitter)
Bạn cần 2 cấp độ "Ngủ": Sleep Micro (giữa các request trong 1 luồng) và Jitter Macro (làm xáo trộn lịch chạy Cronjob).

A. Sleep Micro (Trong lúc đang cào)
Trước khi gọi API hoặc sau khi gọi xong 1 Group, Agent phải "nghỉ mệt" mô phỏng con người đọc bài.

JavaScript
// Hàm tiện ích tạo độ trễ ngẫu nhiên
const randomDelay = (minSeconds, maxSeconds) => {
  const ms = Math.floor(Math.random() * (maxSeconds - minSeconds + 1) + minSeconds) * 1000;
  console.log(`[Jitter] Hệ thống đang ngủ ${ms / 1000} giây...`);
  return new Promise(resolve => setTimeout(resolve, ms));
};

// Luồng chạy thực tế
async function runWorker(groupUid) {
  const account = await getAvailableAccount();
  
  await scrapeGroupPosts(account, groupUid);
  await updateLastUsed(account.id); // Cập nhật DB
  
  // Nghỉ 30 đến 120 giây trước khi làm task tiếp theo
  await randomDelay(30, 120); 
}
B. Jitter Macro (Cronjob Động)
Nếu bạn dùng node-cron, thay vì set 0 8 * * * (chạy đúng 8h sáng), bạn thiết lập một worker chạy liên tục nhưng tự tính toán khoảng thời gian cho lần chạy tiếp theo.

JavaScript
// Thay vì dùng Cron cố định, dùng Recursive setTimeout để tạo lịch trình "biến thiên"
async function daemonProcess() {
  while (true) {
    console.log("[Daemon] Bắt đầu quét lô bài viết mới...");
    
    // Lấy 1-2 Group UID để xử lý
    const targetGroups = ["group_id_1", "group_id_2"];
    for (const group of targetGroups) {
        await runWorker(group);
    }

    // Agent đã cào xong 1 lô (khoảng 2-3 bài).
    // Nghỉ từ 45 phút đến 90 phút rồi mới quét lô tiếp theo
    // 45 phút = 2700 giây, 90 phút = 5400 giây
    const nextRunMs = Math.floor(Math.random() * (5400 - 2700 + 1) + 2700) * 1000;
    
    console.log(`[Daemon] Hoàn thành. Chu kỳ quét tiếp theo sau ${nextRunMs / 60000} phút.`);
    await new Promise(resolve => setTimeout(resolve, nextRunMs));
  }
}

// Kích hoạt Daemon
daemonProcess();