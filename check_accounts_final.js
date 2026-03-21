const Database = require('d:\\THG\\ToolAI\\thg-lead-gen\\node_modules\\better-sqlite3');
const dbPath = 'd:\\THG\\ToolAI\\thg-lead-gen\\data\\leads.db';
const db = new Database(dbPath);

console.log('--- Account Roles ---');
const accounts = db.prepare('SELECT email, role, status FROM fb_accounts').all();
accounts.forEach(a => {
    console.log(`${a.email.padEnd(30)} | ${a.role.padEnd(8)} | ${a.status}`);
});
db.close();
