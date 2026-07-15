# Game #3: "Showdown" — bracket-elimination voting (Pikuco-style)

Reference: https://pikuco.com/tests/3070/ (anime opening tournament, 512→1 single elimination,
YouTube embeds, "Classic mode" vs "King of the Hill", step back / mix up / reset, and a
"statistics" tab showing the implied final ranking).

This doc is a plan, not a build — nothing here is implemented yet.

## What we're building

A bracket-elimination tournament game, reusing the room/live-sync/media infrastructure
already built for tier-list and alignment-chart:

- Pick a size: 32 / 64 / 128 / 256 / 512 entries.
- Each round, entries face off in pairs; everyone currently in the room votes for one side
  of the current matchup; once everyone's voted, the majority wins and the bracket advances.
- **Solo play falls out for free**: "majority of everyone currently voting" also works when
  there's exactly one person in the room — no separate solo/multiplayer mode needed. Same
  code path either way.
- Works for openings, endings, or general "themes" — same mechanic, different content pull.
- A results/statistics view at the end shows the bracket's implied final ranking (champion,
  runner-up, 3rd/4th, 5th–8th, ...) — same convention Pikuco uses.

## The hard part isn't the bracket, it's the content

There's no API for "the 512 best anime openings ever" — that Pikuco list is one person's
manual curation. We don't want to fake authority we don't have. Two ways to fill a bracket:

1. **Manual**: room owner pastes YouTube links + titles one at a time (same shape as the
   existing "paste a URL" flow already built for tier list / alignment).
2. **Auto-seeded from real data**: AniList's popularity ranking picks *which anime*, and
   AnimeThemes.moe supplies *the actual opening/ending video* for each one. This gives an
   honestly-labeled "Top N Most Popular Anime — Openings" bracket, not a claim to be THE
   definitive best-openings list. Owner can still edit/reorder/swap/remove before starting.

Recommend building (2) as the primary path, with (1) always available as a supplement/fallback
for anything not in AnimeThemes' catalog yet (very new/obscure titles, or endings that don't
have an entry).

### AniList (already integrated for anime/manga/character search)

Same GraphQL endpoint (`https://graphql.anilist.co`), sort by `POPULARITY_DESC` to get the
seed list of anime:

```graphql
query ($page: Int) {
  Page(page: $page, perPage: 50) {
    media(type: ANIME, sort: POPULARITY_DESC) {
      id          # AniList id — used to cross-reference into AnimeThemes
      title { romaji english }
      coverImage { large }
      popularity
    }
  }
}
```

### AnimeThemes.moe (new dependency, not yet integrated)

Free, no-key, fan-run archive of actual OP/ED theme videos with real hosted video files
(their own CDN — no YouTube takedown/ad risk, no uploader-account dependency). Base:
`https://api.animethemes.moe`. Rough shape (needs a real spike to confirm current field
names before building):

```
GET /anime?filter[has]=resources&include=animethemes.animethemeentries.videos,animethemes.song,resources
```

Each `Anime` resource carries external site links (their `resources` relation) which is
expected to include an AniList cross-reference — that's the join key from step 1 to step 2.
Each `AnimeTheme` has a `type` (`OP`/`ED`), a `sequence` number (OP1, OP2, ED1...), a `song`
(title, artists), and `animethemeentries → videos` with actual video file URLs (`.webm`,
resolution, `nc` flag for creditless, `subbed` flag).

**Open question / needs a real spike before committing to it**: confirm (a) the exact field
name AnimeThemes uses for an AniList cross-reference (vs. MAL-only, which would need an extra
AniList↔MAL id hop via AniList's own `idMal` field — that's a safe fallback either way), and
(b) their actual rate limits / ToS for this kind of bulk pull. Don't build against remembered
field names without checking the live API first.

### Playback: native `<video>` vs. YouTube iframe

User's original ask pictured a small YouTube embed like Pikuco. Worth deciding once we get
here: AnimeThemes' own hosted files are more robust for a voting tool (no ads, no random
takedowns mid-tournament, exact video per theme/sequence, can autoplay muted cleanly) — but a
YouTube iframe is the more familiar "watch on YouTube" feel the user explicitly referenced.
Leaning towards native `<video>` as primary (AnimeThemes-sourced entries) with YouTube iframe
support kept for manually-pasted entries (path 1 above, or endings AnimeThemes doesn't have).
Not deciding this now — flag it as a real UI choice for when we scope this game.

## Room state shape (sketch, mirrors the tierlist/alignment game-module pattern)

```jsonc
{
  "size": 32,                     // 32|64|128|256|512, fixed at creation
  "contentType": "openings",      // "openings" | "endings" | "mixed"
  "entries": {                    // denormalized, like media in the other games
    "e1": { "id": "e1", "title": "Naruto Shippuden — OP16", "animeTitle": "Naruto Shippuden",
             "source": "animethemes", "videoUrl": "https://.../op16-nc1080.webm" }
  },
  "bracket": [["e1","e2"], ["e3","e4"], ...],  // round-1 seeding, size/2 pairs
  "round": 0,                     // 0-indexed
  "matchIndex": 0,                // which pair within the current round
  "votes": { "userId1": "left" }, // votes for the CURRENT matchup only; cleared each advance
  "voterSnapshot": ["userId1","userId2"], // who was present when this matchup started
  "history": [                    // for step-back and final placement
    { "round": 0, "matchIndex": 0, "pair": ["e1","e2"], "winner": "e1", "votes": {...} }
  ],
  "status": "seeding"             // "seeding" | "in_progress" | "complete"
}
```

Advance rule: when every id in `voterSnapshot` has voted (or has disconnected — drop
disconnected voters from the snapshot rather than blocking forever), tally `votes`, majority
wins, tie broken by a seeded coin flip (deterministic, not client-trusted); push to `history`;
clear `votes`; advance `matchIndex`; when a round's matches are exhausted, pair up that
round's winners in order to form the next round; `status: "complete"` once one entry remains.

Owner controls (mirroring Pikuco's toolbar): **step back** (pop `history`, restore prior
matchup + votes), **mix up** (reshuffle `bracket` seeding — only before `status` leaves
`"seeding"`), **reset** (wipe back to fresh round-1 seeding), **quit** (just navigation, not
a state op).

## Final ranking / stats view

Derived from `history`, not stored separately: champion = final winner, runner-up = final
loser, 3rd/4th = losers of the two semifinal matches, 5th–8th = quarterfinal losers, etc. —
standard single-elimination placement convention. This is an honest "how this bracket's votes
shook out," same spirit as Pikuco's "statistics" tab.

## Build order (once we're ready to start)

1. Spike AnimeThemes.moe's actual current API shape against a couple of real anime — confirm
   the AniList/MAL cross-reference field before writing real code against it.
2. Server game module `server/showdown.js` (or similar) — state shape above, op handlers for
   vote/step-back/mix-up/reset, advance-on-full-vote logic, seeding from a chosen entry list.
3. Room creation flow: size picker (32/64/128/256/512), content type (openings/endings),
   auto-seed via AniList+AnimeThemes vs. manual entry — same create-room modal pattern,
   extended.
4. Client board: current-matchup view (two panels, video + vote button each), live "X/Y
   voted" indicator, round/match counter like Pikuco's header, owner toolbar (step back/mix
   up/reset/quit).
5. Results screen with the derived placement list.

Not estimating effort per-step yet — steps 1 and 2 are where the real unknowns live; 3–5 are
straightforward given the existing tierlist/alignment patterns.
