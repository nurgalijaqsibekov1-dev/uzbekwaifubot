# Uzbek Waifu Game (Node.js)

Telegram bot: `@UzbekWaifuBot`

## Features
- A random character appears after every `DROP_EVERY` (default 50) messages in a group. Text, photos, stickers, voice, video etc. all count; commands do not.
- Drops follow rarity odds (`RARITY_WEIGHTS`, default Common 60 / Rare 25 / Epic 10 / Legendary 5) and never repeat back-to-back in the same chat.
- The first person to type the name (or an alias) wins the card. Matching ignores case, accents, punctuation and word order, and two simultaneous answers cannot both win.
- Unguessed characters run away after `DROP_TTL_MINUTES` (default 5; `0` = never) and the chat is told who it was.
- Commands: `/collection` (paginated, sorted by rarity), `/profile`, `/rank` (global), `/grouprank` (this group), `/stats`.
- Admin panel with inline buttons (`/panel`, private chat only): add characters step by step, browse and search, edit name / anime / photo / rarity / aliases, delete with confirmation, stats, settings overview, test drop. It also warns you if Telegram's Group Privacy mode would stop the bot from seeing group messages.
- Legacy admin command still works in private chat: send a photo with caption `/addcharacter Name | Anime | Rarity | aliases`
- SQLite database (existing databases from v1.0 keep working; one new table is added automatically).
- HTTP health endpoint at `/health` for hosting platforms.

## Configuration (.env)
| Variable | Default | Meaning |
|---|---|---|
| `BOT_TOKEN` | – | Telegram bot token (required) |
| `ADMIN_IDS` | – | Comma-separated numeric Telegram IDs (`/myid` shows yours) |
| `DROP_EVERY` | 50 | Messages per drop in each group |
| `DROP_TTL_MINUTES` | 5 | Minutes before an unguessed character runs away (0 = never) |
| `RARITY_WEIGHTS` | Common:60,Rare:25,Epic:10,Legendary:5 | Relative drop chances |
| `DATABASE_PATH` | ./data/anime.db | SQLite file |
| `PORT` | 3000 | Health server port |

## Setup locally
1. Install Node.js 20 or newer.
2. Copy `.env.example` to `.env`.
3. Put your Telegram token in `BOT_TOKEN`. Keep it secret.
4. Set `ADMIN_IDS` to comma-separated Telegram numeric user IDs.
5. Install dependencies: `npm install`
6. Start: `npm start`

## Admin panel
Open a private chat with the bot and send `/panel`.
- ➕ Add character: photo → name → anime → rarity (buttons) → aliases (or skip).
- 📋 List / 🔎 Search: open a character to edit its name, anime, photo, rarity, aliases, or delete it.
- 📊 Statistics, ⚙️ Settings (shows the active `.env` values), 🎴 Test drop (cards won from a test drop are added to your own collection).
Duplicate characters (same name + anime) are rejected. Deleting a character also removes it from every user's collection. An unfinished add/edit flow expires after 30 minutes or with `/cancel`.

## Group setup
1. Add the bot to the group.
2. In BotFather, use `/setprivacy`, select the bot, and choose **Disable** so it can count ordinary group messages.
3. Ensure the bot can send messages in the group.
4. The bot posts a new drop after every `DROP_EVERY` non-command group messages. If Group Privacy is still on, `/panel` shows a warning.

## Docker
Build:
`docker build -t uzbek-waifu-game .`

Run (mount a persistent folder for SQLite):
`docker run -d --name waifu-bot --restart unless-stopped --env-file .env -v waifu-data:/data uzbek-waifu-game`

## Render notes
This project uses Telegram long polling. Use a service type that supports a continuously running process (Background Worker where available), set:
- Build command: `npm install`
- Start command: `npm start`
- Environment variables: `BOT_TOKEN`, `ADMIN_IDS`, `DATABASE_PATH=/data/anime.db`

Attach a persistent disk mounted at `/data` if the Render plan supports it. Without persistent storage, SQLite data may be lost on redeploy/restart.
A free web service may sleep and is not a reliable 24/7 host. If using a Web Service, the included `/health` endpoint binds to `PORT`, but sleep limits still apply.

## Existing Python database
The original Python `anime.db` schema was not included when this Node.js package was generated. This project creates its own SQLite tables. Do not replace your existing database with the new one until you have a backup and have checked/imported the old schema.
