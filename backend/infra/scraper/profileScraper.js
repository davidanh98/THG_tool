/**
 * Profile Scraper — Resolve Business Identity from FB Profile
 * 
 * @module scraper/profileScraper
 */
const { delay, FB_URL } = require('./browserManager');

/**
 * Scrapes a Facebook profile to find business signals (Website, Email, Pages)
 * @param {import('playwright').Page} page
 * @param {string} profileUrl
 * @returns {Promise<Object>} Identity object
 */
async function resolveProfile(page, profileUrl) {
    if (!profileUrl || !profileUrl.includes('facebook.com')) {
        return { ok: false, error: 'Invalid profile URL' };
    }

    console.log(`[ProfileScraper] 🔍 Resolving identity: ${profileUrl}`);

    try {
        // Navigate to the main profile page
        await page.goto(profileUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await delay(3000);

        // Check for checkpoints/login redirect
        const landedUrl = page.url();
        if (landedUrl.includes('checkpoint') || landedUrl.includes('/login')) {
            return { ok: false, error: 'Session restricted or checkpoint' };
        }

        // 1. Extract Intro section
        const introText = await page.evaluate(() => {
            // Facebook varies selectors often, so we look for common "Intro" container patterns
            const containers = Array.from(document.querySelectorAll('div[role="complementary"], div.x1n2onr6'));
            for (const c of containers) {
                if (c.innerText.toLowerCase().includes('intro') || c.innerText.toLowerCase().includes('tiểu sử')) {
                    return c.innerText;
                }
            }
            // Fallback: check prominent sidebar divs
            return document.querySelector('div.x1iyjqo2.x1pi30yw')?.innerText || '';
        });

        // 2. Extract Links (Websites/Pages)
        const links = await page.evaluate(() => {
            const results = [];
            const anchors = Array.from(document.querySelectorAll('a[href*="facebook.com"], a[target="_blank"]'));
            for (const a of anchors) {
                const href = a.href;
                const text = a.innerText;
                if (!href) continue;

                // Exclude common FB navigation links
                if (href.includes('/groups/') || href.includes('/friends/') || href.includes('/photos/')) continue;
                if (href === 'https://www.facebook.com/' || href.includes('facebook.com/home.php')) continue;

                results.push({ url: href, text: text });
            }
            return results;
        });

        // 3. Regex Extraction
        const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
        const phoneRegex = /(?:\+84|0)(?:\s|\.)?([35789])(?:\s|\.)?([0-9]{2})(?:\s|\.)?([0-9]{3})(?:\s|\.)?([0-9]{3})/g;
        const websiteRegex = /(https?:\/\/[^\s]+)/g;

        const emails = introText.match(emailRegex) || [];
        const phones = introText.match(phoneRegex) || [];

        const possibleWebsites = (introText.match(websiteRegex) || [])
            .filter(w => !w.includes('facebook.com') && !w.includes('messenger.com'));

        const relatedPages = links.filter(l => {
            const isFB = l.url.includes('facebook.com');
            const hasPageId = l.url.includes('/?id=') || l.url.includes('/pages/');
            const notProfile = !l.url.includes('/profile.php') && l.url.split('/').length <= 5;
            return isFB && (hasPageId || notProfile) && !l.url.includes('/user/');
        });

        const result = {
            ok: true,
            extracted_at: new Date().toISOString(),
            intro: introText.substring(0, 500),
            emails: [...new Set(emails)],
            phones: [...new Set(phones)],
            websites: [...new Set(possibleWebsites)],
            pages: [...new Set(relatedPages.map(p => p.url))],
            raw_links: links.slice(0, 10)
        };

        console.log(`[ProfileScraper] ✅ Resolved: ${result.emails.length} emails, ${result.pages.length} pages`);
        return result;

    } catch (err) {
        console.error(`[ProfileScraper] ❌ Error: ${err.message}`);
        return { ok: false, error: err.message };
    }
}

module.exports = { resolveProfile };
