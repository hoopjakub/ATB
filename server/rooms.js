import crypto from "node:crypto";
import { queries } from "./db.js";
import * as tierlist from "./tierlist.js";
import * as alignment from "./alignment.js";
import * as showdown from "./showdown.js";

export const GAMES = {
  tierlist: {
    slug: "tierlist",
    display_name: "Tier List",
    tagline: "Drag your friends' favorite things into the gutter, live.",
    icon: "🏆",
    module: tierlist,
  },
  alignment: {
    slug: "alignment",
    display_name: "Alignment Chart",
    tagline: "Plot everyone's takes on two axes and argue about the results.",
    icon: "🧭",
    module: alignment,
  },
  showdown: {
    slug: "showdown",
    display_name: "Anime Showdown",
    tagline: "Bracket-vote your way through anime openings until only one remains.",
    icon: "⚔️",
    module: showdown,
  },
};

// ---- passcode / join-token helpers ------------------------------------------
const SECRET = crypto.randomBytes(32); // per-boot; tokens die on restart, that's fine

export function hashPasscode(passcode) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(passcode, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPasscode(passcode, stored) {
  const [salt, hash] = String(stored).split(":");
  const candidate = crypto.scryptSync(String(passcode), salt, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

export function makeJoinToken(roomId) {
  return crypto.createHmac("sha256", SECRET).update(roomId).digest("hex");
}

export function verifyJoinToken(roomId, token) {
  const expected = makeJoinToken(roomId);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(token)));
  } catch {
    return false;
  }
}

function roomCode() {
  // unambiguous, shareable 6-char code
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (const byte of crypto.randomBytes(6)) out += alphabet[byte % alphabet.length];
  return out;
}

// ---- live room state ---------------------------------------------------------
// In-memory authoritative copy per active room; Supabase is the durable layer.
const live = new Map(); // roomId -> { meta, state, rev, presence: Map<socketId, user>, saveTimer }

async function loadRoom(roomId) {
  if (live.has(roomId)) return live.get(roomId);
  const row = await queries.getRoom(roomId);
  if (!row) return null;
  const state = row.state;
  GAMES[row.game]?.module.sanitize?.(state);
  const entry = {
    meta: {
      id: row.id,
      game: row.game,
      name: row.name,
      owner_id: row.owner_id,
      owner_nick: row.owner_nick,
      visibility: row.visibility,
      has_passcode: !!row.passcode_hash,
    },
    state,
    rev: 0,
    presence: new Map(),
    drags: new Map(), // userId -> itemId currently held (soft lock)
    saveTimer: null,
  };
  live.set(roomId, entry);
  return entry;
}

function persistNow(entry) {
  queries.saveState(entry.state, Date.now(), entry.meta.id).catch((err) => {
    console.error(`[persist] failed to save room ${entry.meta.id}:`, err.message);
  });
}

function schedulePersist(entry) {
  if (entry.saveTimer) return;
  entry.saveTimer = setTimeout(() => {
    entry.saveTimer = null;
    persistNow(entry);
  }, 800);
}

export async function createRoom({ game, name, visibility, passcode, user, gameOptions }) {
  if (!GAMES[game]) throw new Error("unknown game");
  let id = roomCode();
  while (await queries.getRoom(id)) id = roomCode();
  const now = Date.now();
  await queries.insertRoom({
    id,
    game,
    name: String(name || "untitled chaos").slice(0, 60),
    owner_id: user.id,
    owner_nick: String(user.nick || "").slice(0, 24),
    visibility: visibility === "private" ? "private" : "public",
    passcode_hash: passcode ? hashPasscode(String(passcode)) : null,
    state: GAMES[game].module.initialState(gameOptions),
    created_at: now,
    updated_at: now,
  });
  return { id, token: makeJoinToken(id) };
}

export async function getRoomMeta(roomId) {
  const entry = await loadRoom(roomId);
  return entry ? entry.meta : null;
}

export async function getRoomRow(roomId) {
  return queries.getRoom(roomId);
}

export async function deleteRoom(roomId) {
  await queries.deleteRoom(roomId);
  const entry = live.get(roomId);
  if (entry?.saveTimer) clearTimeout(entry.saveTimer);
  live.delete(roomId);
}

export async function listPublicRooms(game) {
  const rows = await queries.listPublic(game);
  return rows.map((r) => ({
    ...r,
    online: live.get(r.id)?.presence.size ?? 0,
  }));
}

export function occupancy(roomId) {
  return live.get(roomId)?.presence.size ?? 0;
}

let ioRef = null;

// For REST routes that need to mutate room state outside the socket 'op' flow
// (autofill does slow, async, network-bound work — a poor fit for the
// synchronous op-apply-broadcast cycle used everywhere else).
export async function applyGameUpdate(roomId, mutate) {
  const entry = await loadRoom(roomId);
  if (!entry) throw new Error("room not found");
  const draft = structuredClone(entry.state);
  await mutate(draft);
  entry.state = draft;
  entry.rev++;
  schedulePersist(entry);
  ioRef?.to(roomId).emit("room:state", { state: entry.state, rev: entry.rev, actor: null, opType: null });
  return entry.state;
}

