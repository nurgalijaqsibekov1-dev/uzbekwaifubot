require('dotenv').config();

const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const { init, run, get, all } = require('./db');

const token = process.env.BOT_TOKEN;
if (!token || token.includes('PASTE_YOUR')) {
  console.error('BOT_TOKEN is missing. Set it in your .env or hosting environment.');
  process.exit(1);
}

// ============================== CONFIG ==============================
const rarities = ['Common', 'Rare', 'Epic', 'Legendary'];
const rarityEmoji = { Common: '⚪', Rare: '🔵', Epic: '🟣', Legendary: '🟡' };

const envNum = (name, def, min) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= min ? n : def;
};
const DROP_EVERY = Math.floor(envNum('DROP_EVERY', 50, 1));
const DROP_TTL_MINUTES = envNum('DROP_TTL_MINUTES', 5, 0); // 0 = never expires
function parseWeights(str) {
  const w = { Common: 60, Rare: 25, Epic: 10, Legendary: 5 };
  for (const part of String(str || '').split(',')) {
    const [k, v] = part.split(':').map(x => (x || '').trim());
    const rar = rarities.find(r => r.toLowerCase() === k.toLowerCase());
    const n = Number(v);
    if (rar && v !== '' && Number.isFinite(n) && n >= 0) w[rar] = n;
  }
  return w;
}
const RARITY_WEIGHTS = parseWeights(process.env.RARITY_WEIGHTS);

const adminIds = new Set((process.env.ADMIN_IDS || '').split(',').map(x => x.trim()).filter(Boolean));
const isAdmin = id => adminIds.has(String(id));

// ============================== BOT + HEALTH SERVER ==============================
// Polling starts only AFTER the database is ready (see bottom of the file).
const bot = new TelegramBot(token, { polling: false });
const app = express();
const port = Number(process.env.PORT || 3000);
app.get('/', (_req, res) => res.status(200).send('Uzbek Waifu Game bot is running.'));
app.get('/health', (_req, res) => res.status(200).json({ ok: true }));
app.listen(port, '0.0.0.0', () => console.log(`Health server listening on ${port}`));

let botUsername = '';
let privacyOn = false; // true => bot can NOT see ordinary group messages

// ============================== HELPERS ==============================
const displayName = user => user.username ? `@${user.username}` : (user.first_name || String(user.id || user.user_id));
const rowName = r => r.username ? `@${r.username}` : (r.first_name || r.user_id);
const medal = i => ['🥇', '🥈', '🥉'][i] || `${i + 1}.`;
const isGroupChat = chat => chat.type === 'group' || chat.type === 'supergroup';
const btn = (text, data) => ({ text, callback_data: data });
const ignoreNotModified = e => { if (!/not modified/i.test(e.message)) throw e; };

// Command registration: ignores commands aimed at other bots (/start@OtherBot) and never lets a
// failing handler crash the process.
function cmd(names, handler) {
  const re = new RegExp(`^\\/(?:${names})(?:@(\\w+))?(?:\\s|$)`, 'i');
  bot.onText(re, (msg, match) => {
    if (match[1] && botUsername && match[1].toLowerCase() !== botUsername.toLowerCase()) return;
    Promise.resolve(handler(msg, match)).catch(e => console.error(`/${names} error:`, e));
  });
}

