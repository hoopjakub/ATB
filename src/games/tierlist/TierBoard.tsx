import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { MediaItem, Tier, TierListState, TierlistOp, User } from "../../types";
import { useRoom } from "../../lib/useRoom";
import { useUser } from "../../App";
import { useToast } from "../../components/Toasts";
import { api } from "../../lib/api";
import CursorLayer from "../shared/CursorLayer";
import MediaDrawer from "../shared/MediaDrawer";
import ChatPanel from "../shared/ChatPanel";
import { downloadElementAsImage } from "../../lib/downloadImage";

const TIER_COLORS = ["#ff5c5c", "#ffa45c", "#ffd75c", "#b8e05c", "#5cc8ff", "#c68bff", "#ff8bd1", "#9b9b9b", "#c6ff3d", "#3dc8ff"];

interface DragState {
  itemId: string;
  over: { container: string; index: number } | null;
}

// pure client-side mirror of the server's moveItem, for optimistic updates
function applyMoveLocal(s: TierListState, itemId: string, to: { container: string; index: number }): TierListState {
  s.pool = s.pool.filter((id) => id !== itemId);
  for (const t of s.tiers) t.items = t.items.filter((id) => id !== itemId);
  const dest = to.container === "pool" ? s.pool : s.tiers.find((t) => t.id === to.container)?.items;
  if (dest) dest.splice(Math.max(0, Math.min(dest.length, to.index)), 0, itemId);
  return s;
}