// ---- socket wiring -----------------------------------------------------------
export function attachSockets(io) {
  ioRef = io;
  io.on("connection", async (socket) => {
    const { roomId, user, token } = socket.handshake.auth || {};
    if (!roomId || !user?.id || !user?.nick) return socket.disconnect(true);

    let entry;
    try {
      entry = await loadRoom(roomId);
    } catch (err) {
      socket.emit("room:error", { code: "not_found", message: "Couldn't load this room right now — try again." });
      return socket.disconnect(true);
    }
    if (!entry) {
      socket.emit("room:error", { code: "not_found", message: "This room doesn't exist (anymore)." });
      return socket.disconnect(true);
    }

    const needsToken = entry.meta.has_passcode && entry.meta.owner_id !== user.id;
    if (needsToken && !verifyJoinToken(roomId, token)) {
      socket.emit("room:error", { code: "locked", message: "Wrong or missing passcode." });
      return socket.disconnect(true);
    }

    const cleanUser = {
      id: String(user.id).slice(0, 64),
      nick: String(user.nick).slice(0, 24),
      color: /^#[0-9a-fA-F]{6}$/.test(user.color || "") ? user.color : "#c6ff3d",
    };

    socket.join(roomId);
    entry.presence.set(socket.id, cleanUser);

    const presenceList = () => {
      // dedupe by user id (same person in two tabs counts once)
      const byId = new Map();
      for (const u of entry.presence.values()) byId.set(u.id, u);
      return [...byId.values()];
    };

    socket.emit("room:init", {
      room: entry.meta,
      state: entry.state,
      rev: entry.rev,
      presence: presenceList(),
      you: cleanUser,
    });
    io.to(roomId).emit("room:presence", presenceList());

    socket.on("op", (op, ack) => {
      try {
        const ctx = {
          userId: cleanUser.id,
          isOwner: cleanUser.id === entry.meta.owner_id,
          presenceIds: presenceList().map((u) => u.id),
        };
        const draft = structuredClone(entry.state);
        GAMES[entry.meta.game].module.applyOp(draft, op, ctx);
        entry.state = draft;
        entry.rev++;
        schedulePersist(entry);
        io.to(roomId).emit("room:state", { state: entry.state, rev: entry.rev, actor: cleanUser.id, opType: op.type });
        ack?.({ ok: true, rev: entry.rev });
      } catch (err) {
        ack?.({ ok: false, error: err.message });
        // resync the sender in case their optimistic apply diverged
        socket.emit("room:state", { state: entry.state, rev: entry.rev, actor: null, opType: null });
      }
    });

    socket.on("room:rename", async (name) => {
      if (cleanUser.id !== entry.meta.owner_id) return;
      entry.meta.name = String(name || "").slice(0, 60) || entry.meta.name;
      try {
        await queries.renameRoom(entry.meta.name, Date.now(), roomId);
      } catch (err) {
        console.error(`[rename] failed for room ${roomId}:`, err.message);
      }
      io.to(roomId).emit("room:meta", entry.meta);
    });

    // ---- ephemeral firehose (never persisted) ----
    socket.on("cursor", (pos) => {
      socket.volatile.to(roomId).emit("cursor", { user: cleanUser, ...sanitizePoint(pos) });
    });

    socket.on("drag:start", ({ itemId }) => {
      entry.drags.set(cleanUser.id, String(itemId));
      socket.to(roomId).emit("drag:start", { user: cleanUser, itemId: String(itemId) });
    });
    socket.on("drag:move", (pos) => {
      const itemId = entry.drags.get(cleanUser.id);
      if (!itemId) return;
      socket.volatile.to(roomId).emit("drag:move", { userId: cleanUser.id, itemId, ...sanitizePoint(pos) });
    });
    socket.on("drag:end", () => {
      entry.drags.delete(cleanUser.id);
      socket.to(roomId).emit("drag:end", { userId: cleanUser.id });
    });

    socket.on("disconnect", () => {
      entry.presence.delete(socket.id);
      if (entry.drags.has(cleanUser.id)) {
        entry.drags.delete(cleanUser.id);
        socket.to(roomId).emit("drag:end", { userId: cleanUser.id });
      }
      io.to(roomId).emit("room:presence", presenceList());
      if (entry.presence.size === 0) {
        // flush state and drop the live entry to keep memory tidy
        if (entry.saveTimer) {
          clearTimeout(entry.saveTimer);
          entry.saveTimer = null;
        }
        persistNow(entry);
        live.delete(roomId);
      }
    });
  });
}

function sanitizePoint(p) {
  return { x: Number(p?.x) || 0, y: Number(p?.y) || 0 };
}
