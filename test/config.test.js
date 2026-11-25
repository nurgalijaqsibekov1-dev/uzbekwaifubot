const { test } = require('node:test');
const assert = require('node:assert/strict');
const { databaseOptions, validateBot, friendlyError } = require('../src/config');
const base = { DATABASE_URL: 'postgresql://postgres.abc:safe%40password@db.example.net:5432/postgres' };
test('missing and placeholder URLs rejected before networking', () => {
 for (const DATABASE_URL of ['', 'https://example.com', 'postgresql://USER:PASSWORD@HOST:5432/DATABASE', 'postgresql://postgres:[YOUR-DATABASE-PASSWORD]@db.example.net:5432/postgres']) assert.throws(() => databaseOptions({DATABASE_URL}));
});
test('TLS verification enabled; encoded password retained', () => {
 const options=databaseOptions(base); assert.equal(options.ssl.rejectUnauthorized,true); assert.match(options.connectionString, /safe%40password/); assert.equal(options.max,3);
});
test('URL parameters cannot silently disable certificate verification', () => assert.throws(() => databaseOptions({DATABASE_URL: base.DATABASE_URL+'?sslmode=no-verify'})));
test('rejects invalid pool sizes', () => assert.throws(() => databaseOptions({...base,DB_POOL_MAX:'0'})));
test('local mode allows empty APP_URL', () => validateBot({BOT_TOKEN:'123456:'+ 'a'.repeat(30)}));
test('invalid app, token and rewards rejected', () => {
 assert.throws(() => validateBot({BOT_TOKEN:'placeholder'}));
 assert.throws(() => validateBot({BOT_TOKEN:'123:'+ 'a'.repeat(30),APP_URL:'http://localhost'}));
 assert.throws(() => validateBot({BOT_TOKEN:'123:'+ 'a'.repeat(30),DAILY_REWARD:'-20'}));
});
test('error output does not leak connection secrets', () => assert.ok(!friendlyError(new Error(base.DATABASE_URL)).includes('password')));
