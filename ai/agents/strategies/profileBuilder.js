/**
 * 🎨 Profile Builder — Auto-setup VIP account profiles
 * 
 * Updates bio/intro and cover photo for VIP accounts on Facebook.
 * Runs once per account (tracks completion via DB flag).
 * 
 * @module agent/strategies/profileBuilder
 */
'use strict';

const database = require('../../../backend/core/data_store/database');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'data');
const ASSETS_DIR = path.join(DATA_DIR, 'assets', 'images', 'general');

// ─── Bio Samples ─────────────────────────────────────────────────────────────
const BIO_SAMPLES = [
    `✔️ Fulfill POD/Dropshiping\n✔️ Express VN, CN->Wordwide\nGiá tốt-Ship nhanh-Fulfill chuyên nghiệp`,
    `📦Kho US - Tracking 48h - Giá tốt📦\nFulfill đơn hàng chuyên nghiệp – Tối ưu lợi nhuận`,
];

/**
 * Check if profile has already been set up for this account
 */
function isProfileSetup(accountEmail) {
    try {
        // Ensure column exists
        try {
            database.db.exec(`ALTER TABLE fb_accounts ADD COLUMN profile_setup_done INTEGER DEFAULT 0`);
        } catch { /* column already exists */ }

        const row = database.db.prepare(
            `SELECT profile_setup_done FROM fb_accounts WHERE email = ?`
        ).get(accountEmail);
        return row && row.profile_setup_done === 1;
    } catch {
        return false;
    }
}

/**
 * Mark profile as set up
 */
function markProfileDone(accountEmail) {
    try {
        database.db.prepare(
            `UPDATE fb_accounts SET profile_setup_done = 1 WHERE email = ?`
        ).run(accountEmail);
    } catch (e) {
        console.warn(`[ProfileBuilder] ⚠️ Could not mark profile done: ${e.message}`);
    }
}

/**
 * Update the bio/intro on Facebook profile via m.facebook.com
 * @param {Page} page - Playwright page (authenticated)
 * @param {string} bio - Bio text to set
 * @param {string} tag - Log tag
 * @returns {boolean}
 */
