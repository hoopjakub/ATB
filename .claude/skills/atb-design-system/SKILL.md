---
name: atb-design-system
description: The visual language of ALL THE BULLSHIT (D:\ATB) — "sticker-bomb arcade brutalism." Use this before writing or touching ANY CSS/JSX styling in this project, adding a new game's UI, or building a new component, so new work looks like it belongs instead of drifting toward generic AI-app aesthetics.
---

# ATB design system — sticker-bomb arcade brutalism

The whole point of this look: acid green + hot magenta hard-edged stickers on
near-black, thick borders, offset drop shadows, everything slightly crooked.
It should feel like a chaotic arcade cabinet made by friends, not a SaaS
dashboard. Never soften this into generic rounded-corner/soft-shadow AI-app
aesthetics — no border-radius on primitives, no subtle gradients, no gentle
pastel accents.

All of this lives in one file: `src/styles.css`. Read it before adding new
classes — there is very likely already a primitive that does what you need.

## Color tokens (CSS variables on `:root`)

```
--bg: #0d0e12        near-black page background
--bg-2: #14161c       panel/card background (one step up)
--bg-3: #1c1f27       nested/inset surface (image tiles, inputs' resting bg)
--ink: #f2f0e8        primary text (warm off-white, not pure #fff)
--ink-dim: #9a97a8    secondary/muted text
--acid: #c6ff3d       THE accent — acid green, primary actions, "live" states
--acid-dark: #98cc1f
--pink: #ff3dae       secondary accent — danger-adjacent but also just "fun"
--blue: #3dc8ff       tertiary accent, used sparingly (pool/unplaced labels)
--amber: #ffb03d      warnings, tie messages, toast border
--danger: #ff5c5c     destructive actions (nuke, remove)
--line: #2c2f3a       borders/dividers on dark surfaces
```

Never invent new colors ad hoc — pick from this set. If a new semantic need
comes up (e.g. a 5th accent), add it as a named variable, don't hardcode a hex.

## Typography — three fonts, each with one job

- `--display: "Unbounded"` — headings, buttons, stickers, anything shouting.
  Always `font-weight: 700` or `900`, always `text-transform: uppercase` for
  UI chrome (not body copy).
- `--body: "Karla"` — the only font that appears in actual paragraph text
  (home page subhead, gate copy).
- `--mono: "IBM Plex Mono"` — labels, hints, timestamps, room codes, stats,
  anything that reads as "system output" rather than prose. `.hint`, `.mono`,
  tooltip rows, connbadge, all monospace.

