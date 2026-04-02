/**
 * ╔═══════════════════════════════════════════════════════════╗
 * ║  Stealth Scripts — Anti-Detection Page Injection          ║
 * ║  Inject into every Playwright page via addInitScript()    ║
 * ╚═══════════════════════════════════════════════════════════╝
 *
 * Spoofs: WebGL, Canvas, AudioContext, Navigator properties,
 *         Chrome CDP markers, and permission queries.
 *
 * Usage:
 *   const { applyStealthToContext } = require('./stealthScripts');
 *   await applyStealthToContext(context, fingerprint);
 */

/**
 * Apply all stealth scripts to a Playwright browser context.
 * Call this RIGHT AFTER creating the context, BEFORE navigating.
 *
 * @param {BrowserContext} context    - Playwright browser context
 * @param {Object}         fingerprint - from generateFingerprint()
 */
async function applyStealthToContext(context, fingerprint) {
    // 1. Navigator overrides — hide automation markers
    await context.addInitScript(navigatorOverrides(fingerprint));

    // 2. WebGL spoofing — fake GPU renderer/vendor
    await context.addInitScript(webGLSpoof(fingerprint));

    // 3. Canvas fingerprint noise — add subtle random noise
    await context.addInitScript(canvasNoise(fingerprint.canvasNoiseSeed || Math.random()));

    // 4. Chrome CDP detection — remove automation markers
    await context.addInitScript(chromeCDPCleanup());

    // 5. Permission API spoofing
    await context.addInitScript(permissionSpoof());

    // 6. AudioContext fingerprint noise
    await context.addInitScript(audioContextNoise());

    console.log(`[Stealth] 🛡️ All stealth scripts injected (UA: ${fingerprint.userAgent?.substring(0, 40)}...)`);
}

// ═══════════════════════════════════════════════════════
// Individual stealth scripts
// ═══════════════════════════════════════════════════════

/**
 * Override navigator properties to look like a real browser.
 */
function navigatorOverrides(fp) {
    return `(() => {
        // navigator.webdriver = false (most critical)
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
            configurable: true,
        });

        // navigator.plugins — simulate installed plugins
        Object.defineProperty(navigator, 'plugins', {
            get: () => {
                const plugins = [
                    { name: 'Chrome PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                    { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
                    { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
                    { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: '' },
                    { name: 'WebKit built-in PDF', filename: 'internal-pdf-viewer', description: '' },
                ];
                plugins.length = 5;
                plugins.namedItem = (name) => plugins.find(p => p.name === name) || null;
                plugins.refresh = () => {};
                plugins.item = (i) => plugins[i] || null;
                return plugins;
            },
            configurable: true,
        });

        // navigator.languages
        Object.defineProperty(navigator, 'languages', {
            get: () => ${JSON.stringify(fp.language ? fp.language.split(',').map(l => l.split(';')[0].trim()) : ['en-US', 'en'])},
            configurable: true,
        });

        // navigator.platform
        Object.defineProperty(navigator, 'platform', {
            get: () => ${JSON.stringify(fp.platform || 'Win32')},
            configurable: true,
        });

        // navigator.hardwareConcurrency
        Object.defineProperty(navigator, 'hardwareConcurrency', {
            get: () => ${fp.hardwareConcurrency || 8},
            configurable: true,
        });

        // navigator.deviceMemory
        Object.defineProperty(navigator, 'deviceMemory', {
            get: () => ${fp.deviceMemory || 8},
            configurable: true,
        });

        // screen properties
        Object.defineProperty(screen, 'colorDepth', {
            get: () => ${fp.colorDepth || 24},
            configurable: true,
        });
    })();`;
}

/**
 * Spoof WebGL renderer and vendor strings.
 */
function webGLSpoof(fp) {
    const renderer = fp.webGLRenderer || 'ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0, D3D11)';
    const vendor = fp.webGLVendor || 'Google Inc. (NVIDIA)';

    return `(() => {
        const getParameterOrig = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(param) {
            // UNMASKED_VENDOR_WEBGL
            if (param === 0x9245) return ${JSON.stringify(vendor)};
            // UNMASKED_RENDERER_WEBGL
            if (param === 0x9246) return ${JSON.stringify(renderer)};
            return getParameterOrig.call(this, param);
        };

        // Also patch WebGL2
        if (typeof WebGL2RenderingContext !== 'undefined') {
            const getParam2Orig = WebGL2RenderingContext.prototype.getParameter;
            WebGL2RenderingContext.prototype.getParameter = function(param) {
                if (param === 0x9245) return ${JSON.stringify(vendor)};
                if (param === 0x9246) return ${JSON.stringify(renderer)};
                return getParam2Orig.call(this, param);
            };
        }
    })();`;
}

