import crypto from "node:crypto";
import path from "node:path";
import express from "express";
import multer from "multer";
import { UPLOADS_DIR, queries } from "./db.js";

// tiny in-memory search cache so repeat queries don't hammer the free APIs
const cache = new Map(); // key -> { at, data }
const CACHE_TTL = 1000 * 60 * 30;

function cached(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.data;
  return null;
}
function remember(key, data) {
  if (cache.size > 500) cache.clear();
  cache.set(key, { at: Date.now(), data });
}

// generic retry helper for plain GET upstreams (RAWG)
async function fetchWithRetry(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (r.ok) return r;
      lastErr = new Error(`upstream ${r.status}`);
      if (r.status < 500 && r.status !== 429) throw lastErr;
    } catch (err) {
      lastErr = err;
    }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, 600 * (i + 1)));
  }
  throw lastErr;
}

function searchErrorPayload(err) {
  return { error: "search_failed", message: `search failed: ${err.message}` };
}

// AniList's public GraphQL API (no key needed) — covers both anime and manga
// under one Media type, plus character search. It rate-limits per-IP (usually
// ~30 req/min) and returns a Retry-After header on 429, which we honor.
const ANILIST_ENDPOINT = "https://graphql.anilist.co";

async function anilistQuery(query, variables, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(ANILIST_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(12000),
      });
      if (r.ok) return (await r.json()).data;
      if (r.status === 429) {
        const retryAfter = Number(r.headers.get("retry-after")) || 1.5 * (i + 1);
        lastErr = new Error("rate limited by AniList");
        await new Promise((res) => setTimeout(res, retryAfter * 1000));
        continue;
      }
      const body = await r.json().catch(() => null);
      throw new Error(body?.errors?.[0]?.message || `AniList upstream ${r.status}`);
    } catch (err) {
      lastErr = err;
      if (!/rate limited/i.test(err.message)) break;
    }
  }
  throw lastErr;
}

const MEDIA_SEARCH_QUERY = `
query ($search: String, $type: MediaType) {
  Page(page: 1, perPage: 24) {
    media(search: $search, type: $type, sort: SEARCH_MATCH) {
      id
      title { romaji english }
      coverImage { extraLarge large }
      startDate { year }
      format
    }
  }
}`;

async function searchAniListMedia(type, q) {
  const data = await anilistQuery(MEDIA_SEARCH_QUERY, { search: q, type });
  return (data.Page.media || []).map((m) => ({
    id: `anilist-${type.toLowerCase()}-${m.id}`,
    source: "anilist",
    external_id: String(m.id),
    title: m.title.english || m.title.romaji,
    image_url: m.coverImage?.extraLarge || m.coverImage?.large,
    subtitle: [m.format, m.startDate?.year].filter(Boolean).join(" · "),
  })).filter((i) => i.image_url);
}

const CHARACTER_SEARCH_QUERY = `
query ($search: String) {
  Page(page: 1, perPage: 24) {
    characters(search: $search, sort: SEARCH_MATCH) {
      id
      name { full }
      image { large }
      favourites
    }
  }
}`;

async function searchAniListCharacters(q) {
  const data = await anilistQuery(CHARACTER_SEARCH_QUERY, { search: q });
  return (data.Page.characters || []).map((c) => ({
    id: `anilist-char-${c.id}`,
    source: "anilist",
    external_id: String(c.id),
    title: c.name.full,
    image_url: c.image?.large,
    subtitle: c.favourites ? `♥ ${c.favourites.toLocaleString()}` : "",
  })).filter((i) => i.image_url);
}

const EXT_BY_MIME = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_req, file, cb) => {
      const ext = EXT_BY_MIME[file.mimetype] || ".bin";
      cb(null, crypto.randomUUID() + ext);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => cb(null, !!EXT_BY_MIME[file.mimetype]),
});

export const mediaRouter = express.Router();

// ---- uploads -----------------------------------------------------------------
mediaRouter.post("/upload", upload.array("files", 10), async (req, res) => {
  const uploadedBy = String(req.body.userId || "").slice(0, 64) || null;
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: "no valid image files (jpg/png/gif/webp/avif, max 8MB)" });
  try {
    const items = await Promise.all(
      files.map(async (f) => {
        const item = {
          id: crypto.randomUUID(),
          source: "upload",
          external_id: null,
          title: path.parse(f.originalname).name.slice(0, 120) || "upload",
          image_url: `/uploads/${f.filename}`,
          uploaded_by: uploadedBy,
          created_at: Date.now(),
        };
        await queries.insertMedia(item);
        return item;
      })
    );
    res.json({ items });
  } catch (err) {
    res.status(502).json({ error: `upload failed: ${err.message}` });
  }
});

// ---- anime / manga / characters via AniList (free, no key) --------------------
mediaRouter.get("/search/anime", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ items: [] });
  const key = `anime:${q.toLowerCase()}`;
  const hit = cached(key);
  if (hit) return res.json({ items: hit });
  try {
    const items = await searchAniListMedia("ANIME", q);
    remember(key, items);
    res.json({ items });
  } catch (err) {
    res.status(502).json(searchErrorPayload(err));
  }
});

mediaRouter.get("/search/manga", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ items: [] });
  const key = `manga:${q.toLowerCase()}`;
  const hit = cached(key);
  if (hit) return res.json({ items: hit });
  try {
    const items = await searchAniListMedia("MANGA", q);
    remember(key, items);
    res.json({ items });
  } catch (err) {
    res.status(502).json(searchErrorPayload(err));
  }
});

mediaRouter.get("/search/characters", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ items: [] });
  const key = `chars:${q.toLowerCase()}`;
  const hit = cached(key);
  if (hit) return res.json({ items: hit });
  try {
    const items = await searchAniListCharacters(q);
    remember(key, items);
    res.json({ items });
  } catch (err) {
    res.status(502).json(searchErrorPayload(err));
  }
});

// ---- games via RAWG (free key, optional) --------------------------------------
mediaRouter.get("/search/games", async (req, res) => {
  const apiKey = process.env.RAWG_API_KEY;
  if (!apiKey) {
    return res.status(501).json({
      error: "no_key",
      message: "Game search needs a free RAWG key — get one at rawg.io/apidocs and put RAWG_API_KEY=... in .env",
    });
  }
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ items: [] });
  const key = `games:${q.toLowerCase()}`;
  const hit = cached(key);
  if (hit) return res.json({ items: hit });
  try {
    const r = await fetchWithRetry(
      `https://api.rawg.io/api/games?key=${apiKey}&search=${encodeURIComponent(q)}&page_size=20`
    );
    const data = await r.json();
    const items = (data.results || []).map((g) => ({
      id: `rawg-${g.id}`,
      source: "rawg",
      external_id: String(g.id),
      title: g.name,
      image_url: g.background_image,
      subtitle: g.released ? g.released.slice(0, 4) : "",
    })).filter((i) => i.image_url);
    remember(key, items);
    res.json({ items });
  } catch (err) {
    res.status(502).json({ error: `game search failed: ${err.message}` });
  }
});
