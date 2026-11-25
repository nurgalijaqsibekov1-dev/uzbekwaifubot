const words = {
  uz: {
    welcome: 'Xush kelibsiz, {name}! 🎴\\nPersonajlar kolleksiyasini yig‘ishni boshlang.',
    help: 'Buyruqlar:\\n/daily — kunlik coin\\n/profile — profilingiz\\n/collection — kartalaringiz\\n/shop — do‘kon\\n/stats — statistika\\n/catch ID — personajni tutish',
    daily: 'Siz {coins} coin oldingiz! 💰',
    dailyWait: 'Kunlik mukofotni allaqachon oldingiz. Ertaga yana keling!',
    noSpawn: 'Hozir faol personaj yo‘q. Admin /spawn yuborishi mumkin.',
    caught: '🎉 {name} sizning kolleksiyangizga qo‘shildi!',
    missed: 'Bu personajni boshqa foydalanuvchi tutib oldi yoki vaqt tugadi.',
    notEnough: 'Coin yetarli emas.',
    bought: 'Xarid muvaffaqiyatli: {name}!',
    empty: 'Kolleksiyangiz hozircha bo‘sh.'
  },
  en: {
    welcome: 'Welcome, {name}! 🎴\\nStart building your character collection.',
    help: 'Commands:\\n/daily — daily coins\\n/profile — your profile\\n/collection — your cards\\n/shop — shop\\n/stats — statistics\\n/catch ID — catch a character',
    daily: 'You received {coins} coins! 💰',
    dailyWait: 'You already claimed your daily reward. Come back tomorrow!',
    noSpawn: 'There is no active character right now. An admin can use /spawn.',
    caught: '🎉 {name} has been added to your collection!',
    missed: 'Someone else caught this character, or the timer expired.',
    notEnough: 'Not enough coins.',
    bought: 'Purchase successful: {name}!',
    empty: 'Your collection is empty for now.'
  }
};
function t(lang, key, vars = {}) {
  let value = (words[lang] || words.uz)[key] || words.uz[key] || key;
  for (const [k, v] of Object.entries(vars)) value = value.replaceAll(`{${k}}`, String(v));
  return value;
}
module.exports = { t };
