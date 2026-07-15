// Game module: showdown. Single-elimination bracket voting. "Majority of everyone
// currently connected" resolves each matchup — with exactly one person in the room
// that's just "whatever they pick," so solo and multiplayer are the same code path.
import crypto from "node:crypto";

export const SIZES = [32, 64, 128, 256, 512];
export const CONTENT_TYPES = ["openings", "endings", "mixed"];

export const TIE_MESSAGES = [
  "Fuh nah bros, one needs to win. Revote.",
  "A tie? Absolutely not. Everyone vote again.",
  "The universe demands a winner. Try again.",
  "Nobody move. Nobody's won anything. Revote.",
  "Cowards. Pick a side this time.",
  "Tie detected. Democracy has failed. Try again.",
  "That's a draw, and draws are for losers. Revote.",
  "Flip a mental coin and commit. Go again.",
  "Everyone just canceled everyone else out. Revote.",
  "This isn't chess. Someone has to lose. Again.",
];

export function initialState({ size, contentType } = {}) {
  return {
    size: SIZES.includes(Number(size)) ? Number(size) : 32,
    contentType: CONTENT_TYPES.includes(contentType) ? contentType : "openings",
    entries: {}, // entryId -> { id, title, animeTitle, subtitle, videoUrl, kind }
    bracket: [], // round-0 seeding: [[entryId, entryId], ...], length = size/2
    round: 0,
    matchIndex: 0,
    votes: {}, // userId -> "left" | "right", cleared each time a matchup resolves
    history: [], // [{ round, matchIndex, pair: [a,b], winner }]
    status: "seeding", // "seeding" | "in_progress" | "complete"
    tieMessage: null, // set briefly after a tie so the client can show it, then it self-clears
  };
}

function roundPairs(state, round) {
  if (round === 0) return state.bracket;
  const prevWinners = state.history
    .filter((h) => h.round === round - 1)
    .sort((a, b) => a.matchIndex - b.matchIndex)
    .map((h) => h.winner);
  if (prevWinners.length <= 1) return []; // 1 winner left = champion, no next round
  const pairs = [];
  for (let i = 0; i < prevWinners.length; i += 2) pairs.push([prevWinners[i], prevWinners[i + 1]]);
  return pairs;
}

function currentMatch(state) {
  const pairs = roundPairs(state, state.round);
  return pairs[state.matchIndex] || null;
}

