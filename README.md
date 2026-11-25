# UzbekWaifuBot — Supabase versiyasi

Node.js 20+ va Supabase PostgreSQL kerak. Bot kompyuter/serverda ishlaydi;
Supabase ma’lumotlarni saqlaydi. Supabase API key talab qilinmaydi.

## Windows PowerShell

ZIPni oching, UzbekWaifuBot papkasida terminal oching:

```powershell
npm install
Copy-Item .env.example .env
notepad .env
npm run db:check
npm start
```

Agar .env avvaldan bo‘lsa, ustiga nusxalamang; uni tahrirlang.

1. Supabase loyihangizni oching → Connect → Session pooler → URI.
2. Haqiqiy URI ni DATABASE_URL ga yozing. [YOUR-DATABASE-PASSWORD] o‘rniga
   loyihani yaratganda kiritilgan baza parolini yozing (hisob paroli emas).
   Host va username ni o‘zingiz tuzmang; Connect oynasidan to‘liq oling.
3. Paroldagi maxsus belgilar URL-encoded bo‘lsin: @ → %40, # → %23,
   : → %3A, / → %2F, % → %25. Butun URI emas, faqat parol kodlanadi.
4. BOT_TOKEN ga BotFather tokeni, ADMIN_IDS ga raqamli Telegram ID yozing.
5. Mahalliy bot sinovida APP_URL bo‘sh qolishi mumkin. Mini App va admin panel
   uchun ushbu Node ilovasi joylashtirilgan haqiqiy HTTPS manzilini kiriting.
6. SSL xatosida Supabase bazaning SSL settings bo‘limidan CA sertifikatini
   yuklab, loyiha ichiga qo‘ying va DATABASE_CA_PATH=prod-ca-2021.crt kabi yozing.
   Sertifikat tekshiruvi doim yoqilgan. DATABASE_SSL=false faqat mahalliy PostgreSQL uchun.

Session pooler IPv4 tarmoqlariga mos; port odatda 5432. Manzil oxiriga
?sslmode=... qo‘shmang: SSL alohida sozlangan.

## Ma’lumotlar

Jadvallar birinchi ishga tushishda `waifu` sxemasida atomik yaratiladi.
Supabase Table Editor da shu sxemani tanlang. `waifu` ni Data API exposed schemas
ro‘yxatiga qo‘shmang va anon/authenticated rollariga ruxsat bermang.
Frontend faqat Telegram imzosi tekshiriladigan Node API orqali ishlaydi.

SEED_DEMO=true bo‘lsa, bo‘sh bazaga 6 boshlang‘ich personaj qo‘shiladi.
false qilsangiz, admin paneldan o‘zingiz qo‘shasiz.
Qayta ishga tushirish mavjud waifu ma’lumotlarini o‘chirmaydi.
Oldingi versiyaning public sxemasidagi ma’lumotlar avtomatik ko‘chirilmaydi;
agar mavjud bo‘lsa, zaxira oling va alohida migratsiya qiling.

## Buyruqlar

/start, /help, /lang uz, /lang en, /profile, /daily (20 soatda bir),
/collection, /shop, /buy ID, /stats.
Admin guruhda /spawn yuboradi, o‘yinchi /catch ID bilan kartani tutadi.
Spawn 5 daqiqada tugaydi. Avtomatik spawn bu versiyada yo‘q.
Admin sahifa: APP_URL/admin, Telegram Mini App kontekstida ochiladi.

## Tekshirish va ishlatish

`npm test` konfiguratsiya sinovlari; `npm run db:check` haqiqiy bazani tekshiradi
va kerakli jadvallarni yaratadi. Xarid, daily va catch tranzaksiyalarda bajariladi.
Bitta bot nusxasini ishlating. Ctrl+C bilan to‘xtating.
Kompyuter o‘chsa bot ham to‘xtaydi; doimiy ishlash uchun Node server kerak.
.env va node_modules ZIP/GitHubga qo‘shilmaydi.

Rasmiy yo‘riqnomalar:
https://supabase.com/docs/guides/database/connecting-to-postgres
https://supabase.com/docs/guides/database/postgres/row-level-security
