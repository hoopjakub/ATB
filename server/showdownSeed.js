// Autofill logic for the showdown game: AniList popularity ranking picks *which*
// anime, AnimeThemes.moe supplies the actual opening/ending video for each one.
// Confirmed against the live API (2026): /anime?q=<name>&include=resources,animethemes...
// returns candidates whose `resources` array has an entry with site:"AniList" and
// external_id matching AniList's numeric id — that's the join key, no separate
// lookup endpoint needed. Anime with no AnimeThemes match (or no matching theme
// type) still get included with kind:"none" — title/anime only, per product call:
// always fill the bracket from real popularity data, video is a bonus not a gate.

const ANILIST_ENDPOINT = "https://graphql.anilist.co";
const ANIMETHEMES_ENDPOINT = "https://api.animethemes.moe";

const ANILIST_POPULAR_QUERY = `
query ($page: Int) {
  Page(page: $page, perPage: 50) {
    media(type: ANIME, sort: POPULARITY_DESC) {
      id
      idMal
      title { romaji english }
    }
  }
}`;

// Node's fetch sends no User-Agent by default; AnimeThemes' Cloudflare front
// returns a blanket 403 for that (confirmed empirically — curl/PowerShell work
// fine since they set their own UA). A normal browser-shaped UA fixes it.
const DEFAULT_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

async function fetchJson(url, opts, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, {
        ...opts,
        headers: { ...DEFAULT_HEADERS, ...opts?.headers },
        signal: AbortSignal.timeout(12000),
      });
      if (r.status === 429) {
        const retryAfter = Number(r.headers.get("retry-after")) || 1.5 * (i + 1);
        await new Promise((res) => setTimeout(res, retryAfter * 1000));
        continue;
      }
      if (!r.ok) throw new Error(`upstream ${r.status}`);
      return await r.json();
    } catch (err) {
      lastErr = err;
      await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
  }
  throw lastErr;
}

async function fetchPopularAnime(count) {
  const out = [];
  let page = 1;
  while (out.length < count) {
    const data = await fetchJson(ANILIST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: ANILIST_POPULAR_QUERY, variables: { page } }),
    });
    const batch = data?.data?.Page?.media || [];
    if (!batch.length) break;
    out.push(...batch);
    page++;
    if (page > 20) break; // safety valve
  }
  return out.slice(0, count);
}

// Persists for the process lifetime — this is essentially static reference
// data (an anime's themes don't change), and the same handful of popular
// anime show up across most autofills, so this turns repeat autofills (very
// common while testing, or across many rooms picking similar top-N anime)
// from a full re-fetch into a cache hit. Caching the raw search response by
// name (rather than per anilistId+themeType) also means a "mixed" mode's
// OP-then-ED fallback never needs a second network call — both come from the
// one cached candidate list.
const animeThemesSearchCache = new Map(); // animeName (lowercased) -> candidates[]

async function searchAnimeThemesCached(animeName) {
  const key = animeName.toLowerCase();
  if (animeThemesSearchCache.has(key)) return animeThemesSearchCache.get(key);
  const url = `${ANIMETHEMES_ENDPOINT}/anime?q=${encodeURIComponent(animeName)}&include=resources,animethemes.animethemeentries.videos,animethemes.song.artists&page[size]=5`;
  let candidates = [];
  try {
    const data = await fetchJson(url, undefined, 2);
    candidates = data?.anime || [];
  } catch {
    candidates = [];
  }
  animeThemesSearchCache.set(key, candidates);
  return candidates;
}

function findThemeInCandidates(candidates, anilistId, themeType) {
  const match = candidates.find((a) =>
    (a.resources || []).some((r) => r.site === "AniList" && Number(r.external_id) === Number(anilistId))
  );
  if (!match) return null;

  const themes = (match.animethemes || []).filter((t) => t.type === themeType);
  if (!themes.length) return null;
  themes.sort((a, b) => (a.sequence ?? 99) - (b.sequence ?? 99));
  const theme = themes[0];

  const videos = (theme.animethemeentries || []).flatMap((e) => e.videos || []);
  if (!videos.length) return { theme, videoUrl: null };
  videos.sort((a, b) => (b.nc ? 1 : 0) - (a.nc ? 1 : 0) || (b.resolution || 0) - (a.resolution || 0));
  return { theme, videoUrl: videos[0].link };
}

// runs `items` through `worker` with at most `limit` in flight at once
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  return results;
}

export async function autofillEntries(size, contentType) {
  const mixed = contentType === "mixed";
  const fixedType = contentType === "endings" ? "ED" : "OP";
  const anime = await fetchPopularAnime(size);
  const results = await mapWithConcurrency(anime, 10, async (a) => {
    const title = a.title.english || a.title.romaji;
    // mixed mode picks a random OP/ED preference per anime for variety, falling
    // back to the other type if that one isn't available for this particular anime
    const preferred = mixed ? (Math.random() < 0.5 ? "OP" : "ED") : fixedType;
    let hit = null;
    let themeType = preferred;
    try {
      const candidates = await searchAnimeThemesCached(a.title.romaji);
      hit = findThemeInCandidates(candidates, a.id, preferred);
      if (!hit && mixed) {
        themeType = preferred === "OP" ? "ED" : "OP";
        hit = findThemeInCandidates(candidates, a.id, themeType);
      }
    } catch {
      hit = null;
    }
    const label = themeType === "ED" ? "Ending" : "Opening";
    if (hit?.videoUrl) {
      return {
        title: `${hit.theme.slug || label} · ${hit.theme.song?.title || ""}`.trim(),
        animeTitle: title,
        subtitle: (hit.theme.song?.artists || []).map((ar) => ar.name).join(", "),
        videoUrl: hit.videoUrl,
      };
    }
    return {
      title: `${title} — ${label}`,
      animeTitle: title,
      subtitle: "no video found",
      videoUrl: null,
    };
  });
  return results;
}
