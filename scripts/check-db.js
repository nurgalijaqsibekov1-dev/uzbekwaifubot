require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { databaseOptions, friendlyError } = require('../src/config');
(async () => {
  let pool;
  try {
    databaseOptions();
    const db = require('../src/db'); pool = db.pool;
    await db.initDb();
    const result = await db.query('SELECT COUNT(*)::int AS n FROM waifu.characters');
    console.log(`OK: baza ulandi, jadvallar tayyor. Personajlar: ${result.rows[0].n}`);
  } catch (err) {
    console.error(err.code ? friendlyError(err) : err.message);
    process.exitCode = 1;
  } finally { if (pool) await pool.end(); }
})();