export default function TierBoard({ roomId }: { roomId: string }) {
  const { user } = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  const {
    room, state, presence, error, connected,
    cursors, remoteDrags, chat, sendOp, emit, emitVolatile, sendChat, onOpError,
  } = useRoom<TierListState, TierlistOp>(roomId, user);

  useEffect(() => onOpError(toast), [onOpError, toast]);

  const isOwner = room?.owner_id === user.id;
  const boardRef = useRef<HTMLDivElement>(null);
  const containersRef = useRef(new Map<string, HTMLElement>());
  const ghostRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [editingTier, setEditingTier] = useState<Tier | null>(null);
  const [downloading, setDownloading] = useState(false);

  // itemId -> user currently holding it remotely (soft lock)
  const heldBy = useMemo(() => {
    const map: Record<string, User> = {};
    for (const d of Object.values(remoteDrags)) map[d.itemId] = d.user;
    return map;
  }, [remoteDrags]);

  const registerContainer = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) containersRef.current.set(id, el);
    else containersRef.current.delete(id);
  }, []);

  const boardPoint = (clientX: number, clientY: number) => {
    const rect = boardRef.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: 0, y: 0 };
  };

  // ---- cursor broadcasting (always on, throttled) ----
  const lastCursorSent = useRef(0);
  const onBoardPointerMove = (e: React.PointerEvent) => {
    const now = performance.now();
    if (now - lastCursorSent.current < 40) return;
    lastCursorSent.current = now;
    emitVolatile("cursor", boardPoint(e.clientX, e.clientY));
  };

  // ---- drag engine ----
  const computeOver = (clientX: number, clientY: number): DragState["over"] => {
    for (const [containerId, el] of containersRef.current) {
      const rect = el.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue;
      const itemEls = el.querySelectorAll<HTMLElement>("[data-item-id]");
      let index = 0;
      for (const itemEl of itemEls) {
        const r = itemEl.getBoundingClientRect();
        const before =
          r.bottom < clientY ||
          (clientY >= r.top && clientY <= r.bottom && r.left + r.width / 2 <= clientX);
        if (before) index++;
      }
      return { container: containerId, index };
    }
    return null;
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
        const init = { itemId, over: computeOver(ev.clientX, ev.clientY) };
        dragRef.current = init;
        setDrag(init);
        emit("drag:start", { itemId });
      }
      // ghost follows pointer imperatively (no re-render per pixel)
      if (ghostRef.current) {
        ghostRef.current.style.left = `${ev.clientX}px`;
        ghostRef.current.style.top = `${ev.clientY}px`;
      }
      const over = computeOver(ev.clientX, ev.clientY);
      const prev = dragRef.current?.over;
      if (over?.container !== prev?.container || over?.index !== prev?.index) {
        const next = { itemId, over };
        dragRef.current = next;
        setDrag(next);
      }
      const now = performance.now();
      if (now - lastBroadcast > 40) {
        lastBroadcast = now;
        emitVolatile("drag:move", boardPoint(ev.clientX, ev.clientY));
      }
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      document.body.style.userSelect = "";
      if (started) {
        const over = dragRef.current?.over;
        if (over) {
          sendOp(
            { type: "moveItem", itemId, to: over },
            (s) => applyMoveLocal(s, itemId, over)
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

  // ---- room-level errors (deleted / locked / gone) ----
  if (error) {
    return (
      <div className="roomerror">
        <h2>{error.code === "deleted" ? "room nuked" : "can't get in"}</h2>
        <p>{error.message}</p>
        <Link className="btn" to="/g/tierlist">back to rooms</Link>
      </div>
    );
  }

  if (!room || !state) {
    return <div className="roomerror"><p>connecting…</p></div>;
  }

  const draggedItem = drag ? state.media[drag.itemId] : null;

  const renderItems = (containerId: string, ids: string[]) => {
    const visible = drag ? ids.filter((id) => id !== drag.itemId) : ids;
    const out: React.ReactNode[] = [];
    visible.forEach((id, i) => {
      if (drag?.over?.container === containerId && drag.over.index === i) {
        out.push(<div key="__ph" className="placeholder" />);
      }
      const item = state.media[id];
      if (!item) return;
      const holder = heldBy[id];
      out.push(
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
    });
    if (drag?.over?.container === containerId && drag.over.index >= visible.length) {
      out.push(<div key="__ph" className="placeholder" />);
    }
    return out;
  };

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast(`${label} copied — send it to the group chat`),
      () => toast(text)
    );
  };
  const copyCode = () => copy(roomId, "room code");
  const copyInvite = () => copy(`${location.origin}/room/${roomId}`, "invite link");

  const deleteRoom = async () => {
    if (!confirm("nuke this room for everyone? there's no undo.")) return;
    try {
      await api(`/api/rooms/${roomId}`, { method: "DELETE", body: JSON.stringify({ userId: user.id }) });
      navigate("/g/tierlist");
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

  const totalItems = Object.keys(state.media).length;

  return (
    <main className="room">
      <div className="roombar">
        <Link to="/g/tierlist" className="btn btn--ghost btn--sm" title="back to room list">←</Link>
        <input
          className="roombar__name"
          defaultValue={room.name}
          key={room.name}
          disabled={!isOwner}
          maxLength={60}
          onBlur={(e) => isOwner && e.target.value.trim() && e.target.value !== room.name && emit("room:rename", e.target.value.trim())}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        <button className="roombar__code" onClick={copyCode} title="copy room code">
          {roomId} ⧉
        </button>
        <button className="btn btn--ghost btn--sm" onClick={copyInvite} title="copy a clickable invite link">
          copy link
        </button>
        <button className="btn btn--ghost btn--sm" onClick={downloadImage} disabled={downloading} title="download this board as an image">
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
        <div className="board" ref={boardRef}>
          {state.tiers.map((tier, ti) => (
            <div key={tier.id} className="tier-row" ref={registerContainer(tier.id)}>
              <div className="tier-row__label" style={{ background: tier.color }}>
                {tier.label}
              </div>
              <div className={`tier-row__items ${drag?.over?.container === tier.id ? "droptarget" : ""}`} data-items>
                {renderItems(tier.id, tier.items)}
              </div>
              <div className="tier-row__tools">
                <button title="edit tier" onClick={() => setEditingTier(tier)}>✎</button>
                <button title="move up" disabled={ti === 0} onClick={() => sendOp({ type: "moveTier", tierId: tier.id, dir: "up" })}>↑</button>
                <button title="move down" disabled={ti === state.tiers.length - 1} onClick={() => sendOp({ type: "moveTier", tierId: tier.id, dir: "down" })}>↓</button>
                <button title="delete tier (items go back to the pool)" onClick={() => sendOp({ type: "removeTier", tierId: tier.id })}>✕</button>
              </div>
            </div>
          ))}

          <button className="addtier" onClick={() => sendOp({ type: "addTier", afterTierId: state.tiers[state.tiers.length - 1]?.id })}>
            + add tier
          </button>

          <div className="pool" ref={registerContainer("pool")}>
            <span className="pool__label sticker sticker--blue">the pile · {state.pool.length}</span>
            <div className={`tier-row__items ${drag?.over?.container === "pool" ? "droptarget" : ""}`} data-items>
              {totalItems === 0 ? (
                <div className="pool__empty">
                  the pile is empty, and so is your ranking of anything. add images below ↓ — search anime, upload memes, paste URLs — then drag them into tiers like the judgmental gremlin you are.
                </div>
              ) : (
                renderItems("pool", state.pool)
              )}
            </div>
          </div>

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

      {editingTier && (
        <TierEditModal
          tier={state.tiers.find((t) => t.id === editingTier.id) ?? editingTier}
          onClose={() => setEditingTier(null)}
          onSave={(label, color) => {
            sendOp({ type: "updateTier", tierId: editingTier.id, label, color });
            setEditingTier(null);
          }}
        />
      )}

      <ChatPanel messages={chat} onSend={sendChat} currentUserId={user.id} />
    </main>
  );
}

function TierEditModal({
  tier,
  onClose,
  onSave,
}: {
  tier: Tier;
  onClose: () => void;
  onSave: (label: string, color: string) => void;
}) {
  const [label, setLabel] = useState(tier.label);
  const [color, setColor] = useState(tier.color);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSave(label.trim() || tier.label, color);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal__close" onClick={onClose}>×</button>
        <div className="modal__title">edit tier</div>
        <form onSubmit={submit}>
          <div className="modal__row">
            <label className="label">label</label>
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={24} autoFocus />
          </div>
          <div className="modal__row">
            <label className="label">color</label>
            <div className="colorpick">
              {TIER_COLORS.map((c) => (
                <button key={c} type="button" className={c === color ? "on" : ""} style={{ background: c }} onClick={() => setColor(c)} />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                style={{ width: 30, height: 30, border: "none", background: "none", cursor: "pointer" }}
                title="custom color"
              />
            </div>
          </div>
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>cancel</button>
            <button className="btn" type="submit">save</button>
          </div>
        </form>
      </div>
    </div>
  );
}
