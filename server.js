require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const initSqlJs = require('./node_modules/sql.js');

const app = express();
const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || '';
const ADMIN_PASS = process.env.ADMIN_PASS || '1234';
const CASINO_WALLET = process.env.CASINO_WALLET || 'YOUR_TON_WALLET_HERE';
const DB_PATH = process.env.DB_PATH || './casino.db';

let db; let SQL;

async function initDB() {
  SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_id TEXT UNIQUE NOT NULL,
      username TEXT, first_name TEXT,
      balance REAL DEFAULT 0,
      total_deposits REAL DEFAULT 0,
      games_played INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_id TEXT NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL, comment TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_id TEXT NOT NULL, uid TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
      icon TEXT, price REAL NOT NULL, rarity TEXT DEFAULT 'blue',
      created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tg_id TEXT NOT NULL, username TEXT, nft_uid TEXT, nft_name TEXT,
      icon TEXT, nft_price REAL, fee REAL, status TEXT DEFAULT 'pending',
      seen INTEGER DEFAULT 0, created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS daily_claims (
      tg_id TEXT NOT NULL, day_key TEXT NOT NULL, PRIMARY KEY (tg_id, day_key)
    );
  `;
  db.run(schema);
  saveDB();
  console.log('Database ready:', DB_PATH);
}

function saveDB() { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }
setInterval(saveDB, 30000);

function dbGet(sql, params=[]) {
  const stmt = db.prepare(sql); stmt.bind(params);
  if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
  stmt.free(); return null;
}
function dbAll(sql, params=[]) {
  const r = db.exec(sql, params);
  if (!r.length) return [];
  const {columns, values} = r[0];
  return values.map(row => { const o={}; columns.forEach((c,i)=>o[c]=row[i]); return o; });
}
function dbRun(sql, params=[]) { db.run(sql, params); saveDB(); }

app.use(cors({origin:'*'})); app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function verifyTelegramAuth(initData) {
  if (!BOT_TOKEN || process.env.NODE_ENV !== 'production') {
    return {ok:true, user:{id:'dev_user', first_name:'Dev', username:'dev'}};
  }
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash'); if (!hash) return null;
    params.delete('hash');
    const str = [...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
    const key = crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
    const exp = crypto.createHmac('sha256',key).update(str).digest('hex');
    if (exp !== hash) return null;
    return {ok:true, user: JSON.parse(params.get('user')||'{}')};
  } catch(e) { return null; }
}

function authMiddleware(req, res, next) {
  const initData = req.headers['x-telegram-init-data'] || '';
  if (!initData && process.env.NODE_ENV !== 'production') {
    req.tgUser = {id:'dev_user', first_name:'Dev', username:'dev'}; return next();
  }
  const r = verifyTelegramAuth(initData);
  if (!r) return res.status(401).json({error:'Unauthorized'});
  req.tgUser = r.user; next();
}
function adminAuth(req, res, next) {
  const pass = req.headers['x-admin-pass'] || req.body?.admin_pass;
  if (pass !== ADMIN_PASS) return res.status(403).json({error:'Forbidden'});
  next();
}

function getOrCreateUser(tgUser) {
  const tg_id = String(tgUser.id);
  let user = dbGet('SELECT * FROM users WHERE tg_id = ?', [tg_id]);
  if (!user) {
    dbRun('INSERT INTO users (tg_id, username, first_name, balance) VALUES (?, ?, ?, 1000)',
      [tg_id, tgUser.username||'', tgUser.first_name||'Игрок']);
    dbRun("INSERT INTO transactions (tg_id, type, amount, comment) VALUES (?, 'bonus', 1000, 'Стартовый бонус')", [tg_id]);
    user = dbGet('SELECT * FROM users WHERE tg_id = ?', [tg_id]);
  }
  return user;
}

app.get('/api/me', authMiddleware, (req, res) => {
  const user = getOrCreateUser(req.tgUser);
  res.json({tg_id:user.tg_id, username:user.username, first_name:user.first_name,
    balance:user.balance, total_deposits:user.total_deposits, games_played:user.games_played});
});

app.post('/api/balance/sync', authMiddleware, (req, res) => {
  const {balance} = req.body;
  if (typeof balance !== 'number' || balance < 0) return res.status(400).json({error:'Invalid balance'});
  dbRun('UPDATE users SET balance = ? WHERE tg_id = ?', [balance, String(req.tgUser.id)]);
  res.json({ok:true, balance});
});

app.post('/api/game/result', authMiddleware, (req, res) => {
  const {game, delta, balance} = req.body;
  const tg_id = String(req.tgUser.id);
  const user = dbGet('SELECT * FROM users WHERE tg_id = ?', [tg_id]);
  if (!user) return res.status(404).json({error:'User not found'});
  const newBalance = typeof balance === 'number' ? balance : user.balance + delta;
  if (newBalance < 0) return res.status(400).json({error:'Insufficient balance'});
  dbRun('UPDATE users SET balance = ?, games_played = games_played + 1 WHERE tg_id = ?', [newBalance, tg_id]);
  dbRun("INSERT INTO transactions (tg_id, type, amount, comment) VALUES (?, 'game', ?, ?)", [tg_id, delta||0, game||'game']);
  res.json({ok:true, balance:newBalance});
});

app.get('/api/daily/check', authMiddleware, (req, res) => {
  const tg_id = String(req.tgUser.id);
  const dayKey = new Date().toISOString().slice(0,10);
  const claimed = dbGet('SELECT 1 FROM daily_claims WHERE tg_id = ? AND day_key = ?', [tg_id, dayKey]);
  res.json({available: !claimed});
});

app.post('/api/daily/claim', authMiddleware, (req, res) => {
  const tg_id = String(req.tgUser.id);
  const dayKey = new Date().toISOString().slice(0,10);
  if (dbGet('SELECT 1 FROM daily_claims WHERE tg_id = ? AND day_key = ?', [tg_id, dayKey]))
    return res.status(400).json({error:'Already claimed today'});
  const bonus = 100;
  dbRun('INSERT INTO daily_claims (tg_id, day_key) VALUES (?, ?)', [tg_id, dayKey]);
  dbRun('UPDATE users SET balance = balance + ? WHERE tg_id = ?', [bonus, tg_id]);
  dbRun("INSERT INTO transactions (tg_id, type, amount, comment) VALUES (?, 'bonus', ?, 'Ежедневный бонус')", [tg_id, bonus]);
  const user = dbGet('SELECT balance FROM users WHERE tg_id = ?', [tg_id]);
  res.json({ok:true, bonus, balance:user.balance});
});

app.post('/api/deposit/ton', authMiddleware, (req, res) => {
  const {amount_ton} = req.body;
  const tg_id = String(req.tgUser.id);
  const comment = `dep_${tg_id}_${Date.now()}`;
  const amount_coins = Math.round((amount_ton||1)*500);
  res.json({ok:true, wallet:CASINO_WALLET, amount_ton, amount_coins, comment,
    ton_link:`ton://transfer/${CASINO_WALLET}?amount=${Math.round((amount_ton||1)*1e9)}&text=${comment}`});
});

