const fs = require('fs');
const path = require('path');

const filePath = 'd:\\THG\\ToolAI\\thg-lead-gen\\backend\\infra\\workers\\scraperWorker.js';
let content = fs.readFileSync(filePath, 'utf8');

// The block we want to replace
const target = `                    spam_score: lead.spam_score || 0,
                    item_type: lead.item_type || 'post',
                });`;

const replacement = `                    spam_score: lead.spam_score || 0,
                    item_type: lead.item_type || 'post',
                    is_anonymous: lead.is_anonymous || 0,
                    automatic_comment_sent: lead.automatic_comment_sent || 0
                });`;

if (content.includes(target)) {
    content = content.replace(target, replacement);
    fs.writeFileSync(filePath, content);
    console.log('✅ scraperWorker.js patched successfully!');
} else {
    // Try with different indentation or slightly different text if first attempt fails
    console.error('❌ Could not find target block for patching!');
    // Let's try matching only item_type line
    const altTarget = `                    item_type: lead.item_type || 'post',`;
    const altReplacement = `                    item_type: lead.item_type || 'post',
                    is_anonymous: lead.is_anonymous || 0,
                    automatic_comment_sent: lead.automatic_comment_sent || 0,`;

    if (content.includes(altTarget)) {
        content = content.replace(altTarget, altReplacement);
        fs.writeFileSync(filePath, content);
        console.log('✅ scraperWorker.js patched successfully (alt method)!');
    } else {
        console.error('❌ Alternative patch also failed!');
    }
}