function shuffled(arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const ops = {
  addEntries(state, p, ctx) {
    if (!ctx.isOwner) throw new Error("only the room owner can edit the bracket");
    if (state.status !== "seeding") throw new Error("tournament already started");
    const incoming = Array.isArray(p.entries) ? p.entries.slice(0, state.size) : [];
    const currentCount = Object.keys(state.entries).length;
    if (currentCount + incoming.length > state.size) {
      throw new Error(`bracket only holds ${state.size} entries (${currentCount} already in)`);
    }
    for (const raw of incoming) {
      const id = String(raw.id || crypto.randomUUID());
      if (state.entries[id]) continue;
      const videoUrl = String(raw.videoUrl || "") || null;
      state.entries[id] = {
        id,
        title: String(raw.title || "untitled").slice(0, 200),
        animeTitle: String(raw.animeTitle || raw.title || "").slice(0, 200),
        subtitle: String(raw.subtitle || "").slice(0, 200),
        videoUrl,
        kind: !videoUrl ? "none" : /\.(webm|mp4|m4v)(\?|$)/i.test(videoUrl) ? "file" : "youtube",
      };
    }
  },

  replaceEntries(state, p, ctx) {
    // used by autofill: wholesale replace while still seeding
    if (!ctx.isOwner) throw new Error("only the room owner can edit the bracket");
    if (state.status !== "seeding") throw new Error("tournament already started");
    const incoming = Array.isArray(p.entries) ? p.entries.slice(0, state.size) : [];
    state.entries = {};
    for (const raw of incoming) {
      const id = String(raw.id || crypto.randomUUID());
      const videoUrl = String(raw.videoUrl || "") || null;
      state.entries[id] = {
        id,
        title: String(raw.title || "untitled").slice(0, 200),
        animeTitle: String(raw.animeTitle || raw.title || "").slice(0, 200),
        subtitle: String(raw.subtitle || "").slice(0, 200),
        videoUrl,
        kind: !videoUrl ? "none" : /\.(webm|mp4|m4v)(\?|$)/i.test(videoUrl) ? "file" : "youtube",
      };
    }
  },

  removeEntry(state, p, ctx) {
    if (!ctx.isOwner) throw new Error("only the room owner can edit the bracket");
    if (state.status !== "seeding") throw new Error("tournament already started");
    delete state.entries[p.entryId];
  },

  startTournament(state, _p, ctx) {
    if (!ctx.isOwner) throw new Error("only the room owner can start it");
    if (state.status !== "seeding") throw new Error("already started");
    const ids = Object.keys(state.entries);
    if (ids.length !== state.size) {
      throw new Error(`need exactly ${state.size} entries — you have ${ids.length}`);
    }
    const order = shuffled(ids);
    const pairs = [];
    for (let i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
    state.bracket = pairs;
    state.round = 0;
    state.matchIndex = 0;
    state.votes = {};
    state.history = [];
    state.tieMessage = null;
    state.status = "in_progress";
  },

  mixUp(state, _p, ctx) {
    if (!ctx.isOwner) throw new Error("only the room owner can reshuffle");
    if (state.status !== "seeding") throw new Error("can only reshuffle before starting");
    // no-op at this stage (bracket doesn't exist yet); kept for symmetry with in-progress reset
  },

  vote(state, p, ctx) {
    if (state.status !== "in_progress") throw new Error("no active matchup");
    const side = p.side === "left" || p.side === "right" ? p.side : null;
    if (!side) throw new Error("bad vote");
    const match = currentMatch(state);
    if (!match) throw new Error("no active matchup");
    state.votes[ctx.userId] = side;

    const present = ctx.presenceIds || [ctx.userId];
    const everyoneVoted = present.every((id) => state.votes[id]);
    if (!everyoneVoted) return;

    const tally = { left: 0, right: 0 };
    for (const id of present) if (state.votes[id]) tally[state.votes[id]]++;

    if (tally.left === tally.right) {
      state.votes = {};
      state.tieMessage = TIE_MESSAGES[crypto.randomInt(TIE_MESSAGES.length)];
      return;
    }

    const winnerSide = tally.left > tally.right ? 0 : 1;
    const winner = match[winnerSide];
    state.history.push({ round: state.round, matchIndex: state.matchIndex, pair: match, winner, votes: { ...state.votes } });
    state.votes = {};
    state.tieMessage = null;

    const pairsThisRound = roundPairs(state, state.round);
    if (state.matchIndex + 1 < pairsThisRound.length) {
      state.matchIndex++;
    } else {
      const nextPairs = roundPairs(state, state.round + 1);
      if (nextPairs.length === 0) {
        state.status = "complete";
      } else {
        state.round++;
        state.matchIndex = 0;
      }
    }
  },

  stepBack(state, _p, ctx) {
    if (!ctx.isOwner) throw new Error("only the room owner can step back");
    if (state.history.length === 0) throw new Error("nothing to step back to");
    const last = state.history.pop();
    state.round = last.round;
    state.matchIndex = last.matchIndex;
    state.votes = {};
    state.tieMessage = null;
    state.status = "in_progress";
  },

  reset(state, _p, ctx) {
    if (!ctx.isOwner) throw new Error("only the room owner can reset");
    if (state.bracket.length === 0) throw new Error("nothing to reset");
    state.round = 0;
    state.matchIndex = 0;
    state.votes = {};
    state.history = [];
    state.tieMessage = null;
    state.status = "in_progress";
  },

  backToSeeding(state, _p, ctx) {
    if (!ctx.isOwner) throw new Error("only the room owner can do that");
    state.bracket = [];
    state.round = 0;
    state.matchIndex = 0;
    state.votes = {};
    state.history = [];
    state.tieMessage = null;
    state.status = "seeding";
  },
};

export function applyOp(state, op, ctx) {
  const handler = ops[op?.type];
  if (!handler) throw new Error(`unknown op: ${op?.type}`);
  handler(state, op, ctx);
}

// derive the current matchup + standings for the client without re-shipping all of history
export function deriveView(state) {
  const match = state.status === "in_progress" ? currentMatch(state) : null;
  const pairsThisRound = state.status === "in_progress" ? roundPairs(state, state.round) : [];
  let placements = null;
  if (state.status === "complete") {
    placements = derivePlacements(state);
  }
  return {
    match,
    totalMatchesThisRound: pairsThisRound.length,
    placements,
  };
}

function derivePlacements(state) {
  // champion, runner-up, then group earlier eliminations by the round they lost in
  const maxRound = state.history.reduce((m, h) => Math.max(m, h.round), 0);
  const final = state.history.filter((h) => h.round === maxRound);
  const champion = final[0]?.winner;
  const runnerUp = final[0]?.pair.find((id) => id !== champion);
  const groups = [{ label: "Champion", ids: champion ? [champion] : [] }];
  if (runnerUp) groups.push({ label: "Runner-up", ids: [runnerUp] });
  for (let round = maxRound - 1; round >= 0; round--) {
    const losers = state.history
      .filter((h) => h.round === round)
      .map((h) => h.pair.find((id) => id !== h.winner))
      .filter(Boolean);
    if (losers.length) {
      const place = losers.length === 1 ? `${ordinal(losers.length === 1 ? maxRound - round + 1 : 0)}` : null;
      groups.push({ label: placeLabel(round, maxRound), ids: losers });
    }
  }
  return groups;
}

function placeLabel(round, maxRound) {
  const stepsFromFinal = maxRound - round;
  const size = 2 ** (stepsFromFinal + 1);
  const start = size / 2 + 1;
  const end = size;
  return start === end ? `${ordinal(start)} place` : `${ordinal(start)}–${ordinal(end)} place`;
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export function sanitize(state) {
  if (!state.entries || !state.size) return;
  if (!SIZES.includes(state.size)) state.size = 32;
}
