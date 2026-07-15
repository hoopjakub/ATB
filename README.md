# ALL THE BULLSHIT

Hosted mini-games platform for you and your friends. Game #1: a real-time multiplayer **tier list maker**. Game #2: a real-time **alignment chart** (2-axis plot, live percentages, quadrant stats). Live cursors, live drags, rooms, passcodes, image search, uploads.

## Run it

```
npm install
npm start          # → http://localhost:3000
```

That's it. No accounts, no cloud services, no keys. Everything (rooms, boards, uploaded images) is stored locally in `data/` (SQLite + upload files).

For development with hot reload:

```
npm run dev        # server on :3000, Vite dev server on :5173 (open :5173)
npm run build      # rebuild the production bundle in dist/ (npm start serves it)
```

## Give your friends a link (instant, free, no account)

One-time install of Cloudflare's tunnel client:

```
winget install Cloudflare.cloudflared
```

Then, with the app running (`npm start`), in a second terminal:

```
.\share.ps1
```

It prints a `https://….trycloudflare.com` URL — paste it in the group chat. The link lives as long as your PC, the server, and the tunnel window stay up, and the URL changes each time you restart the tunnel.

## Permanent hosting on Render (free)

This app is one plain Node process (Express + Socket.io + SQLite) — it does **not** work on Vercel, which only runs stateless serverless functions and can't hold a websocket connection or a writable database file open. Render (or Railway) runs a normal always-on process instead, which is what this needs.

1. Push this folder to a GitHub repo (see below).
2. On [render.com](https://render.com), **New → Blueprint**, pick the repo — it reads `render.yaml` and sets everything up automatically.
3. Add your `RAWG_API_KEY` in the Render dashboard's environment variables (Render will prompt for it since the blueprint marks it as a secret).
4. Deploy. You get a permanent `https://something.onrender.com` URL.

**Important caveat**: Render's **free** plan has no persistent disk — anything written to `data/` (the SQLite file, uploaded images) is wiped on every redeploy and may not survive a restart either. Fine if you're OK with rooms occasionally resetting; if you want rooms/uploads to actually last, upgrade that one service to Render's **Starter** plan (~$7/mo) and attach a persistent disk mounted at `data/` — ask me and I'll wire up the disk config when you're ready.

### Push this to GitHub

```
git init                                   # already done for you
git add -A
git commit -m "initial commit"             # already done for you
```

Then create an empty repo on [github.com/new](https://github.com/new) (no README/gitignore — this repo already has them) and run the two commands GitHub shows you, e.g.:

```
git remote add origin https://github.com/YOUR_USERNAME/all-the-bullshit.git
git branch -M main
git push -u origin main
```

Or, since you have GitHub Desktop installed: **File → Add Local Repository**, point it at `D:\ATB`, then **Publish repository**.

## Image sources

| Source | Status |
|---|---|
| Upload (drag & drop, up to 10 files, 8 MB each) | works out of the box |
| Paste any image URL | works out of the box |
| Anime + characters (MyAnimeList via Jikan) | works out of the box, no key — occasionally flaky because Jikan is a shared free API; the server retries + caches |
| Game covers (RAWG) | needs a free key from [rawg.io/apidocs](https://rawg.io/apidocs) → put `RAWG_API_KEY=...` in `.env` and restart |

## How it's built

- **One Node process**: Express + Socket.io + better-sqlite3, serving the built React SPA from `dist/`.
- **Two realtime layers**, deliberately separate:
  - *Ephemeral* (cursors, drag ghosts, presence): volatile socket broadcasts, never persisted.
  - *Persistent* (board state): clients send ops (`moveItem`, `addMedia`, `updateTier`, …), the server validates and applies them to its authoritative copy, broadcasts the full new state to everyone, and debounce-saves to SQLite. Last write wins; clients apply moves optimistically and reconcile on the server echo.
- **Platform vs. game**: rooms/presence/passcodes/media are generic platform code (`server/rooms.js`, `server/media.js`); everything tier-list-specific lives in `server/tierlist.js` + `src/games/tierlist/`. Game #2 = a new module with `initialState()` + `applyOp()` and a frontend component.

## Rooms

- Public rooms are listed in the lobby; private rooms are join-by-code only, with an optional passcode (scrypt-hashed).
- Room codes are 6 characters, e.g. `K3V9QX` — the invite link is `/room/CODE`.
- The room owner can rename the room, edit/remove tiers, remove images, and nuke the room. Everyone can add images and drag.
- Identity is nickname-only, stored in the browser. No accounts.
