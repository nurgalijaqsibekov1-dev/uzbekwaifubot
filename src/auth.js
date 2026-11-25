const crypto = require('crypto');
function verifyInitData(initData, token = process.env.BOT_TOKEN) {
  if (!initData || !token) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(token).digest();
  const calculated = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(hash))) return null;
  try {
    const authDate = Number(params.get('auth_date'));
    if (!authDate || authDate > Date.now()/1000 + 30 || Date.now()/1000 - authDate > 86400) return null;
    return JSON.parse(params.get('user') || '{}');
  } catch { return null; }
}

module.exports = { verifyInitData };
