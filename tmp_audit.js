const Database = require('better-sqlite3');
const db = new Database('d:/THG/ToolAI/thg-lead-gen/data/leads.db');

const tables = ['leads', 'raw_posts', 'post_classifications', 'accounts'];
tables.forEach(t => {
    try {
        const info = db.prepare(`PRAGMA table_info(${t})`).all();
        console.log(`Table: ${t}`);
        console.log('Columns:', info.map(c => c.name).join(', '));
    } catch (e) {
        console.log(`Table: ${t} - Error: ${e.message}`);
    }
});
process.exit(0);
