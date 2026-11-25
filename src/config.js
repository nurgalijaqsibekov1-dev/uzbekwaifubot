const fs = require('fs');
const path = require('path');
function databaseOptions(env = process.env) {
  let url;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('DATABASE_URL kiritilmagan yoki noto‘g‘ri. Supabase → Connect → Session pooler manzilini .env ga kiriting.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.username || !url.password || !url.hostname || !url.pathname.slice(1)) throw new Error('DATABASE_URL PostgreSQL ulanish manzili bo‘lishi kerak.');
  if (/^(HOST|USER|PASSWORD)$/i.test(url.hostname) || /\[|\]|YOUR_|PROJECT-REF|POOLER-HOST|PUT_YOUR/i.test(decodeURIComponent(url.href)) || url.password === 'PASSWORD') throw new Error('DATABASE_URL ichida namuna qiymatlari qolgan. Supabase bergan haqiqiy manzil va baza parolini kiriting.');
  if (url.search) throw new Error('DATABASE_URL oxiridagi ?... parametrlarini olib tashlang. SSL DATABASE_SSL orqali sozlanadi.');
  const max = Number(env.DB_POOL_MAX || 3);
  if (!Number.isInteger(max) || max < 1 || max > 20) throw new Error('DB_POOL_MAX 1–20 oralig‘ida bo‘lishi kerak.');
  const sslEnabled = env.DATABASE_SSL !== 'false';
  let ssl = false;
  if (sslEnabled) {
    ssl = { rejectUnauthorized: true };
    if (env.DATABASE_CA_PATH) ssl.ca = fs.readFileSync(path.resolve(__dirname, '..', env.DATABASE_CA_PATH), 'utf8');
  }
  return { connectionString: url.href, ssl, max, connectionTimeoutMillis: 15000, idleTimeoutMillis: 30000, statement_timeout: 20000, application_name: 'UzbekWaifuBot' };
}
function validateBot(env = process.env) {
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(env.BOT_TOKEN || '')) throw new Error('BOT_TOKEN: BotFather bergan tokenni .env ga yozing.');
  if (env.APP_URL) {
    let u; try { u = new URL(env.APP_URL); } catch { throw new Error('APP_URL noto‘g‘ri.'); }
    if (u.protocol !== 'https:' || u.hostname.endsWith('example.com')) throw new Error('APP_URL haqiqiy HTTPS manzil bo‘lsin yoki mahalliy sinovda bo‘sh qoldiring.');
  }
  for (const key of ['DAILY_REWARD', 'CATCH_REWARD', 'PORT']) {
    if (env[key] && (!Number.isInteger(Number(env[key])) || Number(env[key]) < 1 || Number(env[key]) > (key === 'PORT' ? 65535 : 1000000))) throw new Error(`${key} noto‘g‘ri son.`);
  }
  if (env.ADMIN_IDS && !/^\d+(\s*,\s*\d+)*$/.test(env.ADMIN_IDS)) throw new Error('ADMIN_IDS: raqamli Telegram ID yozing.');
}
function friendlyError(err) {
  const code = err.code || err.response?.error_code;
  const messages = {
    ENOTFOUND: 'Baza hosti topilmadi. DATABASE_URL va internetni tekshiring.',
    ENETUNREACH: 'Tarmoq bazaga yetib bormadi. Supabase Session pooler (IPv4) manzilidan foydalaning.',
    ECONNREFUSED: 'Baza ulanishni rad etdi. Host, port va loyiha holatini tekshiring.',
    ETIMEDOUT: 'Ulanish vaqti tugadi. Internet va baza holatini tekshiring.',
    '28P01': 'Baza paroli noto‘g‘ri. Supabase database password qiymatini tekshiring.',
    '42501': 'Baza foydalanuvchisida sxema/jadval uchun ruxsat yetarli emas.',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'SSL sertifikati tasdiqlanmadi. Supabase CA sertifikatini DATABASE_CA_PATH orqali ko‘rsating.',
    SELF_SIGNED_CERT_IN_CHAIN: 'Supabase CA sertifikatini yuklab, DATABASE_CA_PATH ga fayl yo‘lini yozing.',
    401: 'Telegram BOT_TOKEN noto‘g‘ri.',
    409: 'Botning boshqa nusxasi ishlayapti. Faqat bitta nusxani qoldiring.'
  };
  return messages[code] || 'Amal bajarilmadi. Baza, tarmoq va sozlamalarni tekshiring.';
}
module.exports = { databaseOptions, validateBot, friendlyError };