app.post('/api/deposit/confirm', adminAuth, (req, res) => {
  const {tg_id, amount_coins, comment} = req.body;
  const user = dbGet('SELECT * FROM users WHERE tg_id = ?', [String(tg_id)]);
  if (!user) return res.status(404).json({error:'User not found'});
  const nb = user.balance + amount_coins;
  dbRun('UPDATE users SET balance = ?, total_deposits = total_deposits + ? WHERE tg_id = ?', [nb, amount_coins, String(tg_id)]);
  dbRun("INSERT INTO transactions (tg_id, type, amount, comment) VALUES (?, 'deposit', ?, ?)", [String(tg_id), amount_coins, comment||'TON deposit']);
  res.json({ok:true, balance:nb});
});

app.get('/api/inventory', authMiddleware, (req, res) => {
  const items = dbAll('SELECT * FROM inventory WHERE tg_id = ? ORDER BY created_at DESC', [String(req.tgUser.id)]);
  res.json({items});
});

app.post('/api/inventory/add', authMiddleware, (req, res) => {
  const {uid, name, icon, price, rarity} = req.body;
  const tg_id = String(req.tgUser.id);
  try {
    dbRun('INSERT INTO inventory (tg_id, uid, name, icon, price, rarity) VALUES (?, ?, ?, ?, ?, ?)',
      [tg_id, uid||String(Date.now()), name, icon, price, rarity||'blue']);
    res.json({ok:true});
  } catch(e) { res.status(400).json({error:'Duplicate or invalid'}); }
});

app.delete('/api/inventory/:uid', authMiddleware, (req, res) => {
  dbRun('DELETE FROM inventory WHERE tg_id = ? AND uid = ?', [String(req.tgUser.id), req.params.uid]);
  res.json({ok:true});
});

