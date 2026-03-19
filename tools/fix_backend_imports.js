const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const aiDir = path.join(rootDir, 'ai');

function fixBackendImports(dir) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        if (fs.statSync(fullPath).isDirectory()) {
            fixBackendImports(fullPath);
        } else if (fullPath.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let changed = false;

            const relDir = path.relative(aiDir, path.dirname(fullPath));
            const depth = relDir ? relDir.split(path.sep).length : 0;
            const correctPrefix = '../'.repeat(depth + 1);

            // Match require('.../backend/...') and replace the prefix
            const backendRegex = /require\((['"])((?:\.\.\/|\.\/)*)backend\/(.*?)(['"])\)/g;
            content = content.replace(backendRegex, (match, q1, oldPrefix, target, q2) => {
                const newReq = `require(${q1}${correctPrefix}backend/${target}${q2})`;
                if (match !== newReq) {
                    changed = true;
                    return newReq;
                }
                return match;
            });

            if (changed) {
                fs.writeFileSync(fullPath, content);
                console.log(`[Fixed] ${path.relative(rootDir, fullPath)} (Depth: ${depth}) -> prepended ${correctPrefix}`);
            }
        }
    }
}

if (fs.existsSync(aiDir)) {
    fixBackendImports(aiDir);
    console.log('✅ All backend imports in ai/ have been correctly depth-aligned!');
} else {
    console.log('❌ ai/ directory not found');
}
