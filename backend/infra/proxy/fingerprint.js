/**
 * THG Multi-Agent System — Browser Fingerprint Rotation v2
 * 
 * Generates realistic browser fingerprints to avoid detection.
 * Each scraping session gets a unique combination of:
 * - User-Agent (Chrome 131-134, Firefox 133+, Edge, Safari)
 * - Viewport size
 * - Timezone + Language (matched)
 * - Platform + WebGL renderer (consistent pairs)
 * 
 * v2 improvements:
 * - Modern Chrome 131-134 (2025-2026) UAs
 * - Mobile UAs for mobile-mode scraping
 * - Updated WebGL renderers (RTX 4060, Intel Arc, Apple M3)
 * - Linux UAs for VPS patterns
 * 
 * @module proxy/fingerprint
 */

// ═══════════════════════════════════════════════════════
// Pre-built fingerprint pool — updated Q1 2026
// ═══════════════════════════════════════════════════════

const USER_AGENTS = [
    // Chrome on Windows (latest)
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    // Chrome on Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    // Chrome on Linux (VPS pattern)
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
    // Firefox on Windows
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0',
    // Edge
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36 Edg/134.0.0.0',
    // Safari on Mac
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15',
];

const MOBILE_USER_AGENTS = [
    // Chrome on Android
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 14; SM-S926B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36',
    'Mozilla/5.0 (Linux; Android 13; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Mobile Safari/537.36',
    // Safari on iPhone
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
];

const VIEWPORTS = [
    { width: 1920, height: 1080 },  // Full HD
    { width: 1536, height: 864 },   // Laptop
    { width: 1440, height: 900 },   // MacBook Air
    { width: 1366, height: 768 },   // Common laptop
    { width: 1280, height: 720 },   // HD
    { width: 2560, height: 1440 },  // QHD
    { width: 1680, height: 1050 },  // MacBook Pro
    { width: 1920, height: 1200 },  // WUXGA
];

const MOBILE_VIEWPORTS = [
    { width: 412, height: 915, isMobile: true },   // Pixel 8
    { width: 393, height: 852, isMobile: true },    // iPhone 15
    { width: 360, height: 800, isMobile: true },    // Samsung Galaxy
    { width: 414, height: 896, isMobile: true },    // iPhone 11
];

const TIMEZONES = [
    'America/New_York',      // US East
    'America/Chicago',       // US Central
    'America/Denver',        // US Mountain
    'America/Los_Angeles',   // US West
    'America/Houston',       // US Texas
    'Asia/Ho_Chi_Minh',      // VN
    'Asia/Bangkok',          // Thailand
    'Asia/Singapore',        // Singapore
];

const LANGUAGES = [
    'en-US,en;q=0.9',
    'en-US,en;q=0.9,vi;q=0.8',
    'vi-VN,vi;q=0.9,en;q=0.8',
    'en-GB,en;q=0.9',
    'en-US,en;q=0.9,zh;q=0.8',
];

const PLATFORMS = ['Win32', 'MacIntel', 'Linux x86_64'];

// WebGL renderers — matched to platform for consistency
const WEBGL_RENDERERS = {
    Win32: [
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'ANGLE (Intel, Intel(R) UHD Graphics 770 Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'ANGLE (Intel, Intel(R) Arc(TM) A770 Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
        'ANGLE (AMD, AMD Radeon RX 7600 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    ],
    MacIntel: [
        'ANGLE (Apple, Apple M3 Pro, OpenGL 4.1)',
        'ANGLE (Apple, Apple M2, OpenGL 4.1)',
        'ANGLE (Apple, Apple M1, OpenGL 4.1)',
        'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, OpenGL 4.1)',
    ],
    'Linux x86_64': [
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.5)',
        'Mesa Intel(R) UHD Graphics 630 (CFL GT2)',
        'ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.5)',
    ],
};

const WEBGL_VENDORS = {
    Win32: 'Google Inc. (NVIDIA)',
    MacIntel: 'Google Inc. (Apple)',
    'Linux x86_64': 'Google Inc. (NVIDIA)',
};

// ═══════════════════════════════════════════════════════
// Random helpers
// ═══════════════════════════════════════════════════════

function randomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Deterministic hash for account-based fingerprint consistency
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash = Math.abs(hash | 0);
    }
    return hash;
}

// ═══════════════════════════════════════════════════════
// Generate fingerprint
// ═══════════════════════════════════════════════════════

