import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import { UPLOADS_DIR } from "./db.js";
import { mediaRouter } from "./media.js";
import {
  GAMES,
  applyGameUpdate,
  attachSockets,
  createRoom,
  deleteRoom,
  getRoomMeta,
  getRoomRow,
  listPublicRooms,
  makeJoinToken,
  verifyPasscode,
} from "./rooms.js";
import { autofillEntries } from "./showdownSeed.js";
import { SIZES } from "./showdown.js";
import { fetchAniListUserList, UnknownUserError } from "./ratingImport.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---- API ----------------------------------------------------------------------
app.get("/api/games", (_req, res) => {
  res.json({
    games: Object.values(GAMES).map(({ slug, display_name, tagline, icon }) => ({
      slug,
      display_name,
      tagline,
      icon,
    })),
  });
});

app.get("/api/rooms", async (req, res) => {
  const game = String(req.query.game || "tierlist");
  if (!GAMES[game]) return res.status(404).json({ error: "unknown game" });
  try {
    res.json({ rooms: await listPublicRooms(game) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/rooms", async (req, res) => {
  const { game, name, visibility, passcode, user, gameOptions } = req.body || {};
  if (!user?.id || !user?.nick) return res.status(400).json({ error: "who are you?" });
  try {
    const { id, token } = await createRoom({ game, name, visibility, passcode, user, gameOptions });
    res.json({ id, token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/rooms/:id", async (req, res) => {
  try {
    const meta = await getRoomMeta(req.params.id.toUpperCase());
    if (!meta) return res.status(404).json({ error: "room not found" });
    res.json({ room: meta });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/rooms/:id/join", async (req, res) => {
  const id = req.params.id.toUpperCase();
  try {
    const row = await getRoomRow(id);
    if (!row) return res.status(404).json({ error: "room not found" });
    if (row.passcode_hash) {
      const { passcode, userId } = req.body || {};
      const isOwner = userId && userId === row.owner_id;
      if (!isOwner && (!passcode || !verifyPasscode(passcode, row.passcode_hash))) {
        return res.status(403).json({ error: "wrong passcode" });
      }
    }
    res.json({ token: makeJoinToken(id) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.delete("/api/rooms/:id", async (req, res) => {
  const id = req.params.id.toUpperCase();
  try {
    const row = await getRoomRow(id);
    if (!row) return res.status(404).json({ error: "room not found" });
    if (row.owner_id !== req.body?.userId) return res.status(403).json({ error: "only the owner can nuke a room" });
    await deleteRoom(id);
    io.to(id).emit("room:error", { code: "deleted", message: "The owner nuked this room." });
    io.in(id).disconnectSockets(true);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

const autofillInFlight = new Set();

app.post("/api/rooms/:id/showdown/autofill", async (req, res) => {
  const id = req.params.id.toUpperCase();
  const row = await getRoomRow(id);
  if (!row) return res.status(404).json({ error: "room not found" });
  if (row.game !== "showdown") return res.status(400).json({ error: "not a showdown room" });
  if (row.owner_id !== req.body?.userId) return res.status(403).json({ error: "only the owner can autofill" });
  if (autofillInFlight.has(id)) return res.status(409).json({ error: "already filling — hang tight" });

  const state = row.state;
  if (state.status !== "seeding") return res.status(400).json({ error: "tournament already started" });
  if (!SIZES.includes(state.size)) return res.status(400).json({ error: "bad bracket size" });

  autofillInFlight.add(id);
  try {
    const entries = await autofillEntries(state.size, state.contentType);
    const newState = await applyGameUpdate(id, (draft) => {
      draft.entries = {};
      for (const e of entries) {
        const entryId = crypto.randomUUID();
        draft.entries[entryId] = {
          id: entryId,
          title: e.title,
          animeTitle: e.animeTitle,
          subtitle: e.subtitle,
          videoUrl: e.videoUrl,
          audioUrl: e.audioUrl || null,
          kind: !e.videoUrl ? "none" : /\.(webm|mp4|m4v)(\?|$)/i.test(e.videoUrl) ? "file" : "youtube",
        };
      }
    });
    res.json({ state: newState });
  } catch (err) {
    res.status(502).json({ error: `autofill failed: ${err.message}` });
  } finally {
    autofillInFlight.delete(id);
  }
});

// Anyone in a rating room can import their OWN AniList list — items land on the
// shared board, their scores land as their votes. Not owner-gated on purpose.
app.post("/api/rooms/:id/rating/import", async (req, res) => {
  const id = req.params.id.toUpperCase();
  const row = await getRoomRow(id);
  if (!row) return res.status(404).json({ error: "room not found" });
  if (row.game !== "rating") return res.status(400).json({ error: "not a rating room" });
  const userId = String(req.body?.userId || "").slice(0, 64);
  const nick = String(req.body?.nick || "").slice(0, 24);
  const anilistUser = String(req.body?.anilistUser || "").trim().slice(0, 40);
  if (!userId || !anilistUser) return res.status(400).json({ error: "who are you / which AniList user?" });

  try {
    const entries = await fetchAniListUserList(anilistUser);
    if (!entries.length) return res.status(404).json({ error: `"${anilistUser}" has no completed anime on AniList (or the list is private)` });

    let added = 0;
    let scored = 0;
    let skipped = 0;
    await applyGameUpdate(id, (draft) => {
      const MAX = 500;
      for (const e of entries) {
        if (!draft.items[e.id]) {
          if (Object.keys(draft.items).length >= MAX) {
            skipped++;
            continue;
          }
          draft.items[e.id] = { id: e.id, title: e.title, image_url: e.image_url, subtitle: e.subtitle };
          added++;
        }
        // guard on items[e.id]: an entry skipped by the cap must not leave an orphaned vote
        if (e.score !== null && draft.items[e.id]) {
          if (!draft.votes[e.id]) draft.votes[e.id] = {};
          draft.votes[e.id][userId] = e.score;
          scored++;
        }
      }
      if (scored > 0) {
        if (!draft.participants.includes(userId)) draft.participants.push(userId);
        if (nick) draft.names[userId] = nick;
      }
    });
    res.json({ added, scored, skipped, total: entries.length });
  } catch (err) {
    const status = err instanceof UnknownUserError ? 404 : 502;
    res.status(status).json({ error: err.message });
  }
});

app.use("/api", mediaRouter);
app.use("/uploads", express.static(UPLOADS_DIR, { maxAge: "30d", immutable: true }));

// ---- static SPA (production build) ---------------------------------------------
const dist = path.join(__dirname, "..", "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) return next();
    res.sendFile(path.join(dist, "index.html"));
  });
}

// ---- boot -----------------------------------------------------------------------
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true }, maxHttpBufferSize: 1e6 });
attachSockets(io);

server.listen(PORT, () => {
  console.log(`ALL THE BULLSHIT running → http://localhost:${PORT}`);
  if (!fs.existsSync(dist)) console.log(`(no dist/ build found — dev mode, use the Vite server)`);
});
