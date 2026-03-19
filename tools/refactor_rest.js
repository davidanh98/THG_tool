const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const scriptsDir = path.join(rootDir, 'scripts');
const publicDir = path.join(rootDir, 'public');
const dataDir = path.join(rootDir, 'data');
const devopsDir = path.join(rootDir, 'devops');

// 1. Delete public/dev.html and public directory
if (fs.existsSync(publicDir)) {
    fs.rmSync(publicDir, { recursive: true, force: true });
    console.log('[Delete] Deleted public/ folder and dev.html');
}

// 2. Move and patch files from scripts/
if (fs.existsSync(scriptsDir)) {
    const files = fs.readdirSync(scriptsDir);
    for (const f of files) {
        const oldPath = path.join(scriptsDir, f);

        let targetDir = devopsDir;
        if (['backfill-leaderboard.js', 'cookieInjector.js', 'fb-autologin.js', 'fb-login.js', 'reset-account.js', 'sync-groups.js'].includes(f)) {
            targetDir = dataDir;
        }

        const newPath = path.join(targetDir, f);

        // Read file to patch src/ paths
        if (f.endsWith('.js') || f.endsWith('.sh') || f.endsWith('.ps1')) {
            let content = fs.readFileSync(oldPath, 'utf8');
            let changed = false;

            // Fix hardcoded database paths
            if (content.includes('../src/data_store/database')) {
                content = content.replace(/\.\.\/src\/data_store\/database/g, '../backend/core/data_store/database');
                changed = true;
            } else if (content.includes('../src/')) {
                content = content.replace(/\.\.\/src\//g, '../backend/');
                changed = true;
            }

            fs.writeFileSync(newPath, content);
            if (changed) console.log(`[Patch] Fixed paths in ${f}`);
            console.log(`[Move] scripts/${f} -> ${path.relative(rootDir, targetDir)}/${f}`);
        } else {
            fs.copyFileSync(oldPath, newPath);
            console.log(`[Move] scripts/${f} -> ${path.relative(rootDir, targetDir)}/${f}`);
        }
    }
    fs.rmSync(scriptsDir, { recursive: true, force: true });
    console.log('[Delete] Deleted empty scripts/ folder');
}

// 3. Move root-level DevOps scripts
const rootDevOpsFiles = ['setup-vps.sh', 'setup-vps.ps1', 'deploy_vps.sh', 'taskdev.bat'];
for (const f of rootDevOpsFiles) {
    const oldPath = path.join(rootDir, f);
    if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, path.join(devopsDir, f));
        console.log(`[Move] root/${f} -> devops/${f}`);
    }
}

console.log('✅ Remaining folders and scripts successfully cleaned up!');