app.post('/api/inventory/sell', authMiddleware, (req, res) => {
  const tg_id = String(req.tgUser.id);
  const item = dbGet('SELECT * FROM inventory WHERE tg_id = ? AND uid = ?', [tg_id, req.body.uid]);
  if (!item) return res.status(404).json({error:'NFT not found'});
  const sellPrice = Math.round(item.price*0.7);
  dbRun('DELETE FROM inventory WHERE tg_id = ? AND uid = ?', [tg_id, req.body.uid]);
  dbRun('UPDATE users SET balance = balance + ? WHERE tg_id = ?', [sellPrice, tg_id]);
  dbRun("INSERT INTO transactions (tg_id, type, amount, comment) VALUES (?, 'sell', ?, ?)", [tg_id, sellPrice, 'Продажа NFT: '+item.name]);
  const user = dbGet('SELECT balance FROM users WHERE tg_id = ?', [tg_id]);
  res.json({ok:true, sold_for:sellPrice, balance:user.balance});
});

app.post('/api/withdrawal/request', authMiddleware, (req, res) => {
  const tg_id = String(req.tgUser.id);
  const item = dbGet('SELECT * FROM inventory WHERE tg_id = ? AND uid = ?', [tg_id, req.body.uid]);
  if (!item) return res.status(404).json({error:'NFT not found'});
  const user = dbGet('SELECT * FROM users WHERE tg_id = ?', [tg_id]);
  const fee = Math.round(item.price*0.5);
  if (user.balance < fee) return res.status(400).json({error:'Insufficient balance for fee', needed:fee});
  dbRun('UPDATE users SET balance = balance - ? WHERE tg_id = ?', [fee, tg_id]);
  dbRun("INSERT INTO transactions (tg_id, type, amount, comment) VALUES (?, 'fee', ?, 'Комиссия за вывод NFT')", [tg_id, -fee]);
  dbRun('DELETE FROM inventory WHERE tg_id = ? AND uid = ?', [tg_id, req.body.uid]);
  dbRun('INSERT INTO withdrawals (tg_id, username, nft_uid, nft_name, icon, nft_price, fee) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [tg_id, user.username, req.body.uid, item.name, item.icon, item.price, fee]);
  const updUser = dbGet('SELECT balance FROM users WHERE tg_id = ?', [tg_id]);
  res.json({ok:true, fee, balance:updUser.balance});
});

app.get('/api/transactions', authMiddleware, (req, res) => {
  const txs = dbAll('SELECT * FROM transactions WHERE tg_id = ? ORDER BY created_at DESC LIMIT 50', [String(req.tgUser.id)]);
  res.json({transactions:txs});
});

app.get('/api/admin/stats', adminAuth, (req, res) => {
  res.json({
    totalUsers: (dbGet('SELECT COUNT(*) as c FROM users')||{c:0}).c,
    totalDeposits: (dbGet("SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE type='deposit'")||{s:0}).s,
    totalGames: (dbGet('SELECT COALESCE(SUM(games_played),0) as s FROM users')||{s:0}).s,
    pendingWithdrawals: (dbGet("SELECT COUNT(*) as c FROM withdrawals WHERE status='pending'")||{c:0}).c,
  });
});

app.get('/api/admin/users', adminAuth, (req, res) => {
  res.json({users: dbAll('SELECT * FROM users ORDER BY created_at DESC LIMIT 100')});
});

app.post('/api/admin/balance', adminAuth, (req, res) => {
  const {tg_id, amount, comment} = req.body;
  dbRun('UPDATE users SET balance = balance + ? WHERE tg_id = ?', [amount, tg_id]);
  dbRun("INSERT INTO transactions (tg_id, type, amount, comment) VALUES (?, 'admin', ?, ?)", [tg_id, amount, comment||'Admin adjustment']);
  const user = dbGet('SELECT balance FROM users WHERE tg_id = ?', [tg_id]);
  res.json({ok:true, balance:user?.balance});
});

app.get('/api/admin/withdrawals', adminAuth, (req, res) => {
  const w = dbAll('SELECT * FROM withdrawals ORDER BY created_at DESC LIMIT 100');
  dbRun('UPDATE withdrawals SET seen = 1');
  res.json({withdrawals:w});
});

app.post('/api/admin/withdrawal/complete', adminAuth, (req, res) => {
  dbRun("UPDATE withdrawals SET status = 'completed' WHERE id = ?", [req.body.id]);
  res.json({ok:true});
});

app.get('/api/admin/transactions', adminAuth, (req, res) => {
  const txs = dbAll('SELECT t.*, u.username, u.first_name FROM transactions t LEFT JOIN users u ON t.tg_id = u.tg_id ORDER BY t.created_at DESC LIMIT 200');
  res.json({transactions:txs});
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`\n🎰 Casino X Backend запущен!`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log(`🔑 Admin: x-admin-pass: ${ADMIN_PASS}`);
    console.log(`💾 DB: ${DB_PATH}`);
  });
}).catch(e => { console.error('DB init failed:', e); process.exit(1); });
