import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, "..", "data");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env — see supabase/schema.sql for the one-time setup."
  );
}

// service_role bypasses RLS; the app does its own authorization (owner checks,
// passcode hashing) rather than relying on Postgres RLS. Never ship this key
// to client-side code.
//
// We only ever use the plain REST (PostgREST) side of supabase-js, never
// Supabase Realtime — but the client constructor unconditionally builds a
// RealtimeClient internally regardless, and that throws on Node 20 (no native
// WebSocket until Node 22) unless a WebSocket implementation is supplied.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: WebSocket },
});

function orThrow(error) {
  if (error) throw new Error(`supabase: ${error.message}`);
}

// Uploaded room name/game columns are small and read constantly; rooms.state
// is jsonb, so the server reads/writes it as a plain JS object — no manual
// JSON.stringify/parse needed (that's handled by supabase-js + postgres).
export const queries = {
  async getRoom(id) {
    const { data, error } = await supabase.from("rooms").select("*").eq("id", id).maybeSingle();
    orThrow(error);
    return data;
  },

  async insertRoom(row) {
    const { error } = await supabase.from("rooms").insert(row);
    orThrow(error);
  },

  async listPublic(game) {
    const { data, error } = await supabase
      .from("rooms")
      .select("id, game, name, owner_id, owner_nick, visibility, created_at, updated_at")
      .eq("game", game)
      .eq("visibility", "public")
      .order("updated_at", { ascending: false })
      .limit(100);
    orThrow(error);
    return data;
  },

  async saveState(state, updatedAt, id) {
    const { error } = await supabase.from("rooms").update({ state, updated_at: updatedAt }).eq("id", id);
    orThrow(error);
  },

  async renameRoom(name, updatedAt, id) {
    const { error } = await supabase.from("rooms").update({ name, updated_at: updatedAt }).eq("id", id);
    orThrow(error);
  },

  async deleteRoom(id) {
    const { error } = await supabase.from("rooms").delete().eq("id", id);
    orThrow(error);
  },

  async insertMedia(item) {
    const { error } = await supabase.from("media_items").upsert(item, { onConflict: "id", ignoreDuplicates: true });
    orThrow(error);
  },
};