/**
 * Add subtle noise to canvas toDataURL/toBlob to prevent fingerprinting.
 */
function canvasNoise(seed) {
    return `(() => {
        const noiseSeed = ${seed};

        // Simple seeded RNG
        function mulberry32(a) {
            return function() {
                a |= 0; a = a + 0x6D2B79F5 | 0;
                var t = Math.imul(a ^ a >>> 15, 1 | a);
                t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
                return ((t ^ t >>> 14) >>> 0) / 4294967296;
            }
        }

        const rng = mulberry32(Math.floor(noiseSeed * 2147483647));

        // Patch toDataURL
        const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(type, quality) {
            // Only add noise to 2D canvases (not WebGL)
            const ctx = this.getContext('2d');
            if (ctx && this.width > 0 && this.height > 0) {
                try {
                    const imageData = ctx.getImageData(0, 0, Math.min(this.width, 16), Math.min(this.height, 16));
                    const data = imageData.data;
                    // Add tiny noise to a few pixels
                    for (let i = 0; i < Math.min(data.length, 64); i += 4) {
                        data[i] = data[i] + Math.floor((rng() - 0.5) * 2);     // R
                        data[i+1] = data[i+1] + Math.floor((rng() - 0.5) * 2); // G
                    }
                    ctx.putImageData(imageData, 0, 0);
                } catch(e) { /* cross-origin or empty canvas */ }
            }
            return origToDataURL.call(this, type, quality);
        };
    })();`;
}

/**
 * Remove Chrome DevTools Protocol markers that reveal automation.
 */
function chromeCDPCleanup() {
    return `(() => {
        // Remove cdc_ markers from window.chrome
        if (window.chrome) {
            const origChrome = window.chrome;
            const cleanChrome = {};
            for (const key of Object.keys(origChrome)) {
                if (!key.startsWith('cdc_')) {
                    cleanChrome[key] = origChrome[key];
                }
            }
            // Ensure chrome.runtime exists (real Chrome has it)
            if (!cleanChrome.runtime) {
                cleanChrome.runtime = {
                    connect: () => {},
                    sendMessage: () => {},
                    onMessage: { addListener: () => {} },
                };
            }
            Object.defineProperty(window, 'chrome', {
                get: () => cleanChrome,
                configurable: true,
            });
        } else {
            // If chrome doesn't exist, create a minimal stub
            Object.defineProperty(window, 'chrome', {
                get: () => ({
                    runtime: {
                        connect: () => {},
                        sendMessage: () => {},
                        onMessage: { addListener: () => {} },
                    },
                }),
                configurable: true,
            });
        }

        // Remove Playwright-specific properties
        delete window.__playwright;
        delete window.__pw_manual;
    })();`;
}

/**
 * Spoof Permissions API to return realistic results.
 */
function permissionSpoof() {
    return `(() => {
        if (navigator.permissions) {
            const origQuery = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = function(desc) {
                if (desc && desc.name === 'notifications') {
                    return Promise.resolve({ state: 'prompt', onchange: null });
                }
                return origQuery(desc).catch(() => ({ state: 'prompt', onchange: null }));
            };
        }
    })();`;
}

/**
 * Add noise to AudioContext fingerprinting.
 */
function audioContextNoise() {
    return `(() => {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;

        const origGetFloatFrequencyData = AnalyserNode.prototype.getFloatFrequencyData;
        AnalyserNode.prototype.getFloatFrequencyData = function(array) {
            origGetFloatFrequencyData.call(this, array);
            // Add tiny noise
            for (let i = 0; i < array.length; i++) {
                array[i] = array[i] + (Math.random() - 0.5) * 0.001;
            }
        };

        const origCreateOscillator = AudioCtx.prototype.createOscillator;
        AudioCtx.prototype.createOscillator = function() {
            const osc = origCreateOscillator.call(this);
            // Slightly detune to create unique fingerprint
            osc.detune.value = (Math.random() - 0.5) * 0.01;
            return osc;
        };
    })();`;
}

module.exports = {
    applyStealthToContext,
    // Export individual scripts for testing/debugging
    navigatorOverrides,
    webGLSpoof,
    canvasNoise,
    chromeCDPCleanup,
    permissionSpoof,
    audioContextNoise,
};
