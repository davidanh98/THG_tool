const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const fs = require('fs');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const accounts = require('../backend/config/scraper_accounts.json');

console.log('╔════════════════════════════════════════════════╗');
console.log('║  🛡️ CÔNG CỤ GIẢI CỨU & LẤY COOKIE TỰ ĐỘNG      ║');
console.log('╚════════════════════════════════════════════════╝');
accounts.forEach((acc, index) => {
    console.log(`[${index}] Email: ${acc.email} | Pass: ${acc.password} | 2FA: ${acc.settings?.['2fa_secret'] || acc['2fa_secret'] || 'N/A'}`);
});

rl.question('\n👉 Bạn muốn giải cứu Nick số mấy? (0-3): ', async (answer) => {
    const idx = parseInt(answer);
    if (isNaN(idx) || idx < 0 || idx >= accounts.length) {
        console.log('❌ Lựa chọn không hợp lệ!');
        process.exit(1);
    }

    const target = accounts[idx];
    console.log(`\n🚀 Đang mở trình duyệt cho: ${target.email}`);
    console.log(`⚠️ HƯỚNG DẪN:`);
    console.log(`1. Trình duyệt sẽ mở công khai. Bạn hãy tự tay điền Email/Pass và 2FA.`);
    console.log(`2. Vượt qua màn hình Checkpoint Facebook yêu cầu.`);
    console.log(`3. Khi bạn vào màn hình chính News Feed (https://www.facebook.com/), tool sẽ tự động gom mã Cookie và in ra màn hình cho bạn!`);
    console.log(`4. Bạn có 5 phút để hoàn thành.\n`);

    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
        // Nếu bạn muốn dùng Proxy VN vào chạy giải cứu thì un-comment đoạn dưới và thay IP vào:
        /* proxy: {
            server: 'http://IP:PORT',
            username: 'user',
            password: 'pwd'
        } */
    });

    const page = await context.newPage();
    await page.goto('https://www.facebook.com/login', { timeout: 60000 });

    // Try to auto-fill to save time
    try {
        await page.fill('input[name="email"]', target.email);
        await page.fill('input[name="pass"]', target.password);
    } catch (e) { }

    let timeout = 300; // 5 minutes (300 seconds)

    const interval = setInterval(async () => {
        try {
            const url = page.url();
            // Nếu đã vượt qua Checkpoint và log-in thành công vào News Feed
            if (url.includes('facebook.com') && !url.includes('/login') && !url.includes('checkpoint')) {
                const nav = await page.$('div[role="navigation"]');
                if (nav) {
                    clearInterval(interval);
                    console.log(`\n✅ ĐÃ GIẢI CỨU THÀNH CÔNG VÀ VÀO ĐƯỢC NEWS FEED!`);

                    const cookies = await context.cookies();
                    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

                    console.log(`\n================================================================`);
                    console.log(`📋 COOKIE MỚI HOÀN CHỈNH CHO FILE scraper_accounts.json:`);
                    console.log(`================================================================`);
                    console.log(cookieStr);
                    console.log(`================================================================\n`);
                    console.log(`👉 Bạn chỉ cần copy chuỗi Cookie chữ xanh đỏ loằng ngoằng ở trên, dán đè vào trường "cookieStr" của acc ${target.email} trong file config là xong!`);

                    await browser.close();
                    process.exit(0);
                }
            }

            timeout -= 2;
            if (timeout <= 0) {
                clearInterval(interval);
                console.log(`\n❌ Đã Hết 5 Phút chưa thấy vào được News Feed! Tool tự đóng.`);
                await browser.close();
                process.exit(1);
            }
        } catch (e) {
            // Browser might be closed manually
        }
    }, 2000);
});
