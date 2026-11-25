const { Pool } = require('pg');

const { databaseOptions, friendlyError } = require('./config');
const pool = new Pool(databaseOptions());
pool.on('error', err => console.error(friendlyError(err)));
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client.query.bind(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { client.release(); }
}

async function query(text, params = []) {
  return pool.query(text, params);
}

async function initDb() {
 return transaction(async query => {
  await query("SELECT pg_advisory_xact_lock(827391)");
  await query("CREATE SCHEMA IF NOT EXISTS waifu");
  await query(`
    CREATE TABLE IF NOT EXISTS waifu.users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      language TEXT NOT NULL DEFAULT 'uz',
      coins INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_daily_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS waifu.characters (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      anime TEXT NOT NULL DEFAULT 'Unknown',
      rarity TEXT NOT NULL DEFAULT 'common',
      image_url TEXT,
      price INTEGER NOT NULL DEFAULT 100,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS waifu.user_characters (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES waifu.users(telegram_id) ON DELETE CASCADE,
      character_id BIGINT NOT NULL REFERENCES waifu.characters(id),
      obtained_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS waifu.groups_list (
      chat_id BIGINT PRIMARY KEY,
      title TEXT,
      enabled BOOLEAN NOT NULL DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS waifu.active_spawns (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      character_id BIGINT NOT NULL REFERENCES waifu.characters(id),
      message_id BIGINT,
      caught_by BIGINT,
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS waifu.transactions (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES waifu.users(telegram_id),
      kind TEXT NOT NULL,
      amount INTEGER NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`CREATE INDEX IF NOT EXISTS user_cards_idx ON waifu.user_characters(user_id, obtained_at DESC);
    CREATE INDEX IF NOT EXISTS active_spawn_idx ON waifu.active_spawns(chat_id, character_id) WHERE caught_by IS NULL;`);
  const count = await query('SELECT COUNT(*)::int AS n FROM waifu.characters');
  if (process.env.SEED_DEMO === 'true' && count.rows[0].n === 0) {
    await query(
      `INSERT INTO waifu.characters (name, anime, rarity, price) VALUES
       ('Naruto Uzumaki', 'Naruto', 'common', 100),
       ('Sasuke Uchiha', 'Naruto', 'rare', 300),
       ('Monkey D. Luffy', 'One Piece', 'rare', 350),
       ('Mikasa Ackerman', 'Attack on Titan', 'epic', 700),
       ('Gojo Satoru', 'Jujutsu Kaisen', 'legendary', 1500),
       ('Nezuko Kamado', 'Demon Slayer', 'epic', 800)`
    );
  }
 });
}

module.exports = { query, initDb, pool, transaction };
