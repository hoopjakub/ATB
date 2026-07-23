import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AlignmentOp, AlignmentState, Axis, MediaItem } from "../../types";
import { useRoom } from "../../lib/useRoom";
import { useUser } from "../../App";
import { useToast } from "../../components/Toasts";
import { api } from "../../lib/api";
import CursorLayer from "../shared/CursorLayer";
import MediaDrawer from "../shared/MediaDrawer";
import ChatPanel from "../shared/ChatPanel";
import { downloadElementAsImage } from "../../lib/downloadImage";

interface DragState {
  itemId: string;
  // last known pointer position in board-space, and whether it's over the square
  x: number;
  y: number;
  overSquare: boolean;
}

const QUADRANTS: {
  key: string;
  match: (x: number, y: number) => boolean;
  name: (l: AlignmentState["labels"]) => string;
}[] = [
  { key: "top-left", match: (x, y) => x < 0.5 && y < 0.5, name: (l) => `${l.top || "Top"} ${l.left || "Left"}` },
  { key: "top-right", match: (x, y) => x >= 0.5 && y < 0.5, name: (l) => `${l.top || "Top"} ${l.right || "Right"}` },
  { key: "bottom-left", match: (x, y) => x < 0.5 && y >= 0.5, name: (l) => `${l.bottom || "Bottom"} ${l.left || "Left"}` },
  { key: "bottom-right", match: (x, y) => x >= 0.5 && y >= 0.5, name: (l) => `${l.bottom || "Bottom"} ${l.right || "Right"}` },
];

function pct(x: number, y: number, labels: AlignmentState["labels"]) {
  const right = Math.round(x * 100);
  const left = 100 - right;
  const top = Math.round((1 - y) * 100);
  const bottom = 100 - top;
  return { top, right, bottom, left };
}

