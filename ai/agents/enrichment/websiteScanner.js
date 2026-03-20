const axios = require('axios');
const cheerio = require('cheerio');
const database = require('../../../backend/core/data_store/database');

/**
 * Website Scanner Agent
 * 
 * Mục đích: Nhận một danh sách các domain (từ bảng identities), cào trang chủ 
 * để phát hiện nền tảng E-commerce (Shopify, WooCommerce, Base...) và 
 * bóc tách Email support, FB Page nhằm làm giàu dữ liệu cho Account 360 View.
 */
class WebsiteScanner {
    constructor() {
        this.timeout = 10000; // 10s
    }

    /**
     * Bắt đầu quét một URL
     * @param {string} url Dạng abc.com hoặc https://abc.com 
     * @returns {Promise<Object>} Object chứa thông tin trích xuất
     */
    async scanDomain(url) {
        let targetUrl = url;
        if (!targetUrl.startsWith('http')) {
            targetUrl = 'https://' + targetUrl;
        }

        try {
            console.log(`[WebsiteScanner] Chui vào URL: ${targetUrl}...`);
            const response = await axios.get(targetUrl, {
                timeout: this.timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            const html = response.data;
            const $ = cheerio.load(html);
            const textContent = $('body').text();

            let result = {
                platform: 'Unknown',
                emails: [],
                socialLinks: []
            };

            // 1. Nhận diện Platform (Tech Stack)
            if (html.includes('cdn.shopify.com') || html.includes('Shopify.theme')) {
                result.platform = 'Shopify';
            } else if (html.includes('wp-content/plugins/woocommerce') || html.includes('woocommerce-')) {
                result.platform = 'WooCommerce';
            } else if (html.includes('shopbase.com') || html.includes('sbase-')) {
                result.platform = 'ShopBase';
            } else if (html.includes('bigcommerce.com')) {
                result.platform = 'BigCommerce';
            }

            // 2. Tìm kiếm Email Support
            // Regex cơ bản tìm dạng email
            const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
            const rawEmails = html.match(emailRegex) || [];
            // Lọc ra email thật (bỏ các ảnh như .png@2x, sentry)
            result.emails = [...new Set(rawEmails.filter(e =>
                !e.endsWith('.png') && !e.endsWith('.jpg') &&
                !e.includes('sentry') && !e.includes('w3.org')
            ))];

            // 3. Tìm Social Links (đặc biệt là Facebook Page)
            $('a').each((i, el) => {
                const href = $(el).attr('href');
                if (href && href.includes('facebook.com/')) {
                    if (!href.includes('/sharer/')) {
                        result.socialLinks.push(href);
                    }
                }
            });
            result.socialLinks = [...new Set(result.socialLinks)];

            console.log(`[WebsiteScanner] Xong ${targetUrl} -> Platform: ${result.platform}, Emails: ${result.emails.length}`);
            return result;

        } catch (error) {
            console.error(`[WebsiteScanner] Lỗi quét ${targetUrl}:`, error.message);
            return null; // Silent fail
        }
    }

    /**
     * Quét các domains mồ côi (chưa được quét) trong DB
     */
    async enrichAccountsQueue() {
        console.log('[WebsiteScanner] Khởi động Enrichment Queue...');

        // Cần lấy danh sách identities loại 'domain'
        // Tạm thời mình lấy tạm 1 số record, thực ra ta cần truy vấn DB: database.getUnscannedDomains()
        // Để giả lập, chạy query trực tiếp qua db instance
        const db = require('../../../backend/core/data_store/database')._db;

        if (!db) {
            console.error("[WebsiteScanner] Không gắn được DB instance");
            return;
        }

        try {
            // Lấy 10 domains chưa được gán nhãn tech stack (nếu ta lưu tech stack vào bảng account, ta sẽ check account)
            // Lấy mọi identities loại domain
            const domains = db.prepare(`SELECT id, account_id, value FROM identities WHERE type = 'domain' ORDER BY created_at DESC LIMIT 20`).all();

            for (const dom of domains) {
                // Kiểm tra xem Account này đã biết platform chưa
                const acc = db.prepare(`SELECT id, category FROM accounts WHERE id = ?`).get(dom.account_id);
                if (acc && acc.category && (acc.category.includes('Shopify') || acc.category.includes('WooCommerce'))) {
                    continue; // Acc này đã được cào
                }

                const result = await this.scanDomain(dom.value);
                if (result) {
                    // Update category/platform cho Account
                    if (result.platform !== 'Unknown') {
                        let newCat = acc.category ? `${acc.category} (${result.platform})` : result.platform;
                        // Avoid duplication
                        if (!acc.category || !acc.category.includes(result.platform)) {
                            db.prepare(`UPDATE accounts SET category = ? WHERE id = ?`).run(newCat, acc.id);
                        }
                    }

                    // Lưu Emails nhặt được
                    for (const em of result.emails) {
                        try {
                            db.prepare(`
                                INSERT OR IGNORE INTO identities (account_id, type, value, discovered_from) 
                                VALUES (?, 'email', ?, 'WebsiteScanner')
                            `).run(acc.id, em);
                        } catch (e) { } // Ignore constraint
                    }
                }

                // Sleep 2s to not get blocked
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e) {
            console.error('[WebsiteScanner] Lỗi chạy Queue:', e);
        }
    }
}

module.exports = new WebsiteScanner();
