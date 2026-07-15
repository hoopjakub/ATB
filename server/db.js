import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, "..", "data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, "atb.db"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  game TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  owner_nick TEXT NOT NULL DEFAULT '',
  visibility TEXT NOT NULL DEFAULT 'public',
  passcode_hash TEXT,
  state TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS media_items (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT,
  title TEXT NOT NULL,
  image_url TEXT NOT NULL,
  uploaded_by TEXT,
  created_at INTEGER NOT NULL
);
`);

const stmts = {
  insertRoom: db.prepare(
    `INSERT INTO rooms (id, game, name, owner_id, owner_nick, visibility, passcode_hash, state, created_at, updated_at)
     VALUES (@id, @game, @name, @owner_id, @owner_nick, @visibility, @passcode_hash, @state, @created_at, @updated_at)`
  ),
  getRoom: db.prepare(`SELECT * FROM rooms WHERE id = ?`),
  listPublic: db.prepare(
    `SELECT id, game, name, owner_id, owner_nick, visibility, created_at, updated_at
     FROM rooms WHERE game = ? AND visibility = 'public' ORDER BY updated_at DESC LIMIT 100`
  ),
  saveState: db.prepare(`UPDATE rooms SET state = ?, updated_at = ? WHERE id = ?`),
  renameRoom: db.prepare(`UPDATE rooms SET name = ?, updated_at = ? WHERE id = ?`),
  deleteRoom: db.prepare(`DELETE FROM rooms WHERE id = ?`),
  insertMedia: db.prepare(
    `INSERT OR IGNORE INTO media_items (id, source, external_id, title, image_url, uploaded_by, created_at)
     VALUES (@id, @source, @external_id, @title, @image_url, @uploaded_by, @created_at)`
  ),
};

export const queries = stmts;
