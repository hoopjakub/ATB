-- ALL THE BULLSHIT — Supabase schema
-- Run this once in your Supabase project's SQL Editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- Mirrors the old SQLite schema, but `state` is a native jsonb column instead of
-- a stringified JSON blob — the server reads/writes it as a plain object.

create table if not exists rooms (
  id text primary key,
  game text not null,
  name text not null,
  owner_id text not null,
  owner_nick text not null default '',
  visibility text not null default 'public',
  passcode_hash text,
  state jsonb not null,
  created_at bigint not null,
  updated_at bigint not null
);

create index if not exists rooms_game_visibility_idx on rooms (game, visibility);

create table if not exists media_items (
  id text primary key,
  source text not null,
  external_id text,
  title text not null,
  image_url text not null,
  uploaded_by text,
  created_at bigint not null
);

-- The server connects with the service_role key and does its own authorization
-- (owner checks, passcode hashing) in application code — it does not rely on
-- Postgres Row Level Security. RLS is left off these tables on purpose; do not
-- expose the anon/publishable key to any client-side code that talks to these
-- tables directly, since that would bypass the app's own authorization.
alter table rooms disable row level security;
alter table media_items disable row level security;
