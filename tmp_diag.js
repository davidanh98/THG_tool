const Database = require('better-sqlite3');
const path = require('path');
const db = new Database('d:/THG/ToolAI/thg-lead-gen/data/leads.db');

try {
    console.log('--- Database Diagnostic ---');
    const rawPostsSchema = db.prepare("PRAGMA table_info(raw_posts)").all();
    console.log('raw_posts columns:', rawPostsSchema.map(c => c.name));

    const classificationsSchema = db.prepare("PRAGMA table_info(post_classifications)").all();
    console.log('post_classifications columns:', classificationsSchema.map(c => c.name));

    const leadsSchema = db.prepare("PRAGMA table_info(leads)").all();
    console.log('leads columns:', leadsSchema.map(c => c.name));

    process.exit(0);
} catch (error) {
    console.error('Diagnostic Failed:', error);
    process.exit(1);
}
