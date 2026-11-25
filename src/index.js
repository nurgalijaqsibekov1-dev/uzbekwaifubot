require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { friendlyError, validateBot, databaseOptions } = require('./config');
try { validateBot(); databaseOptions(); } catch (e) { console.error(e.message); process.exit(1); }
const express = require('express');
const path = require('path');
const { Telegraf } = require('telegraf');
const { query, initDb, pool, transaction } = require('./db');
const { t } = require('./i18n');

const required = ['BOT_TOKEN', 'DATABASE_URL'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing ${key}. Copy .env.example to .env and configure it.`);
    process.exit(1);
  }
}
const bot = new Telegraf(process.env.BOT_TOKEN);
const app = express();
app.use(express.json({ limit: '32kb' }));
// Forward rejected async handlers to Express error middleware.
for (const method of ['get', 'post']) {
  const original = app[method].bind(app);
  app[method] = (route, ...handlers) => original(route, ...handlers.map(fn => (req,res,next) => Promise.resolve().then(() => fn(req,res,next)).catch(next)));
}
app.use(express.static(path.join(__dirname, '..', 'public')));

const admins = new Set((process.env.ADMIN_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
const isAdmin = id => admins.has(String(id));
const dailyReward = Number(process.env.DAILY_REWARD || 200);
const catchReward = Number(process.env.CATCH_REWARD || 50);

async function ensureUser(from) {
  await query(
    `INSERT INTO waifu.users (telegram_id, username, first_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (telegram_id) DO UPDATE SET username=EXCLUDED.username, first_name=EXCLUDED.first_name`,
    [from.id, from.username || null, from.first_name || 'Player']
  );
  const result = await query('SELECT * FROM waifu.users WHERE telegram_id=$1', [from.id]);
  return result.rows[0];
}
const langOf = user => user.language || 'uz';

bot.start(async ctx => {
  const user = await ensureUser(ctx.from);
  const url = process.env.APP_URL;
  const options = url && ctx.chat.type === 'private' ? { reply_markup: { inline_keyboard: [[{ text: '🎮 Mini App', web_app: { url } }]] } } : {};
  await ctx.reply(t(langOf(user), 'welcome', { name: ctx.from.first_name || 'Player' }), options);
});
bot.help(ctx => ctx.reply(t('uz', 'help')));
bot.command('lang', async ctx => {
  await ensureUser(ctx.from);
  const lang = (ctx.message.text.split(' ')[1] || '').toLowerCase();
  if (!['uz', 'en'].includes(lang)) return ctx.reply('Use: /lang uz or /lang en');
  await query('UPDATE waifu.users SET language=$1 WHERE telegram_id=$2', [lang, ctx.from.id]);
  ctx.reply(lang === 'uz' ? 'Til o‘zbekchaga o‘zgartirildi.' : 'Language changed to English.');
});
bot.command('daily', async ctx => {
  const user = await ensureUser(ctx.from);
  const result = await transaction(async query => {
  const result = await query(
    `UPDATE waifu.users SET coins=coins+$1, last_daily_at=NOW()
     WHERE telegram_id=$2 AND (last_daily_at IS NULL OR last_daily_at < NOW() - INTERVAL '20 hours')
     RETURNING coins`,
    [dailyReward, ctx.from.id]
  );
  if (!result.rowCount) return result;
  await query('INSERT INTO waifu.transactions (user_id,kind,amount) VALUES ($1,$2,$3)', [ctx.from.id, 'daily', dailyReward]);
  return result;
  });
  if (!result.rowCount) return ctx.reply(t(langOf(user), 'dailyWait'));
  ctx.reply(t(langOf(user), 'daily', { coins: dailyReward }));
});
bot.command('profile', async ctx => {
  const user = await ensureUser(ctx.from);
  const cards = await query('SELECT COUNT(*)::int AS n FROM waifu.user_characters WHERE user_id=$1', [ctx.from.id]);
  ctx.reply(`👤 ${user.first_name}\n💰 Coins: ${user.coins}\n🎴 Cards: ${cards.rows[0].n}\n🌐 Language: ${user.language}`);
});
bot.command('collection', async ctx => {
  const user = await ensureUser(ctx.from);
  const result = await query(
    `SELECT c.name,c.anime,c.rarity FROM waifu.user_characters uc
     JOIN waifu.characters c ON c.id=uc.character_id WHERE uc.user_id=$1
     ORDER BY uc.obtained_at DESC LIMIT 30`, [ctx.from.id]
  );
  if (!result.rowCount) return ctx.reply(t(langOf(user), 'empty'));
  ctx.reply('🎴 Your collection:\n' + result.rows.map((c,i) => `${i+1}. ${c.name} — ${c.anime} [${c.rarity}]`).join('\n'));
});
bot.command('shop', async ctx => {
  await ensureUser(ctx.from);
  const result = await query('SELECT id,name,anime,rarity,price FROM waifu.characters WHERE active=true ORDER BY price LIMIT 20');
  ctx.reply('🛒 SHOP\n' + result.rows.map(c => `#${c.id} ${c.name} (${c.rarity}) — ${c.price} coins\nBuy: /buy ${c.id}`).join('\n\n'));
});
bot.command('buy', async ctx => {
  await ensureUser(ctx.from);
  const id = Number(ctx.message.text.split(' ')[1]);
  if (!Number.isInteger(id)) return ctx.reply('Use: /buy CHARACTER_ID');
  const client = await require('./db').pool.connect();
  try {
    await client.query('BEGIN');
    const user = await client.query('SELECT coins FROM waifu.users WHERE telegram_id=$1 FOR UPDATE', [ctx.from.id]);
    const character = await client.query('SELECT * FROM waifu.characters WHERE id=$1 AND active=true FOR UPDATE', [id]);
    if (!character.rowCount) throw new Error('Character not found.');
    if (user.rows[0].coins < character.rows[0].price) throw new Error('Not enough coins.');
    await client.query('UPDATE waifu.users SET coins=coins-$1 WHERE telegram_id=$2', [character.rows[0].price, ctx.from.id]);
    await client.query('INSERT INTO waifu.user_characters (user_id,character_id) VALUES ($1,$2)', [ctx.from.id,id]);
    await client.query('INSERT INTO waifu.transactions (user_id,kind,amount,details) VALUES ($1,$2,$3,$4)', [ctx.from.id,'purchase',-character.rows[0].price,JSON.stringify({character_id:id})]);
    await client.query('COMMIT');
    ctx.reply(t('uz','bought',{name:character.rows[0].name}));
  } catch (e) {
    await client.query('ROLLBACK');
    ctx.reply(['Character not found.', 'Not enough coins.'].includes(e.message) ? e.message : friendlyError(e));
  } finally { client.release(); }
});
bot.command('stats', async ctx => {
  const [users,cards] = await Promise.all([
    query('SELECT COUNT(*)::int AS n FROM waifu.users'),
    query('SELECT COUNT(*)::int AS n FROM waifu.user_characters')
  ]);
  ctx.reply(`🌍 GLOBAL STATISTICS\n👥 Players: ${users.rows[0].n}\n🎴 Cards collected: ${cards.rows[0].n}`);
});
bot.command('spawn', async ctx => {
  if (!isAdmin(ctx.from.id)) return ctx.reply('Admin only.');
  if (ctx.chat.type === 'private') return ctx.reply('Use /spawn in a group.');
  const result = await query('SELECT * FROM waifu.characters WHERE active=true ORDER BY RANDOM() LIMIT 1');
  if (!result.rowCount) return ctx.reply('No active characters in database.');
  const c = result.rows[0];
  const sent = await ctx.reply(`✨ A character appeared!\n\nAnime: ${c.anime}\nRarity: ${c.rarity}\n\nFirst to send /catch ${c.id} gets this character!`);
  await query(
    `INSERT INTO waifu.active_spawns (chat_id,character_id,message_id,expires_at)
     VALUES ($1,$2,$3,NOW()+INTERVAL '5 minutes')`,
    [ctx.chat.id,c.id,sent.message_id]
  );
  await query('INSERT INTO waifu.groups_list (chat_id,title) VALUES ($1,$2) ON CONFLICT (chat_id) DO UPDATE SET title=EXCLUDED.title', [ctx.chat.id,ctx.chat.title || 'Group']);
});
bot.command('catch', async ctx => {
  const user = await ensureUser(ctx.from);
  const id = Number(ctx.message.text.split(' ')[1]);
  if (!Number.isInteger(id)) return ctx.reply('Use: /catch CHARACTER_ID');
  const caught = await transaction(async query => {
  const result = await query(
    `UPDATE waifu.active_spawns SET caught_by=$1
     WHERE id=(SELECT id FROM waifu.active_spawns WHERE chat_id=$2 AND character_id=$3 AND caught_by IS NULL AND expires_at>NOW() ORDER BY id DESC LIMIT 1 FOR UPDATE)
     AND caught_by IS NULL RETURNING id`,
    [ctx.from.id,ctx.chat.id,id]
  );
  if (!result.rowCount) return false;
  await query('INSERT INTO waifu.user_characters (user_id,character_id) VALUES ($1,$2)', [ctx.from.id,id]);
  await query('UPDATE waifu.users SET coins=coins+$1 WHERE telegram_id=$2', [catchReward,ctx.from.id]);
  await query('INSERT INTO waifu.transactions (user_id,kind,amount,details) VALUES ($1,$2,$3,$4)', [ctx.from.id,'catch',catchReward,JSON.stringify({character_id:id})]);
  return true;
  });
  if (!caught) return ctx.reply(t(langOf(user),'missed'));
  const c = await query('SELECT name FROM waifu.characters WHERE id=$1',[id]);
  ctx.reply(t(langOf(user),'caught',{name:c.rows[0]?.name || 'Character'}) + `\n+${catchReward} coins`);
});