Loaded via Google Fonts `<link>` in `index.html` — that link MUST keep
`crossorigin="anonymous"` (needed for the image-export feature to embed fonts
correctly, see atb-platform skill's gotchas).

## The hard-shadow language

Everything that's a discrete pressable/liftable surface gets an offset black
shadow, never a soft blur:

```css
--shadow-hard: 4px 4px 0 #000;
--shadow-acid: 4px 4px 0 rgba(198, 255, 61, 0.35);  /* "this is active/chosen" */
```

`.btn` uses `--shadow-hard` at rest, grows to `6px 6px 0 #000` on hover
(with a `translate(-2px,-2px)` lift), and shrinks to `1px 1px 0 #000` on
`:active` (with a `translate(2px,2px)` push-in) — the button visually
presses into the page. Reuse this exact hover/active pattern for any new
pressable primitive; don't invent a different button feel.

Border convention: 2px solid, usually `#000` on colored/light surfaces or
`var(--line)` on dark ones. Never 1px, never no border on a card-like
surface.

## Primitives (use these, don't reinvent)

- `.btn` / `.btn--pink` / `.btn--ghost` / `.btn--danger` / `.btn--sm` — the
  only button styles. `--ghost` for secondary actions, `--danger` only for
  destructive ones (nuke room, remove item).
- `.sticker` / `.sticker--acid` / `.sticker--blue` — small rotated badge
  (`transform: rotate(-2deg)`), used for "live", "soon™", pool labels. The
  slight rotation is intentional — don't straighten it.
- `.input` — dark inset field, 2px border, acid-green focus ring.
- `.modal-backdrop` / `.modal` — centered card, acid-green border, big offset
  shadow (`8px 8px 0 rgba(0,0,0,0.8)`), slight `rotate(-0.6deg)` on the
  identity gate card specifically (chaos, not perfectly aligned).
- `.seg` — segmented control (pill-less tab group), used for visibility
  toggles, axis pickers, content-type pickers. Selected segment = solid acid
  background + black text.
- `.hint` — the mono, dim, small-print voice. This is also where the site's
  jokes/personality live in copy — see "voice" below.
- `.connbadge` — tiny mono pill, dim by default, acid + acid border when
  `.on` (connected).
- `.pool__empty` / `.roomerror` — empty-state and error-state copy blocks.
  Always mono, dim, and should carry a joke (see voice).

## Per-surface patterns already established

- **Room bar** (`.roombar`): back link, editable name input (disabled unless
  owner), room-code chip (`.roombar__code`, copies bare code), a separate
  "copy link" ghost button (copies the full URL — these are deliberately two
  different actions, don't collapse them), connbadge, facepile, owner-only
  danger button on the far right.
- **Facepile** (`.facepile .avatar`): overlapping circular initials, `-8px`
  negative margin between them, 2px black border each.
- **Chat** (`ChatPanel.tsx` / `.chatpanel*`): fixed bottom-right floating
  toggle + expandable window, pink toggle button, unread badge in acid green.
  Shared across every game via `useRoom`'s `chat`/`sendChat`.
- **Boot screen** (`BootGate.tsx` / `.bootscreen*`): full-viewport, centered,
  spinning ring in acid green, escalating dry status copy + elapsed-seconds
  counter. This is the ONLY full-screen takeover pattern in the app — don't
  add a second one elsewhere.
- **Home page** (`Home.tsx`): giant three-line wordmark with three different
  treatments per line (solid ink / outlined-stroke pink / solid acid with a
  pink drop-shadow) — this staggered-treatment title is a one-off, don't
  replicate it verbatim elsewhere, but the "commit hard to one weird choice
  per element" spirit is the takeaway. Background decorations
  (`.home__deco`): huge (140-220px), near-invisible (`opacity: 0.07`),
  rotated, scattered in the corners — `?!`, `S+`, `VS`, `0/10`. Marquee strip
  uses a doubled/quadrupled string + `translateX(-50%)` infinite linear
  animation; needs `will-change: transform` + `translateZ(0)` in the
  keyframe or it visibly stutters on loop.
- **Footer** (`.sitefooter`): mono, centered, dim, dashed top border matching
  the marquee's dashed rule — satirical fake-legalese, not a real footer.

## Game-specific surfaces (for reference, don't copy blindly into a new game — adapt)

- Tier list: colored tier-label blocks, drag-and-drop items, hover-reveal
  per-row tool icons.
- Alignment chart: quadrant cross layout, edge-label inputs, hover tooltip
  with percentage breakdown.
- Showdown: two-panel VS matchup with a circular pink "VS" badge overlapping
  both panels, video/audio toggle as a `.seg` control centered above the
  panels.
- Rating: axis with tick marks + floating "dot" avatars positioned by score;
  collision handling wraps ties into new rows (bounded by measured container
  width via `ResizeObserver`) rather than letting them overflow sideways —
  if you add another "plot things on a number line" surface, reuse this
  wrap-not-overflow approach, don't just increment an unbounded offset.

## Motion rules

- Hover/press feedback on buttons: transform + shadow only, no color fade
  transitions longer than ~0.1s.
- Marquee/spinners: pure CSS `@keyframes`, `linear` timing, always paired
  with `will-change: transform` if it runs continuously.
- Cursors/drag ghosts: real-time position via inline `style.transform`, not
  CSS transitions (see `CursorLayer.tsx`) — these need to feel instant, not
  eased.

## Voice — the copy is part of the design

Hint text, empty states, and error messages are where the site's personality
lives. They should be dry, a little unhinged, and specific to the moment —
never generic ("no items yet"). Examples already in the codebase: "the pile
is empty, and so is your ranking of anything," "waiting on the room owner to
get their act together," "democracy is slow." When writing new copy in this
voice: keep it short (one clause of joke, not a paragraph), never undercut
actual clarity (the functional info still has to be there), and don't reuse
the exact same joke across two different games — each surface gets its own
flavor of the bit.

## Responsive

Mobile breakpoint is `max-width: 640px` (sometimes `900px` for two-column
layouts specifically). Shrink item/avatar sizes and font sizes at the
breakpoint rather than reflowing structure — check the bottom of
`styles.css` for the existing `@media` blocks before adding a new one.
