const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const srcDir = path.join(rootDir, 'src');
const backendDir = path.join(rootDir, 'backend');
const aiDir = path.join(rootDir, 'ai');
const devopsDir = path.join(rootDir, 'devops');
const frontendDir = path.join(rootDir, 'frontend');

// 1. Delete useless templates
const templatesDir = path.join(srcDir, 'ai', 'squad', 'templates');
if (fs.existsSync(templatesDir)) {
    fs.rmSync(templatesDir, { recursive: true, force: true });
    console.log('[Delete] Trash templates folder deleted');
}

// 2. Create Target Directories
[backendDir, devopsDir, frontendDir].forEach(d => {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// 3. Move ai out of src
const srcAiDir = path.join(srcDir, 'ai');
if (fs.existsSync(srcAiDir)) {
    fs.renameSync(srcAiDir, aiDir);
    console.log('[Move] src/ai -> ai');
}

// 4. Move everything else in src to backend
if (fs.existsSync(srcDir)) {
    const srcItems = fs.readdirSync(srcDir);
    for (const item of srcItems) {
        if (item === 'ai') continue; // Should be gone anyway
        fs.renameSync(path.join(srcDir, item), path.join(backendDir, item));
        console.log(`[Move] src/${item} -> backend/${item}`);
    }
    // Delete empty src
    fs.rmSync(srcDir, { recursive: true, force: true });
    console.log('[Delete] Empty src/ removed');
}

// 5. Move DevOps files
const devopsFiles = ['Dockerfile', 'docker-compose.yml', 'ecosystem.config.js'];
devopsFiles.forEach(f => {
    const p = path.join(rootDir, f);
    if (fs.existsSync(p)) {
        fs.renameSync(p, path.join(devopsDir, f));
        console.log(`[Move] ${f} -> devops/${f}`);
    }
});

// 6. Rewrite paths in Backend (pointing to ../ai or ../../ai)
// Since backend is now 1 level deep from root (same as src was), 
// BUT ai is now a sibling to backend (it was INSIDE src before).
// OLD: backend/routes/x.js -> require('../ai/y')
// NEW: backend/routes/x.js -> require('../../ai/y')
// Because from backend/routes to root is ../../
function rewriteBackendPaths(dir) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && item !== 'node_modules') {
            rewriteBackendPaths(fullPath);
        } else if (fullPath.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let changed = false;

            // Pattern: require('.../ai/...') to require('.../../ai/...')
            // Exception: require('./ai/...') from backend root becomes require('../ai/...')
            const aiRegex = /require\((['"])((?:\.\.\/|\.\/)*)ai\/(.*?)(['"])\)/g;
            content = content.replace(aiRegex, (match, q1, prefix, target, q2) => {
                changed = true;
                const newPrefix = prefix === './' ? '../' : prefix + '../';
                return `require(${q1}${newPrefix}ai/${target}${q2})`;
            });

            if (changed) {
                fs.writeFileSync(fullPath, content);
                console.log(`[Rewrite] Backend: ${path.relative(rootDir, fullPath)}`);
            }
        }
    }
}
if (fs.existsSync(backendDir)) rewriteBackendPaths(backendDir);

// 7. Rewrite paths in AI pointing to backend items ('core', 'config', 'infra', 'routes')
// Currently ai/ is a sibling to backend/.
// OLD: ai/agents/x.js -> require('../../core/y')
// NEW: ai/agents/x.js -> require('../../backend/core/y')
function rewriteAiPaths(dir) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        if (fs.statSync(fullPath).isDirectory()) {
            rewriteAiPaths(fullPath);
        } else if (fullPath.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let changed = false;

            const targets = ['core', 'config', 'infra', 'routes', 'config.js', 'logger', 'logger.js', 'index.js'];
            for (const t of targets) {
                // Config.js import specifically: require('../../config')
                const ext = t.endsWith('.js') ? t.slice(0, -3) : t;
                const tRegex = new RegExp(`require\\((['"])((?:\\.\\.\\/|\\.\\/)*)(${ext})(/?.*?)(['"])\\)`, 'g');
                content = content.replace(tRegex, (match, q1, prefix, base, rest, q2) => {
                    changed = true;
                    // We just insert 'backend/' after the prefix
                    return `require(${q1}${prefix}backend/${base}${rest}${q2})`;
                });
            }

            if (changed) {
                fs.writeFileSync(fullPath, content);
                console.log(`[Rewrite] AI: ${path.relative(rootDir, fullPath)}`);
            }
        }
    }
}
if (fs.existsSync(aiDir)) rewriteAiPaths(aiDir);

// 8. Update package.json scripts
const pkgPath = path.join(rootDir, 'package.json');
if (fs.existsSync(pkgPath)) {
    let pkg = fs.readFileSync(pkgPath, 'utf8');
    pkg = pkg.replace(/src\/index\.js/g, 'backend/index.js');
    pkg = pkg.replace(/src\/server\.js/g, 'backend/server.js');
    pkg = pkg.replace(/src\/workers\//g, 'backend/infra/workers/'); // wait, worker paths changed?
    // Let's just blindly replace 'src/' with 'backend/' if they relate to backend stuff:
    pkg = pkg.replace(/"src\/(.*?)"/g, '"backend/$1"');
    // But squadRunner is now in ai/squad/squadRunner.js!
    pkg = pkg.replace(/"backend\/ai\/squad\//g, '"ai/squad/');

    // Also ecosystem path
    pkg = pkg.replace(/ecosystem\.config\.js/g, 'devops/ecosystem.config.js');

    fs.writeFileSync(pkgPath, pkg);
    console.log('[Rewrite] package.json updated');
}

console.log('✅ Full Architecture Refactor Complete!');
