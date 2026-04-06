/**
 * FB Self-Heal — Session Health Check
 *
 * Checks if a Playwright page has a valid, non-checkpointed Facebook session.
 * Used by dispatcher.js before running squad missions.
 */

'use strict';

/**
 * Check if a Facebook session is healthy (logged in, no checkpoint)
 * @param {import('playwright').Page} page - Playwright page (already on facebook.com)
 * @returns {Promise<boolean>}
 */
async function isSessionHealthy(page) {
    try {
        const url = page.url();

        // Explicit failure signals
        if (url.includes('/login') || url.includes('checkpoint') || url.includes('/recover')) {
            return false;
        }

        // Check for logged-in nav bar
        const hasNav = await page.$(
            'div[role="navigation"], [aria-label="Facebook"], div[data-pagelet="LeftRail"]'
        ).catch(() => null);

        return !!hasNav;
    } catch {
        return false;
    }
}

module.exports = { isSessionHealthy };
