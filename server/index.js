import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import express from "express";
import { Server } from "socket.io";
import { UPLOADS_DIR } from "./db.js";
import { mediaRouter } from "./media.js";
import {
  GAMES,
  attachSockets,
  createRoom,
  deleteRoom,
  getRoomMeta,
  getRoomRow,
  listPublicRooms,
  makeJoinToken,
  verifyPasscode,
} from "./rooms.js";

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

app.get("/api/rooms", (req, res) => {
  const game = String(req.query.game || "tierlist");
  if (!GAMES[game]) return res.status(404).json({ error: "unknown game" });
  res.json({ rooms: listPublicRooms(game) });
});

app.post("/api/rooms", (req, res) => {
  const { game, name, visibility, passcode, user } = req.body || {};
  if (!user?.id || !user?.nick) return res.status(400).json({ error: "who are you?" });
  try {
    const { id, token } = createRoom({ game, name, visibility, passcode, user });
    res.json({ id, token });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get("/api/rooms/:id", (req, res) => {
  const meta = getRoomMeta(req.params.id.toUpperCase());
  if (!meta) return res.status(404).json({ error: "room not found" });
  res.json({ room: meta });
});

app.post("/api/rooms/:id/join", (req, res) => {
  const id = req.params.id.toUpperCase();
  const row = getRoomRow(id);
  if (!row) return res.status(404).json({ error: "room not found" });
  if (row.passcode_hash) {
    const { passcode, userId } = req.body || {};
    const isOwner = userId && userId === row.owner_id;
    if (!isOwner && (!passcode || !verifyPasscode(passcode, row.passcode_hash))) {
      return res.status(403).json({ error: "wrong passcode" });
    }
  }
  res.json({ token: makeJoinToken(id) });
});

app.delete("/api/rooms/:id", (req, res) => {
  const id = req.params.id.toUpperCase();
  const row = getRoomRow(id);
  if (!row) return res.status(404).json({ error: "room not found" });
  if (row.owner_id !== req.body?.userId) return res.status(403).json({ error: "only the owner can nuke a room" });
  deleteRoom(id);
  io.to(id).emit("room:error", { code: "deleted", message: "The owner nuked this room." });
  io.in(id).disconnectSockets(true);
  res.json({ ok: true });
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
