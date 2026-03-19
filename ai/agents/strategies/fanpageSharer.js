const { chromium } = require('playwright-extra');
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);

const accountManager = require('../accountManager');
const db = require('../../../backend/core/data_store/database');
const config = require('../../../backend/config');
const aiProvider = require('../../aiProvider');

// Time limits
const MAX_RUN_TIME = 3 * 60 * 1000; // 3 minutes safety timeout

async function runFanpageFarm() {
    console.log(`\n[FanpageSharer] 🔄 Bắt đầu chiến dịch Nuôi Nick (Account Farming)...`);

    // Pick an account (from the 4 main Sales configs)
    const account = accountManager.getNextAccount();
    if (!account) {
        console.log(`[FanpageSharer] ❌ Không có account nào sẵn sàng để Farm.`);
        return { success: false, reason: "No ready accounts" };
    }

    const sessionPath = accountManager.getSessionPath(account);
    console.log(`[FanpageSharer] 🧑‍💻 Sử dụng Account VIP: ${account.email} | Target: ${config.THG_FANPAGE}`);

    let browser;
    try {
        const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Farm Timeout Limit Exceeded')), MAX_RUN_TIME)
        );

        const farmPromise = (async () => {
            browser = await chromium.launch({
                headless: true, // Run invisibly 
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });

            const context = await browser.newContext({
                storageState: sessionPath,
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport: { width: 1280, height: 720 },
                locale: 'vi-VN'
            });

            const page = await context.newPage();
            page.setDefaultTimeout(30000);

            console.log(`[FanpageSharer] 🌐 Đang truy cập THG Fanpage: ${config.THG_FANPAGE}...`);
            await page.goto(config.THG_FANPAGE, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000 + Math.random() * 2000);

            // Xử lý nút X tắt popup Login/Register (chống văng checkpoint nếu chưa login hoàn toàn)
            try {
                const closeBtnLine = await page.$('div[aria-label="Đóng"]');
                if (closeBtnLine && await closeBtnLine.isVisible()) await closeBtnLine.click();
            } catch (e) { }

            // Scroll ngẫu nhiên như người xem facebook
            for (let i = 0; i < 3; i++) {
                await page.mouse.wheel(0, 300 + Math.random() * 200);
                await page.waitForTimeout(1000 + Math.random() * 1500);
            }

            console.log(`[FanpageSharer] 🏷️ Đang lấy thông tin bài post mới nhất trên page...`);

            // Tìm các div có class role="article" hoặc có thuộc tính data-ad-rendering-role="story" (các post)
            // Strategy: Lấy text của bài post đầu tiên ném cho AI đọc
            const posts = await page.$$('div[role="article"]');
            if (!posts || posts.length === 0) {
                console.log(`[FanpageSharer] ❌ Khng tìm thấy bài post nào trên Fanpage.`);
                await browser.close();
                return { success: false, reason: "No posts found on fanpage" };
            }

            const latestPost = posts[0];
            const postText = await latestPost.innerText();
            const cleanText = postText.replace(/\n/g, ' ').substring(0, 400); // Lấy 400 chữ đầu

            console.log(`[FanpageSharer] 🧠 Gửi AI viết caption share cho bài viết này (Nội dung: ${cleanText.substring(0, 50)}...)`);

            // Call Gemini/Ollama to write a share caption
            const aiPrompt = `Bạn là một Salesman của THG Fulfill (Logistics chuyên tuyến Mỹ). 
Hãy viết MỘT câu cảm thán (caption) ngắn gọn (dưới 15 chữ), vô cùng tự tin và tự nhiên để chia sẻ bài viết sau của công ty về Facebook cá nhân của bạn.
Ví dụ: "Bảng giá mới tháng này nét quá!", "Ae seller vít camp đi THG lo kho bãi nha", "Dịch vụ tận tâm số 1 luôn ạ", "Ai cần ship Mỹ cứ ới em nhé".
Chỉ được trả ra đúng Câu Caption, không được kèm icon hay dư thừa. Tự nhiên như người thật share bài.
Nội dung bài viết trên Fanpage:
"${cleanText}"
            `;

            let caption = "Dịch vụ Fulfillment chuẩn chỉ cho ae seller đây!";
            try {
                const aiResponse = await aiProvider.analyzePost(aiPrompt);
                // Reuse analyzePost just to pass prompt through to LLM for a free-form text response
                if (aiResponse && aiResponse.raw) caption = aiResponse.raw.trim().replace(/^"|"$/g, '');
            } catch (e) {
                console.log(`[FanpageSharer] ⚠️ Lỗi AI, dùng caption mặc định: ${caption}`);
            }
            console.log(`[FanpageSharer] ✍️ AI Caption sinh ra: "${caption}"`);

            // Now, we need to click "Share" (Chia sẻ)
            console.log(`[FanpageSharer] 🖱️ Đang bấm nút Chia Sẻ bài đầu tiên...`);
            const shareButtons = await latestPost.$$('div[aria-label="Gửi cái này cho bạn bè hoặc đăng lên dòng thời gian của bạn."], div[aria-label="Chia sẻ"], i[data-visualcompletion="css-img"]'); // multiple fallbacks for FB's nasty DOM

            let shareClicked = false;
            for (const btn of shareButtons) {
                try {
                    await btn.click();
                    await page.waitForTimeout(2000);
                    // Check if dropdown opened (looking for "Chia sẻ lên trang cá nhân")
                    const feedOption = await page.$('span:text("Chia sẻ lên trang cá nhân")');
                    const feedOptionEn = await page.$('span:text("Share to Feed")');
                    if (feedOption || feedOptionEn) {
                        shareClicked = true;
                        if (feedOption) await feedOption.click();
                        else if (feedOptionEn) await feedOptionEn.click();
                        break;
                    }
                } catch (e) { }
            }

            if (!shareClicked) {
                // Try a more explicit approach
                const textSearch = await page.$('text="Chia sẻ"');
                if (textSearch) {
                    await textSearch.click();
                    await page.waitForTimeout(2000);
                    const feedOption = await page.$('span:text("Chia sẻ lên trang cá nhân")');
                    if (feedOption) {
                        shareClicked = true;
                        await feedOption.click();
                    }
                }
            }

            if (!shareClicked) {
                console.log(`[FanpageSharer] ❌ Không thể tìm thấy nút Share. Thuật toán UI Facebook bị lỗi / Đổi DOM.`);
                await browser.close();
                return { success: false, reason: "Share button not found" };
            }

            await page.waitForTimeout(2000);

            // Wait for the modal "Tạo bài viết" or "Chia sẻ"
            console.log(`[FanpageSharer] ⌨️ Đang nhập caption AI vào ô text...`);
            await page.keyboard.type(caption, { delay: 100 });
            await page.waitForTimeout(1000);

            // Bấm Nút Đăng (Publish/Post)
            console.log(`[FanpageSharer] 🚀 Đang Submit bài Share...`);
            const publishBtn = await page.$('div[aria-label="Đăng"], div[aria-label="Post"]');
            if (publishBtn) {
                await publishBtn.click();
                await page.waitForTimeout(5000); // Đợi Facebook xử lý XHR lưu post lên db
                console.log(`[FanpageSharer] ✅ Bài Post đã được Farm thành công trên tường của ${account.email}.`);
            } else {
                console.log(`[FanpageSharer] ⚠️ Không tìm thấy nút Đăng. Simulation hoàn tất.`);
            }

            // Ghi nhận thành công + Trust Score
            accountManager.reportSuccess(account.id || account.email, 1);

            // Lưu log activity
            db.db.prepare(`
                INSERT INTO social_activity_log (account_email, action_type, target_url, metadata)
                VALUES (?, ?, ?, ?)
            `).run(
                account.email,
                'FANPAGE_SHARE',
                config.THG_FANPAGE,
                JSON.stringify({ caption: caption, time: new Date().toISOString() })
            );

            await browser.close();
            return { success: true, email: account.email, caption: caption };
        })();

        return await Promise.race([farmPromise, timeoutPromise]);
    } catch (err) {
        if (browser) await browser.close();
        console.error(`[FanpageSharer] LỖI FATAL:`, err);
        accountManager.reportCheckpoint(account.id || account.email);
        return { success: false, reason: err.message };
    }
}

module.exports = {
    runFanpageFarm
};
