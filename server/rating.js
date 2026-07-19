// Game module: rating. Shared anime rating board — everyone scores 0-10 with
// one decimal, an item only appears on the shared axis once every participant
// has voted on it. "Participants" self-enroll: anyone who casts at least one
// vote in the room counts, so a new person joining mid-game correctly un-reveals
// items until they catch up. Votes for unrevealed items do travel in the state
// blob (full-state sync), so a devtools-literate friend could peek — accepted
// tradeoff at friend-group stakes, per-user filtered broadcasts not worth it.

export function initialState() {
  return {
    axis: "y", // "y" = vertical scale, "x" = horizontal; owner-toggleable
    items: {}, // itemId -> { id, title, image_url, subtitle }
    votes: {}, // itemId -> { userId: score } — score always 0..10, 1 decimal
    participants: [], // userIds who have cast >= 1 vote
    names: {}, // userId -> last-seen nick, so hover breakdowns work for offline voters
  };
}

const MAX_ITEMS = 500;

function cleanScore(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // two decimals, clamped — 8.37 stays 8.37, 8.373 becomes 8.37
  return Math.max(0, Math.min(10, Math.round(n * 100) / 100));
}

function addParticipant(state, userId) {
  if (!state.participants.includes(userId)) state.participants.push(userId);
}

const ops = {
  addItems(state, p) {
    const incoming = Array.isArray(p.items) ? p.items.slice(0, MAX_ITEMS) : [];
    if (Object.keys(state.items).length + incoming.length > MAX_ITEMS)
      throw new Error(`board is full (${MAX_ITEMS} anime max)`);
    for (const raw of incoming) {
      const id = String(raw.id || "");
      const image_url = String(raw.image_url || "");
      if (!id || !image_url || state.items[id]) continue;
      state.items[id] = {
        id,
        title: String(raw.title || "untitled").slice(0, 200),
        image_url,
        subtitle: String(raw.subtitle || "").slice(0, 200),
      };
    }
  },

  removeItem(state, p, ctx) {
    if (!ctx.isOwner) throw new Error("only the room owner can remove anime");
    delete state.items[p.itemId];
    delete state.votes[p.itemId];
  },

  vote(state, p, ctx) {
    const { itemId } = p;
    if (!state.items[itemId]) throw new Error("unknown anime");
    const score = cleanScore(p.score);
    if (score === null) {
      // explicit clear — retract your vote
      if (state.votes[itemId]) delete state.votes[itemId][ctx.userId];
      return;
    }
    if (!state.votes[itemId]) state.votes[itemId] = {};
    state.votes[itemId][ctx.userId] = score;
    addParticipant(state, ctx.userId);
    if (ctx.nick) state.names[ctx.userId] = ctx.nick;
  },

  setAxis(state, p, ctx) {
    if (!ctx.isOwner) throw new Error("only the room owner can flip the axis");
    if (p.axis === "x" || p.axis === "y") state.axis = p.axis;
  },

  removeParticipant(state, p, ctx) {
    // owner unblocks reveals when someone voted once and vanished forever.
    // their existing votes stay (their opinions still count where cast) —
    // they just stop being REQUIRED for new reveals. voting again re-enrolls.
    if (!ctx.isOwner) throw new Error("only the room owner can remove a rater");
    const target = String(p.userId || "");
    if (!state.participants.includes(target)) throw new Error("not a rater here");
    state.participants = state.participants.filter((id) => id !== target);
  },
};

export function applyOp(state, op, ctx) {
  const handler = ops[op?.type];
  if (!handler) throw new Error(`unknown op: ${op?.type}`);
  handler(state, op, ctx);
}

export function sanitize(state) {
  if (!state.items || !state.votes) return;
  // drop votes pointing at items that no longer exist
  for (const itemId of Object.keys(state.votes)) {
    if (!state.items[itemId]) delete state.votes[itemId];
  }
  if (!Array.isArray(state.participants)) state.participants = [];
  if (!state.names) state.names = {};
}