async function updateBio(page, bio, tag) {
    try {
        console.log(`${tag} 📝 Navigating to profile edit...`);
        await page.goto('https://m.facebook.com/profile', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Try to find "Edit profile" / "Chỉnh sửa trang cá nhân"
        const editBtn = await page.evaluate(() => {
            for (const el of document.querySelectorAll('a, button, div[role="button"], span')) {
                const text = (el.innerText || el.textContent || '').toLowerCase();
                if (/edit profile|chỉnh sửa|edit bio|sửa tiểu sử/i.test(text)) {
                    el.click();
                    return true;
                }
            }
            return false;
        });

        if (!editBtn) {
            // Try direct URL for bio edit
            await page.goto('https://m.facebook.com/profile/edit/bio/', { waitUntil: 'domcontentloaded', timeout: 20000 });
        }
        await page.waitForTimeout(3000);

        // Find the bio textarea
        const textarea = await page.$('textarea') || await page.$('div[contenteditable="true"]');
        if (textarea) {
            await textarea.click();
            await page.waitForTimeout(500);
            // Clear existing content
            await page.keyboard.press('Control+a');
            await page.waitForTimeout(200);
            await page.keyboard.type(bio, { delay: 30 });
            await page.waitForTimeout(1000);

            // Save
            const saved = await page.evaluate(() => {
                for (const el of document.querySelectorAll('button, div[role="button"], input[type="submit"]')) {
                    const text = (el.innerText || el.value || '').toLowerCase();
                    if (/save|lưu|xong|done|cập nhật|update/i.test(text)) {
                        el.click();
                        return true;
                    }
                }
                return false;
            });

            if (saved) {
                await page.waitForTimeout(3000);
                console.log(`${tag} ✅ Bio updated!`);
                return true;
            }
        }

        console.log(`${tag} ⚠️ Could not find bio edit form`);
        return false;
    } catch (e) {
        console.warn(`${tag} ❌ Bio update failed: ${e.message}`);
        return false;
    }
}

/**
 * Update cover photo on Facebook profile
 * @param {Page} page - Playwright page (authenticated)
 * @param {string} imagePath - Absolute path to cover photo
 * @param {string} tag - Log tag
 * @returns {boolean}
 */
async function updateCoverPhoto(page, imagePath, tag) {
    if (!imagePath || !fs.existsSync(imagePath)) {
        console.log(`${tag} ⚠️ No cover photo image available`);
        return false;
    }

    try {
        console.log(`${tag} 🖼️ Updating cover photo...`);
        await page.goto('https://m.facebook.com/profile', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForTimeout(3000);

        // Try to click on cover photo area / "Add cover photo"
        const clicked = await page.evaluate(() => {
            for (const el of document.querySelectorAll('a, div[role="button"], span')) {
                const text = (el.innerText || el.textContent || '').toLowerCase();
                if (/add cover|thêm ảnh bìa|update cover|chỉnh sửa ảnh bìa|edit cover/i.test(text)) {
                    el.click();
                    return true;
                }
            }
            return false;
        });

        if (clicked) {
            await page.waitForTimeout(2000);

            // Click "Upload photo"
            await page.evaluate(() => {
                for (const el of document.querySelectorAll('a, div[role="button"], span, button')) {
                    const text = (el.innerText || el.textContent || '').toLowerCase();
                    if (/upload|tải lên|chọn ảnh|choose photo/i.test(text)) {
                        el.click();
                        return true;
                    }
                }
            });
            await page.waitForTimeout(1000);

            // Upload file
            const fileInput = await page.$('input[type="file"]');
            if (fileInput) {
                await fileInput.setInputFiles(imagePath);
                await page.waitForTimeout(5000);

                // Save
                await page.evaluate(() => {
                    for (const el of document.querySelectorAll('button, div[role="button"]')) {
                        const text = (el.innerText || '').toLowerCase();
                        if (/save|lưu|xong|done/i.test(text)) { el.click(); return true; }
                    }
                });
                await page.waitForTimeout(3000);
                console.log(`${tag} ✅ Cover photo updated!`);
                return true;
            }
        }

        console.log(`${tag} ⚠️ Cover photo update skipped (button not found)`);
        return false;
    } catch (e) {
        console.warn(`${tag} ❌ Cover photo failed: ${e.message}`);
        return false;
    }
}

/**
 * Full profile setup — call this once per account
 * @param {Page} page - Playwright page (authenticated)
 * @param {object} account - Account object with email, sales_name
 * @returns {{ bioUpdated: boolean, coverUpdated: boolean }}
 */
async function ensureProfileSetup(page, account) {
    const tag = `[ProfileBuilder:${account.email.split('@')[0]}]`;

    if (isProfileSetup(account.email)) {
        console.log(`${tag} ✅ Profile already set up — skipping`);
        return { bioUpdated: false, coverUpdated: false, skipped: true };
    }

    console.log(`${tag} 🎨 Setting up profile...`);

    // Pick a random bio sample
    const bio = BIO_SAMPLES[Math.floor(Math.random() * BIO_SAMPLES.length)];

    // Find cover photo from general assets
    let coverPath = null;
    if (fs.existsSync(ASSETS_DIR)) {
        const files = fs.readdirSync(ASSETS_DIR).filter(f => f.match(/\.(jpg|jpeg|png|gif|webp)$/i));
        if (files.length > 0) coverPath = path.join(ASSETS_DIR, files[0]);
    }

    const bioUpdated = await updateBio(page, bio, tag);
    const coverUpdated = await updateCoverPhoto(page, coverPath, tag);

    // Mark as done regardless (don't retry endlessly)
    markProfileDone(account.email);
    console.log(`${tag} 🏁 Profile setup complete (bio: ${bioUpdated ? '✅' : '❌'}, cover: ${coverUpdated ? '✅' : '❌'})`);

    return { bioUpdated, coverUpdated, skipped: false };
}

module.exports = {
    ensureProfileSetup,
    updateBio,
    updateCoverPhoto,
    BIO_SAMPLES,
};
