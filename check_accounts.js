const Database = require('d:\\THG\\ToolAI\\thg-lead-gen\\node_modules\\better-sqlite3');
const path = require('path');
const dbPath = 'd:\\THG\\ToolAI\\data\\leads.db';
const db = new Database(dbPath);

const accounts = db.prepare('SELECT email, role, status FROM fb_accounts').all();
console.log(JSON.stringify(accounts, null, 2));
db.close();
