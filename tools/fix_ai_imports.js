const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const backendDir = path.join(rootDir, 'backend');

function fixAiImports(dir) {
    const items = fs.readdirSync(dir);
    for (const item of items) {
        const fullPath = path.join(dir, item);
        if (fs.statSync(fullPath).isDirectory()) {
            fixAiImports(fullPath);
        } else if (fullPath.endsWith('.js')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let changed = false;

            const relDir = path.relative(backendDir, path.dirname(fullPath));
            const depth = relDir ? relDir.split(path.sep).length : 0;
            const correctPrefix = '../'.repeat(depth + 1);

            // Match require('.../ai/...') and replace the prefix
            const aiRegex = /require\((['"])((?:\.\.\/|\.\/)*)ai\/(.*?)(['"])\)/g;
            content = content.replace(aiRegex, (match, q1, oldPrefix, target, q2) => {
                const newReq = `require(${q1}${correctPrefix}ai/${target}${q2})`;
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

if (fs.existsSync(backendDir)) {
    fixAiImports(backendDir);
    console.log('✅ All ai/ imports in backend/ have been correctly depth-aligned!');
} else {
    console.log('❌ backend/ directory not found');
}