export default function AlignmentBoard({ roomId }: { roomId: string }) {
  const { user } = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  const {
    room, state, presence, error, connected,
    cursors, remoteDrags, chat, sendOp, emit, emitVolatile, sendChat, onOpError,
  } = useRoom<AlignmentState, AlignmentOp>(roomId, user);

  useEffect(() => onOpError(toast), [onOpError, toast]);

  const isOwner = room?.owner_id === user.id;
  const boardRef = useRef<HTMLDivElement>(null);
  const squareRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const heldBy = useMemo(() => {
    const map: Record<string, typeof presence[number]> = {};
    for (const d of Object.values(remoteDrags)) map[d.itemId] = d.user;
    return map;
  }, [remoteDrags, presence]);

  const boardPoint = (clientX: number, clientY: number) => {
    const rect = boardRef.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: 0, y: 0 };
  };

  const lastCursorSent = useRef(0);
  const onBoardPointerMove = (e: React.PointerEvent) => {
    const now = performance.now();
    if (now - lastCursorSent.current < 40) return;
    lastCursorSent.current = now;
    emitVolatile("cursor", boardPoint(e.clientX, e.clientY));
  };

  const normalizedFromClient = (clientX: number, clientY: number) => {
    const rect = squareRef.current?.getBoundingClientRect();
    if (!rect) return null;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  };

  const startDrag = (e: React.PointerEvent, itemId: string) => {
    if (e.button !== 0 || heldBy[itemId]) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    let lastBroadcast = 0;

    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        started = true;
        document.body.style.userSelect = "none";
        emit("drag:start", { itemId });
      }
      if (ghostRef.current) {
        ghostRef.current.style.left = `${ev.clientX}px`;
        ghostRef.current.style.top = `${ev.clientY}px`;
      }
      const norm = normalizedFromClient(ev.clientX, ev.clientY);
      const bp = boardPoint(ev.clientX, ev.clientY);
      const next: DragState = { itemId, x: norm ? norm.x : bp.x, y: norm ? norm.y : bp.y, overSquare: !!norm };
      dragRef.current = next;
      setDrag(next);

      const now = performance.now();
      if (now - lastBroadcast > 40) {
        lastBroadcast = now;
        emitVolatile("drag:move", bp);
      }
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.userSelect = "";
      if (started) {
        const last = dragRef.current;
        if (last?.overSquare) {
          sendOp(
            { type: "placeItem", itemId, x: last.x, y: last.y },
            (s) => {
              s.shelf = s.shelf.filter((id) => id !== itemId);
              s.positions[itemId] = { x: last.x, y: last.y };
              return s;
            }
          );
        } else {
          sendOp(
            { type: "unplaceItem", itemId },
            (s) => {
              delete s.positions[itemId];
              s.shelf = [itemId, ...s.shelf.filter((id) => id !== itemId)];
              return s;
            }
          );
        }
        emit("drag:end");
      }
      dragRef.current = null;
      setDrag(null);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  if (error) {
    return (
      <div className="roomerror">
        <h2>{error.code === "deleted" ? "room nuked" : "can't get in"}</h2>
        <p>{error.message}</p>
        <Link className="btn" to="/g/alignment">back to rooms</Link>
      </div>
    );
  }
  if (!room || !state) {
    return <div className="roomerror"><p>connecting…</p></div>;
  }

  const draggedItem = drag ? state.media[drag.itemId] : null;
  const placedIds = Object.keys(state.positions);
  const totalItems = Object.keys(state.media).length;

  const setLabel = (axis: Axis, text: string) => {
    if (text === state.labels[axis]) return;
    sendOp({ type: "setLabel", axis, text }, (s) => {
      s.labels = { ...s.labels, [axis]: text };
      return s;
    });
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast(`${label} copied — send it to the group chat`),
      () => toast(text)
    );
  };

  const deleteRoom = async () => {
    if (!confirm("nuke this room for everyone? there's no undo.")) return;
    try {
      await api(`/api/rooms/${roomId}`, { method: "DELETE", body: JSON.stringify({ userId: user.id }) });
      navigate("/g/alignment");
    } catch (err: any) {
      toast(err.message);
    }
  };

  const downloadImage = async () => {
    if (!boardRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadElementAsImage(boardRef.current, room.name);
    } catch (err: any) {
      toast(`couldn't generate the image: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  const quadCounts = QUADRANTS.map((q) => {
    const ids = placedIds.filter((id) => {
      const p = state.positions[id];
      return p && q.match(p.x, p.y);
    });
    return { ...q, ids };
  });

  return (
    <main className="room">
      <div className="roombar">
        <Link to="/g/alignment" className="btn btn--ghost btn--sm" title="back to room list">←</Link>
        <input
          className="roombar__name"
          defaultValue={room.name}
          key={room.name}
          disabled={!isOwner}
          maxLength={60}
          onBlur={(e) => isOwner && e.target.value.trim() && e.target.value !== room.name && emit("room:rename", e.target.value.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <button className="roombar__code" onClick={() => copy(roomId, "room code")} title="copy room code">
          {roomId} ⧉
        </button>
        <button className="btn btn--ghost btn--sm" onClick={() => copy(`${location.origin}/room/${roomId}`, "invite link")} title="copy a clickable invite link">
          copy link
        </button>
        <button className="btn btn--ghost btn--sm" onClick={downloadImage} disabled={downloading} title="download this chart as an image">
          {downloading ? "…" : "⬇ save image"}
        </button>
        <span className={`connbadge ${connected ? "on" : ""}`}>{connected ? "live" : "offline"}</span>
        <div className="facepile" title={presence.map((p) => p.nick).join(", ")}>
          {presence.slice(0, 8).map((p) => (
            <span key={p.id} className="avatar" style={{ background: p.color }} title={p.nick}>
              {p.nick.slice(0, 1).toUpperCase()}
            </span>
          ))}
          {presence.length > 8 && <span className="avatar" style={{ background: "#444" }}>+{presence.length - 8}</span>}
        </div>
        {isOwner && (
          <button className="btn btn--danger btn--sm" onClick={deleteRoom} title="delete room">nuke</button>
        )}
      </div>

      <div className="board-wrap" onPointerMove={onBoardPointerMove}>
        <div className="board align-layout" ref={boardRef}>
          <div className="align-main">
            <div className="align-square" ref={squareRef}>
              <div className="align-cross-v" />
              <div className="align-cross-h" />
              <AxisLabel axis="top" value={state.labels.top} disabled={!isOwner} onCommit={setLabel} />
              <AxisLabel axis="right" value={state.labels.right} disabled={!isOwner} onCommit={setLabel} />
              <AxisLabel axis="bottom" value={state.labels.bottom} disabled={!isOwner} onCommit={setLabel} />
              <AxisLabel axis="left" value={state.labels.left} disabled={!isOwner} onCommit={setLabel} />

              {placedIds.map((id) => {
                if (drag?.itemId === id) return null;
                const item = state.media[id];
                const p = state.positions[id];
                if (!item || !p) return null;
                const holder = heldBy[id];
                const p2 = pct(p.x, p.y, state.labels);
                return (
                  <div
                    key={id}
                    className={`align-item ${holder ? "item--held" : ""}`}
                    data-item-id={id}
                    data-holder={holder?.nick || ""}
                    style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
                    onPointerDown={(e) => startDrag(e, id)}
                    onPointerEnter={() => setHoveredId(id)}
                    onPointerLeave={() => setHoveredId((h) => (h === id ? null : h))}
                    title={item.title}
                  >
                    <img src={item.image_url} alt={item.title} draggable={false} loading="lazy" />
                    {isOwner && (
                      <button
                        className="item__zap"
                        title="remove from board (owner only)"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={() => sendOp({ type: "removeItem", itemId: id })}
                      >
                        ✕
                      </button>
                    )}
                    {hoveredId === id && !drag && (
                      <div
                        className={[
                          "align-tooltip",
                          p.y < 0.18 && "align-tooltip--below",
                          p.x < 0.18 && "align-tooltip--left",
                          p.x > 0.82 && "align-tooltip--right",
                        ].filter(Boolean).join(" ")}
                      >
                        <div>{item.title}</div>
                        <div>
                          <strong>{p2.top}%</strong> {state.labels.top || "top"} · <strong>{p2.bottom}%</strong> {state.labels.bottom || "bottom"}
                        </div>
                        <div>
                          <strong>{p2.left}%</strong> {state.labels.left || "left"} · <strong>{p2.right}%</strong> {state.labels.right || "right"}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="align-shelf">
              <span className="pool__label sticker sticker--blue">unplaced · {state.shelf.length}</span>
              <div className="align-shelf-items">
                {totalItems === 0 ? (
                  <div className="pool__empty">
                    add images below ↓, then drag them anywhere on the chart. label the four edges above so everyone knows what quadrant of hell they've landed in.
                  </div>
                ) : state.shelf.length === 0 ? (
                  <div className="pool__empty">everything's placed. no more indecisive hovering — add more images below, or drag one back up here if you've had a change of heart.</div>
                ) : (
                  state.shelf.map((id) => {
                    if (drag?.itemId === id) return null;
                    const item = state.media[id];
                    if (!item) return null;
                    const holder = heldBy[id];
                    return (
                      <div
                        key={id}
                        className={`item ${holder ? "item--held" : ""}`}
                        data-item-id={id}
                        data-holder={holder?.nick || ""}
                        title={item.title}
                        onPointerDown={(e) => startDrag(e, id)}
                      >
                        <img src={item.image_url} alt={item.title} draggable={false} loading="lazy" />
                        <span className="item__title">{item.title}</span>
                        {isOwner && (
                          <button
                            className="item__zap"
                            title="remove from board (owner only)"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={() => sendOp({ type: "removeItem", itemId: id })}
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          <aside className="align-stats">
            <h3>the breakdown</h3>
            {quadCounts.map((q) => (
              <div key={q.key} className="align-quad">
                <div className="align-quad__name">{q.name(state.labels)}</div>
                <div className="align-quad__count">{q.ids.length} item{q.ids.length === 1 ? "" : "s"}</div>
                {q.ids.length > 0 && (
                  <div className="align-quad__list">
                    {q.ids.slice(0, 12).map((id) => (
                      <div key={id} className="align-quad__item">{state.media[id]?.title}</div>
                    ))}
                    {q.ids.length > 12 && <div className="align-quad__item">+{q.ids.length - 12} more</div>}
                  </div>
                )}
              </div>
            ))}
          </aside>

          <CursorLayer cursors={cursors} drags={remoteDrags} media={state.media} />
        </div>
      </div>

      <MediaDrawer
        onAdd={(items) => sendOp({ type: "addMedia", items })}
        inBoard={(id) => !!state.media[id]}
      />

      {draggedItem && drag && (
        <div className="ghost" ref={ghostRef}>
          <img src={draggedItem.image_url} alt="" />
        </div>
      )}

      <ChatPanel messages={chat} onSend={sendChat} currentUserId={user.id} />
    </main>
  );
}

function AxisLabel({
  axis,
  value,
  disabled,
  onCommit,
}: {
  axis: Axis;
  value: string;
  disabled: boolean;
  onCommit: (axis: Axis, text: string) => void;
}) {
  return (
    <div className={`align-axis-label align-axis-label--${axis}`}>
      <input
        defaultValue={value}
        key={value}
        disabled={disabled}
        maxLength={30}
        placeholder={disabled ? axis : "add text"}
        onBlur={(e) => onCommit(axis, e.target.value.trim())}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
    </div>
  );
}