/**
 * Generate a browser fingerprint for a scraping session.
 * When accountId is provided, generates DETERMINISTIC fingerprint (same every time for same account).
 * Without accountId, generates random fingerprint.
 * 
 * @param {Object} [options]
 * @param {string}  [options.region]    - Target region ('US' or 'VN')
 * @param {string}  [options.accountId] - Account email for deterministic fingerprint
 * @param {boolean} [options.mobile]    - Generate mobile fingerprint
 * @returns {Object} Fingerprint with userAgent, viewport, timezone, etc.
 */
function generateFingerprint(options = {}) {
    const pick = options.accountId
        ? (arr) => arr[simpleHash(options.accountId) % arr.length]
        : randomItem;

    // Select UA pool based on mobile flag
    const uaPool = options.mobile ? MOBILE_USER_AGENTS : USER_AGENTS;
    const vpPool = options.mobile ? MOBILE_VIEWPORTS : VIEWPORTS;

    const userAgent = pick(uaPool);
    const viewport = pick(vpPool);

    // Match timezone to region
    let timezone;
    if (options.region === 'US') {
        timezone = pick(TIMEZONES.filter(tz => tz.startsWith('America/')));
    } else if (options.region === 'VN') {
        timezone = 'Asia/Ho_Chi_Minh';
    } else {
        timezone = pick(TIMEZONES);
    }

    // Match language to region
    let language;
    if (options.region === 'VN') {
        language = 'vi-VN,vi;q=0.9,en;q=0.8';
    } else {
        language = pick(LANGUAGES);
    }

    // Platform based on user agent — CONSISTENT matching
    let platform;
    if (userAgent.includes('Macintosh') || userAgent.includes('iPhone')) {
        platform = 'MacIntel';
    } else if (userAgent.includes('Linux') && !userAgent.includes('Android')) {
        platform = 'Linux x86_64';
    } else {
        platform = 'Win32';
    }

    // WebGL — matched to platform
    const renderers = WEBGL_RENDERERS[platform] || WEBGL_RENDERERS.Win32;
    const webGLRenderer = pick(renderers);
    const webGLVendor = WEBGL_VENDORS[platform] || WEBGL_VENDORS.Win32;

    // Hardware concurrency — realistic range
    const hardwareConcurrency = pick([4, 6, 8, 12, 16]);

    // Device memory — match to hardware
    const deviceMemory = pick([4, 8, 16]);

    return {
        userAgent,
        viewport,
        timezone,
        language,
        platform,
        isMobile: !!options.mobile,
        // Screen dimensions (slightly larger than viewport)
        screen: {
            width: viewport.width + randomInt(0, 200),
            height: viewport.height + randomInt(80, 200),
        },
        colorDepth: randomItem([24, 32]),
        // WebGL — platform-matched
        webGLVendor,
        webGLRenderer,
        // Hardware
        hardwareConcurrency,
        deviceMemory,
        // Canvas noise seed (unique per session)
        canvasNoiseSeed: Math.random(),
    };
}

/**
 * Apply fingerprint to Playwright browser context options.
 * @param {Object} fingerprint - Generated fingerprint
 * @returns {Object} Playwright-compatible context options
 */
function toPlaywrightContext(fingerprint) {
    const opts = {
        userAgent: fingerprint.userAgent,
        viewport: fingerprint.viewport,
        locale: fingerprint.language.split(',')[0],
        timezoneId: fingerprint.timezone,
        extraHTTPHeaders: {
            'Accept-Language': fingerprint.language,
            'sec-ch-ua-platform': `"${fingerprint.platform === 'Win32' ? 'Windows' : fingerprint.platform === 'MacIntel' ? 'macOS' : 'Linux'}"`,
        },
    };

    if (fingerprint.isMobile) {
        opts.isMobile = true;
        opts.hasTouch = true;
    }

    return opts;
}

/**
 * Apply fingerprint to Axios request headers.
 * @param {Object} fingerprint - Generated fingerprint
 * @returns {Object} Headers object for Axios
 */
function toAxiosHeaders(fingerprint) {
    return {
        'User-Agent': fingerprint.userAgent,
        'Accept-Language': fingerprint.language,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'sec-ch-ua-platform': `"${fingerprint.platform === 'Win32' ? 'Windows' : fingerprint.platform === 'MacIntel' ? 'macOS' : 'Linux'}"`,
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
    };
}

module.exports = {
    generateFingerprint,
    toPlaywrightContext,
    toAxiosHeaders,
    USER_AGENTS,
    MOBILE_USER_AGENTS,
    VIEWPORTS,
    MOBILE_VIEWPORTS,
    TIMEZONES,
};