// "Gójo  Satoru!" -> "gojo satoru"; apostrophes removed so o‘ / o' / o` all match.
function normalizeGuess(str) {
  return String(str || '')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[ʻʼ’‘`´']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim().replace(/\s+/g, ' ');
}
const sortedWords = n => n.split(' ').sort().join(' ');
// Matches full name or any alias; word order does not matter ("Satoru Gojo" == "Gojo Satoru").
function matchesGuess(character, text) {
  const guess = normalizeGuess(text);
  if (!guess) return false;
  const guessSorted = sortedWords(guess);
  const candidates = [character.name, ...String(character.aliases || '').split(',')];
  return candidates.some(c => {
    const n = normalizeGuess(c);
    return n && (n === guess || sortedWords(n) === guessSorted);
  });
}
function normalizeAliases(str) {
  return String(str || '').split(',').map(x => x.trim()).filter(Boolean).join(',');
}

// ============================== USERS ==============================
const userCache = new Map(); // avoids a DB write for every single message
async function ensureUser(user) {
  const key = `${user.username || ''}|${user.first_name || ''}`;
  if (userCache.get(user.id) === key) return;
  await run(
    `INSERT INTO user_stats(user_id, username, first_name) VALUES(?,?,?)
     ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, first_name=excluded.first_name`,
    [String(user.id), user.username || '', user.first_name || '']
  );
  if (userCache.size > 5000) userCache.clear();
  userCache.set(user.id, key);
}

// ============================== DROPS ==============================
const lastDrop = new Map(); // chatId -> last character id (avoid immediate repeats)
const lastDropError = new Map(); // chatId -> last reason a drop could not be sent

// Rarity is picked by weight first, then a random character of that rarity.
async function pickCharacter(chatId) {
  const counts = await all('SELECT rarity, COUNT(*) AS n FROM characters GROUP BY rarity');
  if (!counts.length) return null;
  const total = counts.reduce((a, c) => a + c.n, 0);
  const last = total > 1 ? (lastDrop.get(String(chatId)) || -1) : -1;

  const pool = counts.map(c => ({ rarity: c.rarity, w: RARITY_WEIGHTS[c.rarity] ?? 1 })).filter(x => x.w > 0);
  let rarity = null;
  if (pool.length) {
    let roll = Math.random() * pool.reduce((a, x) => a + x.w, 0);
    for (const x of pool) { roll -= x.w; if (roll < 0) { rarity = x.rarity; break; } }
    if (!rarity) rarity = pool[pool.length - 1].rarity;
  }
  let ch = rarity && await get('SELECT * FROM characters WHERE rarity=? AND id<>? ORDER BY RANDOM() LIMIT 1', [rarity, last]);
  if (!ch) ch = await get('SELECT * FROM characters WHERE id<>? ORDER BY RANDOM() LIMIT 1', [last]);
  if (!ch) ch = await get('SELECT * FROM characters ORDER BY RANDOM() LIMIT 1');
  if (ch) lastDrop.set(String(chatId), ch.id);
  return ch;
}

// Removes the active drop (if any) and tells the chat the character ran away.
async function expireDrop(chatId) {
  const drop = await get(
    `SELECT d.character_id, c.name, c.anime, c.rarity FROM active_drops d
     LEFT JOIN characters c ON c.id=d.character_id WHERE d.chat_id=?`, [String(chatId)]);
  if (!drop) return;
  const claim = await run('DELETE FROM active_drops WHERE chat_id=? AND character_id=?', [String(chatId), drop.character_id]);
  if (claim.changes !== 1 || !drop.name) return;
  await bot.sendMessage(chatId,
    `😢 Hech kim topolmadi... ${rarityEmoji[drop.rarity] || ''} ${drop.name} qochib ketdi!\n🎬 ${drop.anime}`
  ).catch(e => console.error('expire message error:', e.message));
}

async function sweepExpiredDrops() {
  if (!DROP_TTL_MINUTES) return;
  const rows = await all(
    `SELECT chat_id FROM active_drops WHERE created_at <= datetime('now', ?)`,
    [`-${Math.round(DROP_TTL_MINUTES * 60)} seconds`]
  );
  for (const r of rows) await expireDrop(r.chat_id);
}

// Returns true if a character was dropped. Empty database is silent unless announceEmpty is set.
async function sendDrop(chatId, { announceEmpty = false } = {}) {
  lastDropError.delete(String(chatId));
  const character = await pickCharacter(chatId);
  if (!character) {
    if (announceEmpty) await bot.sendMessage(chatId, 'Hozircha personajlar bazasi bo‘sh. Avval personaj qo‘shing.');
    return false;
  }
  await expireDrop(chatId); // a previous unguessed drop runs away
  await run(
    `INSERT INTO active_drops(chat_id, character_id) VALUES(?,?)
     ON CONFLICT(chat_id) DO UPDATE SET character_id=excluded.character_id, created_at=CURRENT_TIMESTAMP`,
    [String(chatId), character.id]
  );
  const timeLine = DROP_TTL_MINUTES ? `\n⏳ ${DROP_TTL_MINUTES} daqiqa ichida toping!` : '';
  try {
    await bot.sendPhoto(chatId, character.photo_file_id, {
      caption: `🎴 Yangi personaj chiqdi!\n${rarityEmoji[character.rarity] || ''} ${character.rarity}\n\nIsmini toping!${timeLine}`
    });
    return true;
  } catch (e) {
    console.error('sendDrop photo error:', e.message);
    lastDropError.set(String(chatId), e.message);
    await run('DELETE FROM active_drops WHERE chat_id=?', [String(chatId)]);
    return false;
  }
}

async function addToCollection(user, character, chat) {
  const result = await run('INSERT OR IGNORE INTO collections(user_id, character_id) VALUES(?,?)', [String(user.id), character.id]);
  await run('UPDATE user_stats SET correct_guesses = correct_guesses + 1 WHERE user_id=?', [String(user.id)]);
  if (isGroupChat(chat)) {
    await run(
      `INSERT INTO group_catches(chat_id, user_id, catches) VALUES(?,?,1)
       ON CONFLICT(chat_id, user_id) DO UPDATE SET catches=catches+1`,
      [String(chat.id), String(user.id)]
    );
  }
  return result.changes > 0;
}

async function tryGuess(msg) {
  const chatId = String(msg.chat.id);
  const active = await get('SELECT character_id FROM active_drops WHERE chat_id=?', [chatId]);
  if (!active) return;
  const character = await get('SELECT * FROM characters WHERE id=?', [active.character_id]);
  if (!character) { await run('DELETE FROM active_drops WHERE chat_id=?', [chatId]); return; }
  if (!matchesGuess(character, msg.text)) return;
  // Atomic claim: if two people answer at the same moment only the first one wins.
  const claim = await run('DELETE FROM active_drops WHERE chat_id=? AND character_id=?', [chatId, character.id]);
  if (claim.changes !== 1) return;
  const added = await addToCollection(msg.from, character, msg.chat);
  await bot.sendMessage(msg.chat.id,
    `🎉 To‘g‘ri, ${displayName(msg.from)}!\n\n${rarityEmoji[character.rarity] || ''} ${character.name}\n🎬 ${character.anime}\n💎 ${character.rarity}\n\n` +
    (added ? '✅ Kolleksiyangizga qo‘shildi!' : 'ℹ️ Bu personaj sizda avvaldan bor edi.'),
    { reply_to_message_id: msg.message_id, allow_sending_without_reply: true }
  );
}

const isCountable = msg => msg.text
  ? !msg.text.startsWith('/')
  : Boolean(msg.photo || msg.sticker || msg.voice || msg.video || msg.animation || msg.audio || msg.video_note || msg.document);

async function countMessage(msg) {
  const chatId = String(msg.chat.id);
  await run('UPDATE user_stats SET messages=messages+1 WHERE user_id=?', [String(msg.from.id)]);
  await run(
    `INSERT INTO group_stats(chat_id, message_count) VALUES(?,1)
     ON CONFLICT(chat_id) DO UPDATE SET message_count=message_count+1`, [chatId]);
  // Atomic reset: only one concurrent message can trigger the drop.
  const reset = await run('UPDATE group_stats SET message_count=0 WHERE chat_id=? AND message_count>=?', [chatId, DROP_EVERY]);
  if (reset.changes === 1) await sendDrop(msg.chat.id);
}

// ============================== USER COMMANDS ==============================
const helpText = name =>
  `Salom, ${name}! 👋\n\nAnime personajlarini toping va kolleksiyangizni yig‘ing. Guruhda har ${DROP_EVERY} ta xabardan keyin yangi personaj chiqadi — ismini birinchi yozgan odam uni oladi!\n\n` +
  '/collection — kolleksiyam\n/profile — profilim\n/rank — umumiy TOP-10\n/grouprank — shu guruh TOP-10\n/stats — bot statistikasi';
cmd('start|help', async msg => {
  await ensureUser(msg.from);
  await bot.sendMessage(msg.chat.id, helpText(msg.from.first_name || 'foydalanuvchi'));
});
cmd('myid', msg => bot.sendMessage(msg.chat.id, `Sizning ID: ${msg.from.id}`));

cmd('stats', async msg => {
  const c = await get('SELECT COUNT(*) AS n FROM characters');
  const u = await get('SELECT COUNT(*) AS n FROM user_stats');
  const owned = await get('SELECT COUNT(*) AS n FROM collections');
  await bot.sendMessage(msg.chat.id, `📊 Bot statistikasi\nPersonajlar: ${c.n}\nFoydalanuvchilar: ${u.n}\nKolleksiyadagi kartalar: ${owned.n}`);
});

const COL_PAGE_SIZE = 15;
async function collectionView(userId, page) {
  const total = (await get('SELECT COUNT(*) AS n FROM collections WHERE user_id=?', [userId])).n;
  if (!total) return { text: 'Kolleksiyangiz hozircha bo‘sh. Guruhda personajlarni toping! 🎴' };
  const pages = Math.ceil(total / COL_PAGE_SIZE);
  page = Math.min(Math.max(Number(page) || 0, 0), pages - 1);
  const rows = await all(
    `SELECT c.name, c.anime, c.rarity FROM collections x JOIN characters c ON c.id=x.character_id
     WHERE x.user_id=?
     ORDER BY CASE c.rarity WHEN 'Legendary' THEN 0 WHEN 'Epic' THEN 1 WHEN 'Rare' THEN 2 ELSE 3 END, c.name COLLATE NOCASE
     LIMIT ? OFFSET ?`, [userId, COL_PAGE_SIZE, page * COL_PAGE_SIZE]);
  const by = await all(
    'SELECT c.rarity, COUNT(*) AS n FROM collections x JOIN characters c ON c.id=x.character_id WHERE x.user_id=? GROUP BY c.rarity', [userId]);
  const summary = rarities.slice().reverse()
    .map(r => `${rarityEmoji[r]} ${(by.find(x => x.rarity === r) || { n: 0 }).n}`).join('  ');
  const lines = rows.map(r => `${rarityEmoji[r.rarity] || ''} ${r.name} — ${r.anime}`);
  const nav = [];
  if (page > 0) nav.push(btn('⬅️', `col:${page - 1}:${userId}`));
  nav.push(btn(`${page + 1}/${pages}`, 'noop'));
  if (page < pages - 1) nav.push(btn('➡️', `col:${page + 1}:${userId}`));
  return {
    text: `🎴 Kolleksiya (${total})\n${summary}\n\n${lines.join('\n')}`,
    kb: pages > 1 ? { inline_keyboard: [nav] } : undefined
  };
}
cmd('collection', async msg => {
  await ensureUser(msg.from);
  const v = await collectionView(String(msg.from.id), 0);
  await bot.sendMessage(msg.chat.id, v.text, { reply_markup: v.kb });
});

cmd('profile', async msg => {
  await ensureUser(msg.from);
  const id = String(msg.from.id);
  const s = await get('SELECT * FROM user_stats WHERE user_id=?', [id]);
  const mine = (await get('SELECT COUNT(*) AS n FROM collections WHERE user_id=?', [id])).n;
  const all_ = (await get('SELECT COUNT(*) AS n FROM characters')).n;
  const better = (await get(
    `SELECT COUNT(*) AS n FROM (SELECT user_id, COUNT(*) AS t FROM collections GROUP BY user_id) WHERE t > ?`, [mine])).n;
  await bot.sendMessage(msg.chat.id,
    `👤 ${displayName(msg.from)}\n\n💬 Xabarlar: ${s.messages}\n🎯 To‘g‘ri topishlar: ${s.correct_guesses}\n🎴 Kolleksiya: ${mine}/${all_}\n🏆 O‘rin: ${mine ? '#' + (better + 1) : '—'}`);
});

cmd('rank', async msg => {
  const rows = await all(
    `SELECT u.user_id, u.username, u.first_name, COUNT(c.character_id) AS total
     FROM user_stats u JOIN collections c ON c.user_id=u.user_id
     GROUP BY u.user_id ORDER BY total DESC, u.correct_guesses DESC LIMIT 10`);
  if (!rows.length) return bot.sendMessage(msg.chat.id, 'Reyting hozircha bo‘sh.');
  await bot.sendMessage(msg.chat.id, `🏆 Umumiy TOP 10 (kolleksiya bo‘yicha):\n\n${rows.map((r, i) => `${medal(i)} ${rowName(r)} — ${r.total}`).join('\n')}`);
});
cmd('grouprank', async msg => {
  if (!isGroupChat(msg.chat)) return bot.sendMessage(msg.chat.id, 'Bu buyruq faqat guruhlarda ishlaydi.');
  const rows = await all(
    `SELECT u.user_id, u.username, u.first_name, g.catches AS total
     FROM group_catches g JOIN user_stats u ON u.user_id=g.user_id
     WHERE g.chat_id=? ORDER BY g.catches DESC LIMIT 10`, [String(msg.chat.id)]);
  if (!rows.length) return bot.sendMessage(msg.chat.id, 'Bu guruhda hali hech kim personaj topmagan.');
  await bot.sendMessage(msg.chat.id, `🏆 Guruh TOP 10 (topgan personajlar):\n\n${rows.map((r, i) => `${medal(i)} ${rowName(r)} — ${r.total}`).join('\n')}`);
});

// ============================== ADMIN: DATA HELPERS ==============================
async function insertCharacter({ name, anime, rarity, aliases, photoId }) {
  const dup = await get('SELECT id FROM characters WHERE LOWER(name)=LOWER(?) AND LOWER(anime)=LOWER(?)', [name, anime]);
  if (dup) return { duplicate: true, id: dup.id };
  const r = await run(
    'INSERT INTO characters(name, anime, rarity, aliases, photo_file_id) VALUES(?,?,?,?,?)',
    [name, anime, rarity, aliases || '', photoId]);
  return { duplicate: false, id: r.id };
}

cmd('addhelp', msg => {
  if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, '⛔ Bu buyruq faqat admin uchun.');
  return bot.sendMessage(msg.chat.id,
    'Eng oson yo‘l: shaxsiy chatda /panel buyrug‘ini yuboring va tugmalardan foydalaning.\nGuruhda nimadir ishlamasa: /diag\n\nYoki qo‘lda:\n1) Botga rasm yuboring.\n2) Caption:\n/addcharacter Ism | Anime | Rarity | alias1,alias2\n\nRarity: Common, Rare, Epic, Legendary\nMisol:\n/addcharacter Gojo Satoru | Jujutsu Kaisen | Legendary | gojo,satoru');
});
bot.on('photo', async msg => {
  try {
    const caption = msg.caption || '';
    if (!/^\/addcharacter(?:@\w+)?(?:\s|$)/i.test(caption)) return;
    if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, '⛔ Faqat admin personaj qo‘sha oladi.');
    if (msg.chat.type !== 'private') return bot.sendMessage(msg.chat.id, '🔒 Personajni faqat shaxsiy chatda qo‘shing.');
    const parts = caption.replace(/^\/addcharacter(?:@\w+)?\s*/i, '').split('|').map(s => s.trim());
    if (parts.length < 3 || !parts[0] || !parts[1] || !parts[2]) {
      return bot.sendMessage(msg.chat.id, 'Format noto‘g‘ri. /panel yoki /addhelp buyrug‘ini ko‘ring.');
    }
    const [name, anime, rarityRaw, aliases = ''] = parts;
    const rarity = rarities.find(r => r.toLowerCase() === rarityRaw.toLowerCase());
    if (!rarity) return bot.sendMessage(msg.chat.id, `Rarity: ${rarities.join(', ')}`);
    const photoId = msg.photo[msg.photo.length - 1].file_id;
    const res = await insertCharacter({ name, anime, rarity, aliases: normalizeAliases(aliases), photoId });
    if (res.duplicate) return bot.sendMessage(msg.chat.id, `⚠️ ${name} (${anime}) allaqachon bazada bor (ID ${res.id}).`);
    await bot.sendMessage(msg.chat.id, `✅ ${name} (${rarity}) bazaga qo‘shildi!`);
  } catch (e) {
    console.error('add photo error:', e);
    bot.sendMessage(msg.chat.id, 'Personajni qo‘shishda xatolik yuz berdi.').catch(() => {});
  }
});

// Admin diagnostics: works in groups even when Group Privacy is ON (commands are always delivered).
cmd('diag', async msg => {
  if (!isAdmin(msg.from.id)) return;
  const chatId = String(msg.chat.id);
  const me = await bot.getMe().catch(() => null);
  if (me) privacyOn = me.can_read_all_group_messages === false;
  const chars = (await get('SELECT COUNT(*) AS n FROM characters')).n;
  const gs = await get('SELECT message_count FROM group_stats WHERE chat_id=?', [chatId]);
  const drop = await get(
    'SELECT c.name FROM active_drops d LEFT JOIN characters c ON c.id=d.character_id WHERE d.chat_id=?', [chatId]);
  let member = '—';
  if (me && isGroupChat(msg.chat)) {
    const m = await bot.getChatMember(msg.chat.id, me.id).catch(e => ({ status: 'xato: ' + e.message }));
    member = m.status +
      (m.can_send_messages === false ? ' ⚠️ xabar yoza olmaydi' : '') +
      (m.can_send_photos === false ? ' ⚠️ rasm yubora olmaydi' : '');
  }
  const err = lastDropError.get(chatId);
  const lines = [
    '🩺 Diagnostika',
    `💬 Chat: ${msg.chat.id} (${msg.chat.type})`,
    `🔢 Sanoq: ${gs ? gs.message_count : 0}/${DROP_EVERY}`,
    `🎴 Personajlar: ${chars}${chars ? '' : ' ❌ baza bo‘sh!'}`,
    `🎯 Faol drop: ${drop ? (drop.name || 'noma’lum') : 'yo‘q'}`,
    `🤖 Botning guruhdagi holati: ${member}`,
    `👁 Group Privacy: ${privacyOn ? 'yoqilgan ⚠️' : 'o‘chirilgan ✅'}`
  ];
  if (privacyOn) lines.push('\nBot guruh ADMINI bo‘lmasa, oddiy xabarlarni ko‘rmaydi (shuning uchun sanoq 0 da turadi). Yechim: botni guruhda admin qiling yoki @BotFather → /setprivacy → Disable va botni guruhdan chiqarib qayta qo‘shing.');
  if (isGroupChat(msg.chat) && !privacyOn && gs && gs.message_count === 0 && chars) lines.push('\nSanoq 0: guruhda bir nechta oddiy xabar yozing va /diag ni qayta yuboring.');
  if (err) lines.push(`\n⚠️ Oxirgi drop xatosi: ${err}`);
  await bot.sendMessage(msg.chat.id, lines.join('\n'));
});

// ============================== ADMIN PANEL (inline buttons) ==============================
const wizards = new Map(); // adminId -> { step, data, ts }
const WIZARD_TTL_MS = 30 * 60 * 1000;
const PAGE_SIZE = 8;
const setWizard = (uid, step, data = {}) => wizards.set(uid, { step, data, ts: Date.now() });

const panelHeader = () => '🛠 Admin panel' +
  (privacyOn ? '\n\n⚠️ Group Privacy yoqilgan: bot guruhdagi oddiy xabarlarni ko‘rmaydi, personaj chiqmaydi.\n@BotFather → /setprivacy → Disable, keyin botni guruhdan chiqarib qayta qo‘shing.' : '');
const mainMenuKb = () => ({
  inline_keyboard: [
    [btn('➕ Personaj qo‘shish', 'ap:add')],
    [btn('📋 Ro‘yxat', 'ap:list:0'), btn('🔎 Qidirish', 'ap:search')],
    [btn('📊 Statistika', 'ap:stats'), btn('⚙️ Sozlamalar', 'ap:settings')],
    [btn('🎴 Test drop', 'ap:drop')],
    [btn('❌ Yopish', 'ap:close')]
  ]
});
const cancelKb = () => ({ inline_keyboard: [[btn('✖️ Bekor qilish', 'ap:cancel')]] });
const backMenuKb = () => ({ inline_keyboard: [[btn('🏠 Menyu', 'ap:menu')]] });

// Edits a text message; if the message is a photo card, replaces it with a new text message.
async function showText(q, text, keyboard) {
  const m = q.message;
  if (m.photo) {
    await bot.deleteMessage(m.chat.id, m.message_id).catch(() => {});
    return bot.sendMessage(m.chat.id, text, { reply_markup: keyboard });
  }
  return bot.editMessageText(text, { chat_id: m.chat.id, message_id: m.message_id, reply_markup: keyboard })
    .catch(ignoreNotModified);
}

async function openPanel(msg) {
  if (!isAdmin(msg.from.id)) return bot.sendMessage(msg.chat.id, '⛔ Siz admin emassiz.');
  if (msg.chat.type !== 'private') {
    return bot.sendMessage(msg.chat.id, '🔒 Admin panel faqat shaxsiy chatda ochiladi. Menga shaxsiy xabar yozing.');
  }
  wizards.delete(msg.from.id);
  return bot.sendMessage(msg.chat.id, panelHeader(), { reply_markup: mainMenuKb() });
}
cmd('admin|panel', openPanel);
cmd('cancel', msg => {
  if (wizards.delete(msg.from.id)) {
    return bot.sendMessage(msg.chat.id, '✖️ Bekor qilindi.', { reply_markup: isAdmin(msg.from.id) ? mainMenuKb() : undefined });
  }
});

async function showList(q, page) {
  const total = (await get('SELECT COUNT(*) AS n FROM characters')).n;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.min(Math.max(Number(page) || 0, 0), pages - 1);
  const rows = await all('SELECT id, name, rarity FROM characters ORDER BY id DESC LIMIT ? OFFSET ?', [PAGE_SIZE, page * PAGE_SIZE]);
  const kb = rows.map(r => [btn(`${rarityEmoji[r.rarity] || ''} ${r.name}`, `ap:view:${r.id}:${page}`)]);
  if (total) {
    const nav = [];
    if (page > 0) nav.push(btn('⬅️', `ap:list:${page - 1}`));
    nav.push(btn(`${page + 1}/${pages}`, 'noop'));
    if (page < pages - 1) nav.push(btn('➡️', `ap:list:${page + 1}`));
    kb.push(nav);
  }
  kb.push([btn('➕ Qo‘shish', 'ap:add'), btn('🔎 Qidirish', 'ap:search')]);
  kb.push([btn('🏠 Menyu', 'ap:menu')]);
  return showText(q, total ? `📋 Personajlar (${total}) — birini tanlang:` : 'Personajlar bazasi bo‘sh.', { inline_keyboard: kb });
}

async function cardData(id, page) {
  const c = await get('SELECT * FROM characters WHERE id=?', [id]);
  if (!c) return null;
  const owners = (await get('SELECT COUNT(*) AS n FROM collections WHERE character_id=?', [id])).n;
  const caption =
    `${rarityEmoji[c.rarity] || ''} ${c.name}\n🎬 ${c.anime}\n💎 ${c.rarity}\n` +
    `🔤 Aliaslar: ${c.aliases || '—'}\n👥 Egalari: ${owners}\n🆔 ID: ${c.id}`;
  const keyboard = {
    inline_keyboard: [
      [btn('✏️ Ism', `ap:edit:name:${id}:${page}`), btn('🎬 Anime', `ap:edit:anime:${id}:${page}`)],
      [btn('🖼 Rasm', `ap:edit:photo:${id}:${page}`), btn('💎 Rarity', `ap:rarmenu:${id}:${page}`)],
      [btn('🔤 Aliaslar', `ap:edit:aliases:${id}:${page}`), btn('🗑 O‘chirish', `ap:del:${id}:${page}`)],
      [btn('⬅️ Ro‘yxatga', `ap:list:${page}`)]
    ]
  };
  return { c, caption, keyboard };
}
async function sendCard(chatId, id, page) {
  const d = await cardData(id, page);
  if (!d) return bot.sendMessage(chatId, 'Personaj topilmadi.', { reply_markup: mainMenuKb() });
  try {
    await bot.sendPhoto(chatId, d.c.photo_file_id, { caption: d.caption, reply_markup: d.keyboard });
  } catch (e) {
    await bot.sendMessage(chatId, d.caption, { reply_markup: d.keyboard });
  }
}
async function showCard(q, id, page) {
  const m = q.message;
  const d = await cardData(id, page);
  if (!d) return showList(q, page);
  if (m.photo) {
    return bot.editMessageCaption(d.caption, { chat_id: m.chat.id, message_id: m.message_id, reply_markup: d.keyboard })
      .catch(ignoreNotModified);
  }
  await bot.deleteMessage(m.chat.id, m.message_id).catch(() => {});
  return sendCard(m.chat.id, id, page);
}

async function finishAdd(chatId, userId) {
  const w = wizards.get(userId);
  if (!w) return;
  wizards.delete(userId);
  const d = w.data;
  const kb = { inline_keyboard: [[btn('➕ Yana qo‘shish', 'ap:add'), btn('📋 Ro‘yxat', 'ap:list:0')], [btn('🏠 Menyu', 'ap:menu')]] };
  const res = await insertCharacter(d);
  if (res.duplicate) {
    return bot.sendMessage(chatId, `⚠️ ${d.name} (${d.anime}) allaqachon bazada bor (ID ${res.id}). Qo‘shilmadi.`, { reply_markup: kb });
  }
  const caption = `✅ Qo‘shildi!\n\n${rarityEmoji[d.rarity]} ${d.name}\n🎬 ${d.anime}\n💎 ${d.rarity}\n🔤 Aliaslar: ${d.aliases || '—'}`;
  try {
    await bot.sendPhoto(chatId, d.photoId, { caption, reply_markup: kb });
  } catch (e) {
    await bot.sendMessage(chatId, caption, { reply_markup: kb });
  }
}

const promptText = text => ({ text: String(text || '').trim() });
const editPrompts = {
  name: '✏️ Yangi ismni yozing:',
  anime: '🎬 Yangi anime nomini yozing:',
  photo: '🖼 Yangi rasmni yuboring:',
  aliases: '🔤 Yangi aliaslarni vergul bilan yozing (masalan: gojo,satoru).\nTozalash uchun "-" yozing.'
};

// Handles text/photo replies while an admin is inside a step-by-step flow. Returns true if consumed.
async function handleWizard(msg) {
  if (msg.chat.type !== 'private' || !isAdmin(msg.from.id)) return false;
  const w = wizards.get(msg.from.id);
  if (!w) return false;
  if (Date.now() - w.ts > WIZARD_TTL_MS) { wizards.delete(msg.from.id); return false; }
  if (msg.text && msg.text.startsWith('/')) return false; // let commands through (/panel, /cancel ...)
  w.ts = Date.now();
  const chatId = msg.chat.id;
  const { text } = promptText(msg.text);
  const again = (t) => bot.sendMessage(chatId, t, { reply_markup: cancelKb() }).then(() => true);

  switch (w.step) {
    case 'photo': {
      if (!msg.photo) return again('📷 Iltimos, personaj rasmini yuboring.');
      w.data.photoId = msg.photo[msg.photo.length - 1].file_id;
      w.step = 'name';
      return again('✍️ 2/5 — Personaj ismini yozing:\n(masalan: Gojo Satoru)');
    }
    case 'name': {
      if (!text) return again('Ismni matn ko‘rinishida yozing.');
      w.data.name = text.slice(0, 100);
      w.step = 'anime';
      return again('🎬 3/5 — Anime nomini yozing:\n(masalan: Jujutsu Kaisen)');
    }
    case 'anime': {
      if (!text) return again('Anime nomini matn ko‘rinishida yozing.');
      w.data.anime = text.slice(0, 100);
      w.step = 'rarity';
      await bot.sendMessage(chatId, '💎 4/5 — Rarity ni tanlang:', {
        reply_markup: {
          inline_keyboard: [
            [btn(`${rarityEmoji.Common} Common`, 'ap:rarsel:0'), btn(`${rarityEmoji.Rare} Rare`, 'ap:rarsel:1')],
            [btn(`${rarityEmoji.Epic} Epic`, 'ap:rarsel:2'), btn(`${rarityEmoji.Legendary} Legendary`, 'ap:rarsel:3')],
            [btn('✖️ Bekor qilish', 'ap:cancel')]
          ]
        }
      });
      return true;
    }
    case 'rarity': {
      await bot.sendMessage(chatId, 'Yuqoridagi tugmalardan birini tanlang 👆');
      return true;
    }
    case 'aliases': {
      w.data.aliases = text === '-' ? '' : normalizeAliases(text);
      await finishAdd(chatId, msg.from.id);
      return true;
    }
    case 'edit': {
      const { field, id, page } = w.data;
      const c = await get('SELECT * FROM characters WHERE id=?', [id]);
      if (!c) {
        wizards.delete(msg.from.id);
        await bot.sendMessage(chatId, 'Personaj topilmadi.', { reply_markup: mainMenuKb() });
        return true;
      }
      if (field === 'photo') {
        if (!msg.photo) return again('🖼 Iltimos, rasm yuboring.');
        await run('UPDATE characters SET photo_file_id=? WHERE id=?', [msg.photo[msg.photo.length - 1].file_id, id]);
      } else {
        if (!text) return again('Matn ko‘rinishida yozing.');
        if (field === 'aliases') {
          await run('UPDATE characters SET aliases=? WHERE id=?', [text === '-' ? '' : normalizeAliases(text), id]);
        } else {
          const name = field === 'name' ? text.slice(0, 100) : c.name;
          const anime = field === 'anime' ? text.slice(0, 100) : c.anime;
          const dup = await get('SELECT id FROM characters WHERE LOWER(name)=LOWER(?) AND LOWER(anime)=LOWER(?) AND id<>?', [name, anime, id]);
          if (dup) return again(`⚠️ ${name} (${anime}) allaqachon bazada bor (ID ${dup.id}). Boshqa nom yozing.`);
          await run('UPDATE characters SET name=?, anime=? WHERE id=?', [name, anime, id]);
        }
      }
      wizards.delete(msg.from.id);
      await sendCard(chatId, id, page);
      return true;
    }
    case 'search': {
      if (!text) return again('🔎 Qidirish uchun ism yoki anime nomini yozing.');
      wizards.delete(msg.from.id);
      const like = `%${text.replace(/[\\%_]/g, m => '\\' + m)}%`;
      const rows = await all(
        `SELECT id, name, anime, rarity FROM characters WHERE name LIKE ? ESCAPE '\\' OR anime LIKE ? ESCAPE '\\'
         ORDER BY name COLLATE NOCASE LIMIT 10`, [like, like]);
      const kb = rows.map(r => [btn(`${rarityEmoji[r.rarity] || ''} ${r.name} — ${r.anime}`, `ap:view:${r.id}:0`)]);
      kb.push([btn('🔎 Yana qidirish', 'ap:search'), btn('🏠 Menyu', 'ap:menu')]);
      await bot.sendMessage(chatId, rows.length ? `🔎 "${text}" bo‘yicha ${rows.length} ta natija:` : `🔎 "${text}" bo‘yicha hech narsa topilmadi.`,
        { reply_markup: { inline_keyboard: kb } });
      return true;
    }
    default:
      return false;
  }
}

function settingsText() {
  const total = rarities.reduce((a, r) => a + RARITY_WEIGHTS[r], 0) || 1;
  const odds = rarities.map(r => `${rarityEmoji[r]} ${r}: ${Math.round((RARITY_WEIGHTS[r] / total) * 100)}%`).join('\n');
  return `⚙️ Sozlamalar (.env orqali o‘zgartiriladi)\n\n📨 Drop: har ${DROP_EVERY} ta xabardan keyin\n⏳ Muddat: ${DROP_TTL_MINUTES ? DROP_TTL_MINUTES + ' daqiqa' : 'cheksiz'}\n\n🎲 Rarity ehtimoli:\n${odds}\n\n👁 Group Privacy: ${privacyOn ? '⚠️ yoqilgan (guruhda ishlamaydi!)' : '✅ o‘chirilgan'}`;
}

bot.on('callback_query', async q => {
  try {
    const data = q.data || '';
    if (data === 'noop') return bot.answerCallbackQuery(q.id).catch(() => {});

    // ----- /collection pagination (only the owner can flip pages) -----
    if (data.startsWith('col:')) {
      const [, page, owner] = data.split(':');
      if (String(q.from.id) !== owner) return bot.answerCallbackQuery(q.id, { text: 'Bu sizning kolleksiyangiz emas.', show_alert: true });
      await bot.answerCallbackQuery(q.id).catch(() => {});
      const v = await collectionView(owner, Number(page));
      return bot.editMessageText(v.text, { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: v.kb })
        .catch(ignoreNotModified);
    }

    // ----- admin panel -----
    if (!data.startsWith('ap:')) return;
    if (!isAdmin(q.from.id)) return bot.answerCallbackQuery(q.id, { text: '⛔ Faqat admin uchun.', show_alert: true });
    if (!q.message || q.message.chat.type !== 'private') {
      return bot.answerCallbackQuery(q.id, { text: 'Panel faqat shaxsiy chatda ishlaydi.', show_alert: true });
    }
    await bot.answerCallbackQuery(q.id).catch(() => {});

    const chatId = q.message.chat.id;
    const messageId = q.message.message_id;
    const uid = q.from.id;
    const [, action, p1, p2, p3] = data.split(':');

    switch (action) {
      case 'menu':
        wizards.delete(uid);
        return showText(q, panelHeader(), mainMenuKb());
      case 'close':
        wizards.delete(uid);
        return bot.deleteMessage(chatId, messageId).catch(() => {});
      case 'cancel':
        wizards.delete(uid);
        return showText(q, '✖️ Bekor qilindi.\n\n' + panelHeader(), mainMenuKb());

      case 'add':
        setWizard(uid, 'photo');
        return showText(q, '📷 1/5 — Personaj rasmini yuboring:', cancelKb());
      case 'rarsel': {
        const w = wizards.get(uid);
        const rarity = rarities[Number(p1)];
        if (!w || w.step !== 'rarity' || !rarity) return showText(q, '⌛ Sessiya tugagan. Qaytadan boshlang.', mainMenuKb());
        w.data.rarity = rarity;
        w.step = 'aliases';
        w.ts = Date.now();
        return showText(q,
          '🔤 5/5 — Aliaslarni vergul bilan yozing (foydalanuvchilar shu nomlar bilan ham topadi):\nmasalan: gojo,satoru\n\nAliassiz qoldirish uchun tugmani bosing yoki "-" yozing.',
          { inline_keyboard: [[btn('⏭ Aliassiz saqlash', 'ap:skipalias')], [btn('✖️ Bekor qilish', 'ap:cancel')]] });
      }
      case 'skipalias': {
        const w = wizards.get(uid);
        if (!w || w.step !== 'aliases') return showText(q, '⌛ Sessiya tugagan.', mainMenuKb());
        w.data.aliases = '';
        await showText(q, '⏳ Saqlanmoqda...', { inline_keyboard: [] });
        return finishAdd(chatId, uid);
      }

      case 'list':
        wizards.delete(uid);
        return showList(q, p1);
      case 'view':
        return showCard(q, Number(p1), Number(p2) || 0);
      case 'search':
        setWizard(uid, 'search');
        return showText(q, '🔎 Personaj ismi yoki anime nomini yozing:', cancelKb());
      case 'edit': {
        if (!editPrompts[p1]) return;
        setWizard(uid, 'edit', { field: p1, id: Number(p2), page: Number(p3) || 0 });
        return bot.sendMessage(chatId, editPrompts[p1], { reply_markup: cancelKb() });
      }
      case 'rarmenu': {
        const row = ids => ids.map(i => btn(`${rarityEmoji[rarities[i]]} ${rarities[i]}`, `ap:rar:${p1}:${i}:${p2}`));
        const kb = { inline_keyboard: [row([0, 1]), row([2, 3]), [btn('⬅️ Orqaga', `ap:view:${p1}:${p2}`)]] };
        return bot.editMessageReplyMarkup(kb, { chat_id: chatId, message_id: messageId }).catch(ignoreNotModified);
      }
      case 'rar': {
        const rarity = rarities[Number(p2)];
        if (!rarity) return;
        await run('UPDATE characters SET rarity=? WHERE id=?', [rarity, Number(p1)]);
        return showCard(q, Number(p1), Number(p3) || 0);
      }
      case 'del': {
        const kb = { inline_keyboard: [[btn('✅ Ha, o‘chirish', `ap:delok:${p1}:${p2}`), btn('↩️ Yo‘q', `ap:view:${p1}:${p2}`)]] };
        return bot.editMessageReplyMarkup(kb, { chat_id: chatId, message_id: messageId }).catch(ignoreNotModified);
      }
      case 'delok': {
        const id = Number(p1);
        const c = await get('SELECT name FROM characters WHERE id=?', [id]);
        if (c) {
          await run('DELETE FROM collections WHERE character_id=?', [id]);
          await run('DELETE FROM active_drops WHERE character_id=?', [id]);
          await run('DELETE FROM characters WHERE id=?', [id]);
        }
        return showText(q, c ? `🗑 ${c.name} o‘chirildi.` : 'Personaj topilmadi.',
          { inline_keyboard: [[btn('📋 Ro‘yxat', `ap:list:${Number(p2) || 0}`), btn('🏠 Menyu', 'ap:menu')]] });
      }

      case 'stats': {
        const c = await get('SELECT COUNT(*) AS n FROM characters');
        const u = await get('SELECT COUNT(*) AS n FROM user_stats');
        const owned = await get('SELECT COUNT(*) AS n FROM collections');
        const g = await get('SELECT COUNT(*) AS n FROM group_stats');
        const by = await all('SELECT rarity, COUNT(*) AS n FROM characters GROUP BY rarity');
        const rl = rarities.map(r => `${rarityEmoji[r]} ${r}: ${(by.find(x => x.rarity === r) || { n: 0 }).n}`).join('\n');
        return showText(q,
          `📊 Statistika\n\nPersonajlar: ${c.n}\n${rl}\n\nFoydalanuvchilar: ${u.n}\nGuruhlar: ${g.n}\nKolleksiyadagi kartalar: ${owned.n}`, backMenuKb());
      }
      case 'settings':
        return showText(q, settingsText(), backMenuKb());
      case 'drop': {
        const dropped = await sendDrop(chatId, { announceEmpty: true });
        const err = lastDropError.get(String(chatId));
        if (!dropped && err) {
          await bot.sendMessage(chatId, `⚠️ Drop yuborilmadi: ${err}\n\nEhtimol personaj rasmi boshqa bot tokeni bilan qo‘shilgan. Rasmni shu bot orqali qayta yuklang (✏️ Rasm).`);
        }
        return;
      }
      default:
        return;
    }
  } catch (e) {
    console.error('callback error:', e);
    bot.answerCallbackQuery(q.id, { text: 'Xatolik yuz berdi.' }).catch(() => {});
  }
});

// ============================== MAIN MESSAGE HANDLER ==============================
bot.on('message', async msg => {
  try {
    if (!msg.from || msg.from.is_bot) return;
    await ensureUser(msg.from);
    if (await handleWizard(msg)) return;

    // 1) Guess check (active drop in this chat; text only)
    if (msg.text && !msg.text.startsWith('/') && msg.text.length <= 100) await tryGuess(msg);

    // 2) Count group activity -> spawn a new character every DROP_EVERY messages
    if (isGroupChat(msg.chat) && isCountable(msg)) await countMessage(msg);
  } catch (e) {
    console.error('message handler error:', e);
  }
});

bot.on('polling_error', err => {
  console.error('Telegram polling error:', err.message);
  if (/409/.test(err.message)) console.error('⚠️  409 Conflict: shu token bilan boshqa joyda ham bot ishlayapti (eski Python bot, ikkinchi deploy, kompyuter). Bittasidan boshqasini to‘xtating.');
});
bot.on('error', err => console.error('Bot error:', err.message));
process.on('unhandledRejection', e => console.error('Unhandled rejection:', e));

// ============================== STARTUP ==============================
init()
  .then(async () => {
    await bot.startPolling();
    const me = await bot.getMe().catch(() => null);
    if (me) {
      botUsername = me.username || '';
      privacyOn = me.can_read_all_group_messages === false;
      if (privacyOn) console.warn('⚠️  Group Privacy is ON: the bot cannot see ordinary group messages. BotFather -> /setprivacy -> Disable.');
    }
    setInterval(() => sweepExpiredDrops().catch(e => console.error('sweep error:', e)), 15000);
    console.log(`Uzbek Waifu Bot ishga tushdi! (drop har ${DROP_EVERY} xabarda, muddat ${DROP_TTL_MINUTES} daq)`);
  })
  .catch(err => {
    console.error('Startup failed:', err);
    process.exit(1);
  });

const shutdown = () => Promise.resolve(bot.stopPolling()).catch(() => {}).finally(() => process.exit(0));
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
