---
name: atb-platform
description: Orientation for the ALL THE BULLSHIT (ATB) codebase at D:\ATB — a room-based multiplayer mini-games platform. Use this whenever working on D:\ATB, adding a new game, touching server/rooms.js, useRoom.ts, or anything under src/games/. Covers architecture, the game-module contract, deployment, and known gotchas.
---

# ALL THE BULLSHIT (ATB)

A room-based multiplayer mini-games platform for a friend group. Four games live today: **Tier List**, **Alignment Chart**, **Anime Showdown** (bracket voting), **Rating** (shared anime scoreboard). Not affiliated with anything, deliberately unhinged tone throughout.

## Stack

- **Server**: Express + Socket.io, single Node process. `server/index.js` is a tiny bootstrap (loads `.env` if present, then dynamically imports `server/app.js` — see "ES import hoisting gotcha" below). `server/app.js` has all routes + socket wiring.
- **Persistence**: Supabase Postgres via `@supabase/supabase-js`, wrapped in `server/db.js` as an async `queries` object. `state` is a native `jsonb` column. Schema in `supabase/schema.sql` — run once in the Supabase SQL Editor, no automated migrations.
- **Client**: React 18 + Vite SPA, `src/`. `npm run dev` runs both (concurrently) with Vite proxying `/api` and `/socket.io` to the Express server on :3000.
- **Deploy**: Render (`render.yaml`), free tier, `npm run build && npm start`. No persistent disk — see "known gaps" below.

## Adding a new game — the module contract

Every game is a `slug` registered in `server/rooms.js`'s `GAMES` map: `{ slug, display_name, tagline, icon, module }`. The module (`server/<game>.js`) must export:

- `initialState(gameOptions?)` — returns the fresh state blob for a new room.
- `applyOp(state, op, ctx)` — mutates `state` in place given an op and `ctx = { userId, nick, isOwner, presenceIds }`. Throw on invalid ops; the server catches and resyncs the sender.
- `sanitize(state)` (optional) — self-heals state loaded from the DB (e.g. orphaned references) on room load.

Client side: `src/games/<game>/<Game>Board.tsx`, registered in `src/pages/Room.tsx`'s `BOARDS` map. Call `useRoom<StateType, OpType>(roomId, user)` from `src/lib/useRoom.ts` — it's fully generic, handles the socket connection, ops, presence, cursors/drags, and chat. Reuse the shared components: `src/games/shared/CursorLayer.tsx`, `MediaDrawer.tsx` (AniList/RAWG search + upload + paste-URL), `ChatPanel.tsx`.

Add the game's room-name placeholder examples to `NAME_EXAMPLES` in `src/pages/Lobby.tsx` — don't fall back to the tierlist defaults for a new game.

## Sync model

Ops-in / full-state-out: client sends a small op over the `op` socket event with an optional client-side optimistic mutation (applied immediately, then overwritten by the server's authoritative broadcast). Server is last-write-wins, no CRDT. Ephemeral stuff (cursors, drag ghosts) goes over separate volatile socket events (`cursor`, `drag:start/move/end`) and is never persisted. Room state is debounce-persisted (800ms) via `schedulePersist` in `rooms.js`.

Chat: `entry.chat` is in-memory only (last 100 messages), sent on `room:init`, broadcast via `chat:message`. Identity changes (nick/color) push live via a `user:update` socket event so everyone sees the change immediately, not just on next reconnect — see `useRoom.ts`'s dedicated effect for this.

## External APIs used (no keys needed except RAWG)

- **AniList GraphQL** (`https://graphql.anilist.co`) — anime/manga/character search, user list import (`MediaListCollection`), user search (`Page.users`). No auth for public data. Far more reliable than Jikan (which this project migrated away from).
- **AnimeThemes.moe** (`https://api.animethemes.moe`) — real OP/ED theme videos for the Showdown game, join key is `resources[].site === "AniList"` cross-reference. Needs a browser-shaped `User-Agent` header or Cloudflare 403s it (Node's fetch sends none by default).
- **RAWG** — game covers, needs `RAWG_API_KEY` in `.env`, gracefully degrades without it.

## Known gaps (check `next-fixes.md` before assuming these are fixed)

- Uploaded images (multer, `data/uploads`) are NOT in Supabase Storage yet — still on Render's ephemeral disk, wiped on redeploy.
- A rating-room participant who votes once and vanishes blocks reveals forever unless the owner uses `removeParticipant`.
- Unrevealed rating votes ride in the full-state broadcast (devtools-peekable) — accepted tradeoff at friend-group scale.

## Gotchas (already hit, already fixed — don't reintroduce)

- **ES import hoisting**: static `import` statements execute before any other top-level code in a file, regardless of source order. This is why `.env` loading is a separate tiny `server/index.js` that *dynamically* imports `server/app.js`, rather than loading env vars inline before other imports in one file.
- **Supabase + Node 20**: `createClient()` builds a `RealtimeClient` internally even though this app only uses REST — needs `realtime: { transport: WebSocket }` (from the `ws` package) or it throws on Node 20 (no native WebSocket until Node 22).
- **`html-to-image` + Google Fonts**: the CORS-restricted stylesheet needs `crossorigin="anonymous"` on the `<link>` tag in `index.html`, or font embedding hangs instead of failing cleanly.
- **AniList quirks**: `score(format: POINT_10_DECIMAL)` returns `0` for unscored entries — must map to `null`, not a real zero. Unknown/private users come back as HTTP 404.
