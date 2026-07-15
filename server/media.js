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

// Jikan is a shared free service that wraps MyAnimeList — it 504s occasionally,
// and sometimes MAL itself is down behind it (Jikan reports that as a 5xx with
// a JSON body explaining as much). Retry with backoff, and surface MAL-down
// distinctly from "we're broken" so users aren't left guessing.
class UpstreamDownError extends Error {}

async function fetchWithRetry(url, tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (r.ok) return r;
      if (r.status >= 500) {
        const body = await r.json().catch(() => null);
        if (body?.message?.toLowerCase().includes("myanimelist")) {
          throw new UpstreamDownError(body.message);
        }
        lastErr = new Error(`upstream ${r.status}`);
      } else if (r.status === 429) {
        lastErr = new Error("rate limited");
      } else {
        throw new Error(`upstream ${r.status}`);
      }
    } catch (err) {
      lastErr = err;
      if (err instanceof UpstreamDownError) break;
    }
    if (i < tries - 1) await new Promise((res) => setTimeout(res, 600 * (i + 1)));
  }
  throw lastErr;
}

function jikanErrorPayload(err) {
  if (err instanceof UpstreamDownError) {
    return { error: "mal_down", message: "MyAnimeList itself looks to be down or refusing connections right now (not just us) — try again in a bit." };
  }
  return { error: "search_failed", message: `search failed: ${err.message}` };
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
mediaRouter.post("/upload", upload.array("files", 10), (req, res) => {
  const uploadedBy = String(req.body.userId || "").slice(0, 64) || null;
  const items = (req.files || []).map((f) => {
    const item = {
      id: crypto.randomUUID(),
      source: "upload",
      external_id: null,
      title: path.parse(f.originalname).name.slice(0, 120) || "upload",
      image_url: `/uploads/${f.filename}`,
      uploaded_by: uploadedBy,
      created_at: Date.now(),
    };
    queries.insertMedia.run(item);
    return item;
  });
  if (!items.length) return res.status(400).json({ error: "no valid image files (jpg/png/gif/webp/avif, max 8MB)" });
  res.json({ items });
});

// ---- anime via Jikan (free, no key) -------------------------------------------
mediaRouter.get("/search/anime", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ items: [] });
  const key = `anime:${q.toLowerCase()}`;
  const hit = cached(key);
  if (hit) return res.json({ items: hit });
  try {
    const r = await fetchWithRetry(`https://api.jikan.moe/v4/anime?q=${encodeURIComponent(q)}&limit=20`);
    const data = await r.json();
    const items = (data.data || []).map((a) => ({
      id: `mal-${a.mal_id}`,
      source: "mal",
      external_id: String(a.mal_id),
      title: a.title_english || a.title,
      image_url: a.images?.jpg?.image_url || a.images?.jpg?.large_image_url,
      subtitle: [a.type, a.year].filter(Boolean).join(" · "),
    })).filter((i) => i.image_url);
    remember(key, items);
    res.json({ items });
  } catch (err) {
    res.status(502).json(jikanErrorPayload(err));
  }
});

// ---- characters via Jikan too (tier lists are usually characters, let's be real)
mediaRouter.get("/search/characters", async (req, res) => {
  const q = String(req.query.q || "").trim();
  if (!q) return res.json({ items: [] });
  const key = `chars:${q.toLowerCase()}`;
  const hit = cached(key);
  if (hit) return res.json({ items: hit });
  try {
    const r = await fetchWithRetry(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(q)}&limit=20`);
    const data = await r.json();
    const items = (data.data || []).map((c) => ({
      id: `malchar-${c.mal_id}`,
      source: "mal",
      external_id: String(c.mal_id),
      title: c.name,
      image_url: c.images?.jpg?.image_url,
      subtitle: c.favorites ? `♥ ${c.favorites.toLocaleString()}` : "",
    })).filter((i) => i.image_url && !i.image_url.includes("questionmark"));
    remember(key, items);
    res.json({ items });
  } catch (err) {
    res.status(502).json(jikanErrorPayload(err));
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
