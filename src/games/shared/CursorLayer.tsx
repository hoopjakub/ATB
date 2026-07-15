import type { RemoteCursor, RemoteDrag } from "../../lib/useRoom";
import type { MediaItem } from "../../types";

// Renders other people's cursors + the item ghosts they're dragging,
// positioned in board-space (the parent .board element is position:relative).
export default function CursorLayer({
  cursors,
  drags,
  media,
}: {
  cursors: Record<string, RemoteCursor>;
  drags: Record<string, RemoteDrag>;
  media: Record<string, MediaItem>;
}) {
  return (
    <>
      {Object.values(cursors).map((c) => (
        <div
          key={c.user.id}
          className="cursor"
          style={{ transform: `translate(${c.x}px, ${c.y}px)` }}
        >
          <svg width="18" height="20" viewBox="0 0 18 20">
            <path
              d="M1 1 L1 15 L5.5 11.5 L8.5 18 L11.5 16.5 L8.5 10.5 L14 10 Z"
              fill={c.user.color}
              stroke="#000"
              strokeWidth="1.5"
            />
          </svg>
          <span className="cursor__tag" style={{ background: c.user.color }}>
            {c.user.nick}
          </span>
        </div>
      ))}
      {Object.values(drags).map((d) => {
        const item = media[d.itemId];
        if (!item || !d.hasPos) return null;
        return (
          <div
            key={d.user.id}
            className="ghost ghost--remote"
            style={{ left: d.x, top: d.y, color: d.user.color, borderColor: d.user.color }}
          >
            <img src={item.image_url} alt={item.title} />
            <span className="ghost__tag" style={{ background: d.user.color }}>
              {d.user.nick}
            </span>
          </div>
        );
      })}
    </>
  );
}
