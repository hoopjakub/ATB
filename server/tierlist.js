// Game module: tierlist. Owns the shape of a room's state blob and how ops mutate it.
import crypto from "node:crypto";

const DEFAULT_TIERS = [
  { label: "S", color: "#ff5c5c" },
  { label: "A", color: "#ffa45c" },
  { label: "B", color: "#ffd75c" },
  { label: "C", color: "#b8e05c" },
  { label: "D", color: "#5cc8ff" },
  { label: "F", color: "#9b9b9b" },
];

export function initialState() {
  return {
    tiers: DEFAULT_TIERS.map((t) => ({
      id: crypto.randomUUID().slice(0, 8),
      label: t.label,
      color: t.color,
      items: [],
    })),
    pool: [],
    // denormalized media map so clients render without extra fetches:
    // { [mediaId]: { id, title, image_url, source } }
    media: {},
  };
}

function findContainer(state, containerId) {
  if (containerId === "pool") return state.pool;
  const tier = state.tiers.find((t) => t.id === containerId);
  return tier ? tier.items : null;
}

function removeEverywhere(state, itemId) {
  state.pool = state.pool.filter((id) => id !== itemId);
  for (const tier of state.tiers) tier.items = tier.items.filter((id) => id !== itemId);
}

const MAX_ITEMS = 500;
const MAX_TIERS = 12;

// Each handler mutates state (a fresh deep clone) or throws with a reason.
// ctx = { userId, isOwner }
const ops = {
  moveItem(state, p) {
    const { itemId, to } = p;
    if (!state.media[itemId]) throw new Error("unknown item");
    if (!findContainer(state, to.container)) throw new Error("unknown container");
    // resolve dest AFTER removeEverywhere — it replaces the arrays
    removeEverywhere(state, itemId);
    const dest = findContainer(state, to.container);
    const idx = Math.max(0, Math.min(dest.length, to.index | 0));
    dest.splice(idx, 0, itemId);
  },

  addMedia(state, p) {
    const items = Array.isArray(p.items) ? p.items.slice(0, 50) : [];
    if (Object.keys(state.media).length + items.length > MAX_ITEMS)
      throw new Error("board is full (500 items max)");
    for (const raw of items) {
      const id = String(raw.id || crypto.randomUUID());
      if (state.media[id]) continue;
      const title = String(raw.title || "untitled").slice(0, 200);
      const image_url = String(raw.image_url || "");
      if (!image_url) continue;
      state.media[id] = { id, title, image_url, source: String(raw.source || "manual_url") };
      state.pool.unshift(id);
    }
  },

  removeItem(state, p, ctx) {
    if (!ctx.isOwner) throw new Error("only the room owner can remove items");
    const { itemId } = p;
    if (!state.media[itemId]) throw new Error("unknown item");
    removeEverywhere(state, itemId);
    delete state.media[itemId];
  },

  updateTier(state, p) {
    const tier = state.tiers.find((t) => t.id === p.tierId);
    if (!tier) throw new Error("unknown tier");
    if (typeof p.label === "string") tier.label = p.label.slice(0, 24);
    if (typeof p.color === "string" && /^#[0-9a-fA-F]{6}$/.test(p.color)) tier.color = p.color;
  },

  addTier(state, p) {
    if (state.tiers.length >= MAX_TIERS) throw new Error("too many tiers");
    const tier = {
      id: crypto.randomUUID().slice(0, 8),
      label: String(p.label || "NEW").slice(0, 24),
      color: /^#[0-9a-fA-F]{6}$/.test(p.color || "") ? p.color : "#c6ff3d",
      items: [],
    };
    const at = state.tiers.findIndex((t) => t.id === p.afterTierId);
    if (at >= 0) state.tiers.splice(at + 1, 0, tier);
    else state.tiers.push(tier);
  },

  removeTier(state, p) {
    const idx = state.tiers.findIndex((t) => t.id === p.tierId);
    if (idx < 0) throw new Error("unknown tier");
    if (state.tiers.length <= 1) throw new Error("can't remove the last tier");
    const [tier] = state.tiers.splice(idx, 1);
    state.pool.unshift(...tier.items);
  },

  moveTier(state, p) {
    const idx = state.tiers.findIndex((t) => t.id === p.tierId);
    if (idx < 0) throw new Error("unknown tier");
    const to = idx + (p.dir === "up" ? -1 : 1);
    if (to < 0 || to >= state.tiers.length) return;
    const [tier] = state.tiers.splice(idx, 1);
    state.tiers.splice(to, 0, tier);
  },
};

export function applyOp(state, op, ctx) {
  const handler = ops[op?.type];
  if (!handler) throw new Error(`unknown op: ${op?.type}`);
  handler(state, op, ctx);
}

// self-heal: any media id not present in a tier or the pool goes back to the pool
export function sanitize(state) {
  if (!state.media || !state.tiers || !state.pool) return;
  const placed = new Set([...state.pool, ...state.tiers.flatMap((t) => t.items)]);
  for (const id of Object.keys(state.media)) if (!placed.has(id)) state.pool.push(id);
}
