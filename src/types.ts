export interface User {
  id: string;
  nick: string;
  color: string;
}

export interface GameInfo {
  slug: string;
  display_name: string;
  tagline: string;
  icon: string;
}

export interface RoomMeta {
  id: string;
  game: string;
  name: string;
  owner_id: string;
  owner_nick: string;
  visibility: "public" | "private";
  has_passcode: boolean;
}

export interface RoomListing {
  id: string;
  game: string;
  name: string;
  owner_id: string;
  owner_nick: string;
  visibility: string;
  created_at: number;
  updated_at: number;
  online: number;
}

export interface MediaItem {
  id: string;
  title: string;
  image_url: string;
  source: string;
  subtitle?: string;
}

export interface Tier {
  id: string;
  label: string;
  color: string;
  items: string[];
}

export interface TierListState {
  tiers: Tier[];
  pool: string[];
  media: Record<string, MediaItem>;
}

export type TierlistOp =
  | { type: "moveItem"; itemId: string; to: { container: string; index: number } }
  | { type: "addMedia"; items: Partial<MediaItem>[] }
  | { type: "removeItem"; itemId: string }
  | { type: "updateTier"; tierId: string; label?: string; color?: string }
  | { type: "addTier"; afterTierId?: string; label?: string; color?: string }
  | { type: "removeTier"; tierId: string }
  | { type: "moveTier"; tierId: string; dir: "up" | "down" };

export interface AxisLabels {
  top: string;
  right: string;
  bottom: string;
  left: string;
}

export type Axis = keyof AxisLabels;

export interface AlignmentState {
  labels: AxisLabels;
  positions: Record<string, { x: number; y: number }>;
  shelf: string[];
  media: Record<string, MediaItem>;
}

export type AlignmentOp =
  | { type: "placeItem"; itemId: string; x: number; y: number }
  | { type: "unplaceItem"; itemId: string }
  | { type: "addMedia"; items: Partial<MediaItem>[] }
  | { type: "removeItem"; itemId: string }
  | { type: "setLabel"; axis: Axis; text: string };