// Telegram Mini App initData verification.
const { verifyInitData } = require('./auth');
async function miniAuth(req,res,next) {
  const user = verifyInitData(req.get('x-telegram-init-data'));
  if (!user?.id) return res.status(401).json({error:'Open this app from Telegram.'});
  req.tgUser = user;
  next();
}
app.get('/api/me', miniAuth, async (req,res) => {
  const user = await ensureUser(req.tgUser);
  const cards = await query(
    `SELECT uc.id,c.id AS character_id,c.name,c.anime,c.rarity,c.image_url
     FROM waifu.user_characters uc JOIN waifu.characters c ON c.id=uc.character_id
     WHERE uc.user_id=$1 ORDER BY uc.obtained_at DESC LIMIT 100`, [req.tgUser.id]
  );
  res.json({user:{id:user.telegram_id,name:user.first_name,coins:user.coins,language:user.language},cards:cards.rows});
});
app.get('/api/stats', async (_req,res) => {
  const [u,c] = await Promise.all([query('SELECT COUNT(*)::int AS n FROM waifu.users'),query('SELECT COUNT(*)::int AS n FROM waifu.user_characters')]);
  res.json({players:u.rows[0].n,cards:c.rows[0].n});
});
app.get('/api/admin/overview', miniAuth, async (req,res) => {
  if (!isAdmin(req.tgUser.id)) return res.status(403).json({error:'Admin only.'});
  const [u,c,g] = await Promise.all([
    query('SELECT COUNT(*)::int AS n FROM waifu.users'),
    query('SELECT COUNT(*)::int AS n FROM waifu.characters'),
    query('SELECT COUNT(*)::int AS n FROM waifu.groups_list')
  ]);
  res.json({users:u.rows[0].n,characters:c.rows[0].n,groups:g.rows[0].n});
});
app.post('/api/admin/characters', miniAuth, async (req,res) => {
  if (!isAdmin(req.tgUser.id)) return res.status(403).json({error:'Admin only.'});
  const {name,anime,rarity,price,image_url} = req.body || {};
  if (!name || !anime || !['common','uncommon','rare','epic','legendary','mythic','limited','special'].includes(rarity) || !Number.isInteger(price) || price < 0 || price > 100000000 || typeof name !== 'string' || name.length > 100 || typeof anime !== 'string' || anime.length > 150 || (image_url && (typeof image_url !== 'string' || !/^https:\/\//.test(image_url)))) {
    return res.status(400).json({error:'Invalid character fields.'});
  }
  const result = await query(
    'INSERT INTO waifu.characters (name,anime,rarity,price,image_url) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [name,anime,rarity,Number(price),image_url || null]
  );
  res.json({ok:true,id:result.rows[0].id});
});

app.get('/health', (_req,res) => res.json({ok:true}));
app.get('/admin', (_req,res) => res.sendFile(path.join(__dirname,'..','public','admin.html')));

app.use((err,req,res,next) => {
  console.error(friendlyError(err));
  res.status(err.status === 400 ? 400 : 500).json({ error: 'So‘rov bajarilmadi. Keyinroq urinib ko‘ring.' });
});
bot.catch(async (err,ctx) => {
  console.error(friendlyError(err));
  await ctx.reply('Vaqtinchalik xato. Keyinroq urinib ko‘ring.').catch(() => {});
});
let server;
let stopping = false;
async function stop(signal, code = 0) {
  if (stopping) return;
  stopping = true;
  const timer = setTimeout(() => process.exit(code), 10000); timer.unref();
  try { bot.stop(signal); } catch {}
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  process.exitCode = code;
}
(async () => {
  await initDb();
  console.log('Supabase PostgreSQL tayyor.');
  const port = Number(process.env.PORT || 3000);
  server = app.listen(port, () => console.log(`Mini App port: ${port}`));
  server.on('error', err => { console.error(friendlyError(err)); stop('server error', 1); });
  console.log('Telegram bot ulanmoqda…');
  await bot.launch();
})().catch(err => { console.error(friendlyError(err)); stop('startup error', 1); });
process.once('SIGINT', () => stop('SIGINT'));
process.once('SIGTERM', () => stop('SIGTERM'));
