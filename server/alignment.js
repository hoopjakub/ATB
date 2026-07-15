// Game module: alignment. A 2-axis chart — each image gets a free (x,y) position
// instead of a discrete tier bucket. Axis labels are user-editable text for each
// of the 4 edges (top/right/bottom/left); percentages and quadrant names are
// derived from position, not stored, so editing a label instantly relabels
// every item without touching their coordinates.
import crypto from "node:crypto";

export function initialState() {
  return {
    labels: { top: "", right: "", bottom: "", left: "" },
    positions: {}, // itemId -> { x, y }, both in [0,1], (0,0) = top-left
    shelf: [], // unplaced item ids
    media: {},
  };
}

const MAX_ITEMS = 500;

const ops = {
  placeItem(state, p) {
    const { itemId } = p;
    if (!state.media[itemId]) throw new Error("unknown item");
    const x = Math.max(0, Math.min(1, Number(p.x)));
    const y = Math.max(0, Math.min(1, Number(p.y)));
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("bad coordinates");
    state.shelf = state.shelf.filter((id) => id !== itemId);
    state.positions[itemId] = { x, y };
  },

  unplaceItem(state, p) {
    const { itemId } = p;
    if (!state.media[itemId]) throw new Error("unknown item");
    delete state.positions[itemId];
    state.shelf = state.shelf.filter((id) => id !== itemId);
    state.shelf.unshift(itemId);
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
      state.shelf.unshift(id);
    }
  },

  removeItem(state, p, ctx) {
    if (!ctx.isOwner) throw new Error("only the room owner can remove items");
    const { itemId } = p;
    if (!state.media[itemId]) throw new Error("unknown item");
    delete state.positions[itemId];
    state.shelf = state.shelf.filter((id) => id !== itemId);
    delete state.media[itemId];
  },

  setLabel(state, p) {
    const axis = p.axis;
    if (!["top", "right", "bottom", "left"].includes(axis)) throw new Error("unknown axis");
    state.labels[axis] = String(p.text || "").slice(0, 30);
  },
};

export function applyOp(state, op, ctx) {
  const handler = ops[op?.type];
  if (!handler) throw new Error(`unknown op: ${op?.type}`);
  handler(state, op, ctx);
}

// self-heal: any media id that's neither placed nor shelved goes back on the shelf
export function sanitize(state) {
  if (!state.media || !state.positions || !state.shelf) return;
  const known = new Set([...state.shelf, ...Object.keys(state.positions)]);
  for (const id of Object.keys(state.media)) if (!known.has(id)) state.shelf.push(id);
}
