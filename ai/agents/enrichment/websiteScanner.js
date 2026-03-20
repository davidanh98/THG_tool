const axios = require('axios');
const cheerio = require('cheerio');
const database = require('../../../backend/core/data_store/database');

class WebsiteScanner {
    constructor() {
        this.timeout = 10000;
    }

    async scanDomain(url) {
        let targetUrl = url;
        if (!targetUrl.startsWith('http')) {
            targetUrl = 'https://' + targetUrl;
        }

        try {
            const response = await axios.get(targetUrl, {
                timeout: this.timeout,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0 Safari/537.36'
                }
            });

            const html = response.data;
            const $ = cheerio.load(html);

            let result = {
                platform: 'Unknown',
                emails: [],
                socialLinks: []
            };

            if (html.includes('cdn.shopify.com') || html.includes('Shopify.theme')) {
                result.platform = 'Shopify';
            } else if (html.includes('wp-content/plugins/woocommerce') || html.includes('woocommerce-')) {
                result.platform = 'WooCommerce';
            } else if (html.includes('shopbase.com') || html.includes('sbase-')) {
                result.platform = 'ShopBase';
            } else if (html.includes('bigcommerce.com')) {
                result.platform = 'BigCommerce';
            }

            const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
            const rawEmails = html.match(emailRegex) || [];
            result.emails = [...new Set(rawEmails.filter(e =>
                !e.endsWith('.png') && !e.endsWith('.jpg') &&
                !e.includes('sentry') && !e.includes('w3.org')
            ))];

            $('a').each((i, el) => {
                const href = $(el).attr('href');
                if (href && href.includes('facebook.com/')) {
                    if (!href.includes('/sharer/')) {
                        result.socialLinks.push(href);
                    }
                }
            });
            result.socialLinks = [...new Set(result.socialLinks)];
            return result;
        } catch (error) {
            return null;
        }
    }

    async enrichAccountsQueue() {
        const db = database._db;
        if (!db) return;

        try {
            const domains = db.prepare("SELECT id, account_id, value FROM identities WHERE type = 'domain' ORDER BY created_at DESC LIMIT 20").all();
            for (const dom of domains) {
                const acc = db.prepare("SELECT id, category FROM accounts WHERE id = ?").get(dom.account_id);
                if (acc && acc.category && (acc.category.includes('Shopify') || acc.category.includes('WooCommerce'))) {
                    continue;
                }

                const result = await this.scanDomain(dom.value);
                if (result) {
                    if (result.platform !== 'Unknown') {
                        let newCat = acc.category ? acc.category + ' (' + result.platform + ')' : result.platform;
                        if (!acc.category || !acc.category.includes(result.platform)) {
                            db.prepare("UPDATE accounts SET category = ? WHERE id = ?").run(newCat, acc.id);
                        }
                    }

                    for (const em of result.emails) {
                        try {
                            db.prepare("INSERT OR IGNORE INTO identities (account_id, type, value, discovered_from) VALUES (?, 'email', ?, 'WebsiteScanner')").run(acc.id, em);
                        } catch (e) { }
                    }
                }
                await new Promise(r => setTimeout(r, 2000));
            }
        } catch (e) { }
    }
}

module.exports = new WebsiteScanner();
