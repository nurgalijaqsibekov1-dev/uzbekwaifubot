const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'anime.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new sqlite3.Database(dbPath);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve({ id: this.lastID, changes: this.changes });
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}
async function init() {
  await run('PRAGMA journal_mode = WAL');
  await run(`CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    anime TEXT NOT NULL,
    rarity TEXT NOT NULL,
    aliases TEXT DEFAULT '',
    photo_file_id TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(`CREATE TABLE IF NOT EXISTS collections (
    user_id TEXT NOT NULL,
    character_id INTEGER NOT NULL,
    obtained_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, character_id),
    FOREIGN KEY(character_id) REFERENCES characters(id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS user_stats (
    user_id TEXT PRIMARY KEY,
    username TEXT DEFAULT '',
    first_name TEXT DEFAULT '',
    messages INTEGER DEFAULT 0,
    correct_guesses INTEGER DEFAULT 0
  )`);
  await run(`CREATE TABLE IF NOT EXISTS group_stats (
    chat_id TEXT PRIMARY KEY,
    message_count INTEGER DEFAULT 0
  )`);
  await run(`CREATE TABLE IF NOT EXISTS group_catches (
    chat_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    catches INTEGER DEFAULT 0,
    PRIMARY KEY (chat_id, user_id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS active_drops (
    chat_id TEXT PRIMARY KEY,
    character_id INTEGER NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`);
}
module.exports = { db, run, get, all, init };
