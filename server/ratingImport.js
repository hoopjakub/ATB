// AniList list import for the rating game. Public GraphQL, no auth — any
// public profile's anime list by username, scores included. Verified live
// (2026-07): score(format: POINT_10_DECIMAL) returns e.g. 7 for a 7.0, and
// returns 0 for UNSCORED entries — 0 must map to "no vote", never a real
// zero rating. Unknown usernames come back as HTTP 404.
// MAL import is deliberately absent: Jikan v4 dropped user-animelist
// endpoints when MAL blocked them, and MAL's own API needs a registered
// client-id — not worth it while AniList covers the use case keyless.

const ANILIST_ENDPOINT = "https://graphql.anilist.co";

const LIST_QUERY = `
query ($userName: String) {
  MediaListCollection(userName: $userName, type: ANIME, status_in: [COMPLETED, REPEATING]) {
    lists {
      entries {
        score(format: POINT_10_DECIMAL)
        media {
          id
          title { romaji english }
          coverImage { large }
          format
          startDate { year }
        }
      }
    }
  }
}`;

export class UnknownUserError extends Error {}

export async function fetchAniListUserList(userName) {
  let r;
  try {
    r = await fetch(ANILIST_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ query: LIST_QUERY, variables: { userName } }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    throw new Error(`AniList unreachable: ${err.message}`);
  }
  if (r.status === 404) throw new UnknownUserError(`no AniList user called "${userName}" (or their list is private)`);
  if (!r.ok) throw new Error(`AniList upstream ${r.status}`);
  const data = await r.json();
  if (data.errors?.length) {
    const msg = data.errors[0].message || "AniList error";
    if (/not found/i.test(msg)) throw new UnknownUserError(`no AniList user called "${userName}" (or their list is private)`);
    throw new Error(msg);
  }

  const lists = data.data?.MediaListCollection?.lists || [];
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const e of list.entries || []) {
      const m = e.media;
      if (!m?.coverImage?.large || seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({
        // same id shape as /api/search/anime so search-added and imported
        // copies of the same anime dedupe into one item
        id: `anilist-anime-${m.id}`,
        title: m.title.english || m.title.romaji,
        image_url: m.coverImage.large,
        subtitle: [m.format, m.startDate?.year].filter(Boolean).join(" · "),
        // 0 = unscored on anilist -> null, otherwise already on the 0-10 decimal scale
        score: e.score > 0 ? Math.round(e.score * 10) / 10 : null,
      });
    }
  }
  return out;
}
