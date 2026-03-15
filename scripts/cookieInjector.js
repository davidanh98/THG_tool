#!/usr/bin/env node
/**
 * THG Cookie Injector
 * 
 * Converts raw browser cookies (from F12 DevTools) into Playwright session files.
 * This allows the scraper to bypass login entirely using real browser sessions.
 * 
 * HOW TO USE:
 * 1. Open Chrome/Edge → Login Facebook → F12 → Network tab → Refresh
 * 2. Click any request → Headers → Copy the "cookie:" header value
 * 3. Run: node scripts/cookieInjector.js <account_name> "<cookie_string>"
 * 
 * EXAMPLES:
 *   node scripts/cookieInjector.js manyhope0502 "sb=xxx; datr=xxx; c_user=xxx; xs=xxx; fr=xxx"
 *   node scripts/cookieInjector.js mystictarot98 "sb=xxx; datr=xxx; c_user=xxx; xs=xxx; fr=xxx"
 * 
 * Also accepts a User-Agent as 3rd argument (RECOMMENDED for UA sync):
 *   node scripts/cookieInjector.js manyhope0502 "cookies..." "Mozilla/5.0 ..."
 */

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════
// Parse args
// ═══════════════════════════════════════════════════════

const args = process.argv.slice(2);
if (args.length < 2) {
    console.log(`
╔══════════════════════════════════════════════════════╗
║  🍪 THG Cookie Injector                              ║
╚══════════════════════════════════════════════════════╝

Usage:
  node scripts/cookieInjector.js <account_name> "<raw_cookie_string>" ["<user_agent>"]

Example:
  node scripts/cookieInjector.js manyhope0502 "sb=xxx; datr=xxx; c_user=xxx; xs=xxx"

Steps:
  1. Open Chrome → Login Facebook
  2. F12 → Network → Refresh page
  3. Click any request → Headers → Copy "cookie:" value
  4. Run this script with the cookie string
  5. Start the scraper — it will use the injected session
`);
    process.exit(1);
}

const accName = args[0];
const rawCookie = args[1];
const userAgent = args[2] || null;

// ═══════════════════════════════════════════════════════
// Parse cookie string → Playwright format
// ═══════════════════════════════════════════════════════

const HTTPONLY_COOKIES = ['xs', 'fr', 'c_user', 'sb', 'datr', 'wd', 'dpr'];

function parseCookies(raw) {
    return raw.split(';').map(pair => {
        const trimmed = pair.trim();
        if (!trimmed || !trimmed.includes('=')) return null;

        const eqIdx = trimmed.indexOf('=');
        const name = trimmed.substring(0, eqIdx).trim();
        const value = trimmed.substring(eqIdx + 1).trim();

        if (!name || !value) return null;

        return {
            name,
            value,
            domain: '.facebook.com',
            path: '/',
            expires: Math.floor(Date.now() / 1000) + (86400 * 30), // 30 days
            httpOnly: HTTPONLY_COOKIES.includes(name),
            secure: true,
            sameSite: 'None',
        };
    }).filter(Boolean);
}

const cookies = parseCookies(rawCookie);

// ═══════════════════════════════════════════════════════
// Validate
// ═══════════════════════════════════════════════════════

const hasCUser = cookies.some(c => c.name === 'c_user');
const hasXs = cookies.some(c => c.name === 'xs');
const hasDatr = cookies.some(c => c.name === 'datr');

console.log(`\n🍪 Parsed ${cookies.length} cookies for "${accName}"`);
console.log(`   c_user: ${hasCUser ? '✅' : '❌ MISSING (critical!)'}`);
console.log(`   xs:     ${hasXs ? '✅' : '❌ MISSING (critical!)'}`);
console.log(`   datr:   ${hasDatr ? '✅' : '❌ MISSING'}`);

if (!hasCUser || !hasXs) {
    console.error('\n❌ ERROR: Missing c_user or xs cookie!');
    console.error('   These are REQUIRED for Facebook session.');
    console.error('   Make sure you copied the FULL cookie string from F12 DevTools.');
    process.exit(1);
}

// ═══════════════════════════════════════════════════════
// Save session files
// ═══════════════════════════════════════════════════════

const dataDir = path.join(__dirname, '..', 'data');
const sessionsDir = path.join(dataDir, 'sessions');
const backupsDir = path.join(sessionsDir, 'backups');

// Create directories
[dataDir, sessionsDir, backupsDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// 1. Save Playwright storageState format
const ssPath = path.join(sessionsDir, `${accName}_auth.json`);
const storageState = { cookies, origins: [] };
fs.writeFileSync(ssPath, JSON.stringify(storageState, null, 2));
console.log(`\n💾 Session file: ${ssPath}`);

// 2. Save raw cookies JSON (fbScraper.js loads this)
const cookieJsonPath = path.join(dataDir, `fb_cookies_${accName}.json`);
fs.writeFileSync(cookieJsonPath, JSON.stringify(cookies, null, 2));
console.log(`💾 Cookie file:  ${cookieJsonPath}`);

// 3. Backup
const backupPath = path.join(backupsDir, `${accName}_auth.json`);
fs.copyFileSync(ssPath, backupPath);
console.log(`💾 Backup:       ${backupPath}`);

// 4. Save User-Agent if provided
if (userAgent) {
    const uaPath = path.join(dataDir, `ua_${accName}.txt`);
    fs.writeFileSync(uaPath, userAgent);
    console.log(`💾 User-Agent:   ${uaPath}`);
}

console.log(`\n✨ Cookie injection complete for "${accName}"!`);
console.log(`   ${cookies.length} cookies, valid for 30 days`);
if (userAgent) {
    console.log(`   UA synced: ${userAgent.substring(0, 60)}...`);
}
console.log(`\n🚀 Next: Start the scraper — it will use this session automatically.`);
console.log(`   The scraper will skip self-healing and go straight to scraping.`);
