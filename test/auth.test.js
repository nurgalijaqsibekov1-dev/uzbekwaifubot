const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { verifyInitData } = require('../src/auth');
const token='123:secret';
function signed(date) {
 const params=new URLSearchParams({auth_date:String(date),user:JSON.stringify({id:123,first_name:'Test'})});
 const secret=crypto.createHmac('sha256','WebAppData').update(token).digest();
 const text=[...params].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 params.set('hash',crypto.createHmac('sha256',secret).update(text).digest('hex'));
 return params.toString();
}
test('valid Telegram signature accepted',()=>assert.equal(verifyInitData(signed(Math.floor(Date.now()/1000)),token).id,123));
test('malformed, tampered, expired and future signatures rejected',()=>{
 for(const data of ['hash=a',signed(1),signed(Math.floor(Date.now()/1000)+3600),signed(Math.floor(Date.now()/1000)).replace('Test','Fake')]) assert.equal(verifyInitData(data,token),null);
});
