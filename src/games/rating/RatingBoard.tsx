import { FormEvent, useMemo, useRef, useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { AniListUser, MediaItem, RatingItem, RatingOp, RatingState } from "../../types";
import { useRoom } from "../../lib/useRoom";
import { useUser } from "../../App";
import { useToast } from "../../components/Toasts";
import { api } from "../../lib/api";
import CursorLayer from "../shared/CursorLayer";
import ChatPanel from "../shared/ChatPanel";
import { downloadElementAsImage } from "../../lib/downloadImage";

function avgScore(votes: Record<string, number>): number {
  const vals = Object.values(votes);
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// up to two decimals, trailing zeros trimmed — 8.4 not 8.40, 8.37 stays 8.37
function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export default function RatingBoard({ roomId }: { roomId: string }) {
  const { user } = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  const {
    room, state, presence, error, connected,
    cursors, remoteDrags, chat, sendOp, emit, emitVolatile, sendChat, onOpError,
  } = useRoom<RatingState, RatingOp>(roomId, user);

  useEffect(() => onOpError(toast), [onOpError, toast]);

  const isOwner = room?.owner_id === user.id;
  const boardRef = useRef<HTMLDivElement>(null);
  const axisRef = useRef<HTMLDivElement>(null);
  const [votingOn, setVotingOn] = useState<RatingItem | null>(null);
  const [downloading, setDownloading] = useState(false);

  const lastCursorSent = useRef(0);
  const onBoardPointerMove = (e: React.PointerEvent) => {
    const now = performance.now();
    if (now - lastCursorSent.current < 40) return;
    lastCursorSent.current = now;
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;
    emitVolatile("cursor", { x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  // derived views — computed before any early return would be fine too, but
  // hooks must stay unconditional so keep them above the error/loading returns
  const derived = useMemo(() => {
    if (!state) return null;
    const items = Object.values(state.items);
    const participants = state.participants;
    const revealed: { item: RatingItem; avg: number; votes: Record<string, number> }[] = [];
    const myQueue: RatingItem[] = [];
    const waiting: { item: RatingItem; missing: string[] }[] = [];
    for (const item of items) {
      const votes = state.votes[item.id] || {};
      const mine = votes[user.id];
      if (mine === undefined) {
        myQueue.push(item);
        continue;
      }
      const missing = participants.filter((p) => votes[p] === undefined);
      if (participants.length > 0 && missing.length === 0) {
        revealed.push({ item, avg: avgScore(votes), votes });
      } else {
        waiting.push({ item, missing });
      }
    }
    revealed.sort((a, b) => b.avg - a.avg);
    myQueue.sort((a, b) => a.title.localeCompare(b.title));
    return { revealed, myQueue, waiting };
  }, [state, user.id]);

  if (error) {
    return (
      <div className="roomerror">
        <h2>{error.code === "deleted" ? "room nuked" : "can't get in"}</h2>
        <p>{error.message}</p>
        <Link className="btn" to="/g/rating">back to rooms</Link>
      </div>
    );
  }
  if (!room || !state || !derived) {
    return <div className="roomerror"><p>connecting…</p></div>;
  }

  const nickOf = (userId: string) =>
    presence.find((p) => p.id === userId)?.nick || state.names[userId] || "someone";

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
      navigate("/g/rating");
    } catch (err: any) {
      toast(err.message);
    }
  };

  const downloadImage = async () => {
    if (!axisRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadElementAsImage(axisRef.current, `${room.name}-ratings`);
    } catch (err: any) {
      toast(`couldn't generate the image: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="room">
      <div className="roombar">
        <Link to="/g/rating" className="btn btn--ghost btn--sm" title="back to room list">←</Link>
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
        <button className="btn btn--ghost btn--sm" onClick={downloadImage} disabled={downloading} title="download the shared scale as an image">
          {downloading ? "…" : "⬇ save image"}
        </button>
        {isOwner && (
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => sendOp({ type: "setAxis", axis: state.axis === "y" ? "x" : "y" })}
            title="flip between vertical and horizontal scale"
          >
            axis: {state.axis === "y" ? "vertical" : "horizontal"}
          </button>
        )}
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
        <div className="board rating-board" ref={boardRef}>
          <AddPanel roomId={roomId} state={state} sendOp={sendOp} />

          <div className="rating-columns">
            <section className="rating-axis-wrap" ref={axisRef}>
              <h3 className="rating-heading">
                the verdict · {derived.revealed.length} revealed
                {state.participants.length > 0 && (
                  <span className="hint"> — needs all {state.participants.length} rater{state.participants.length === 1 ? "" : "s"}, no cowards</span>
                )}
              </h3>
              {state.participants.length > 0 && (
                <div className="rating-raters no-export">
                  <span className="hint">raters:</span>
                  {state.participants.map((pid) => (
                    <span key={pid} className="rating-rater">
                      {nickOf(pid)}
                      {isOwner && pid !== user.id && (
                        <button
                          title="stop requiring their vote for reveals (their cast votes stay)"
                          onClick={() => confirm(`stop waiting on ${nickOf(pid)}? items won't need their vote anymore.`) && sendOp({ type: "removeParticipant", userId: pid })}
                        >
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
              <ScaleAxis
                axis={state.axis}
                revealed={derived.revealed}
                nickOf={nickOf}
                isOwner={isOwner}
                onRemove={(itemId) => sendOp({ type: "removeItem", itemId })}
                onEdit={(item) => setVotingOn(item)}
              />
            </section>

            <aside className="rating-side">
              <section>
                <h3 className="rating-heading">needs your vote · {derived.myQueue.length}</h3>
                <div className="rating-queue">
                  {derived.myQueue.length === 0 ? (
                    <div className="pool__empty">nothing waiting on you, suspicious. add more anime above and get back to judging.</div>
                  ) : (
                    derived.myQueue.map((item) => (
                      <button key={item.id} className="rating-card" onClick={() => setVotingOn(item)} title={`rate "${item.title}"`}>
                        <img src={item.image_url} alt={item.title} loading="lazy" />
                        <span className="rating-card__name">{item.title}</span>
                      </button>
                    ))
                  )}
                </div>
              </section>

              {derived.waiting.length > 0 && (
                <section>
                  <h3 className="rating-heading">waiting on others · {derived.waiting.length}</h3>
                  <div className="rating-waitlist">
                    {derived.waiting.map(({ item, missing }) => (
                      <button key={item.id} className="rating-waitrow" onClick={() => setVotingOn(item)} title="click to change your vote">
                        <img src={item.image_url} alt="" loading="lazy" />
                        <span className="rating-waitrow__title">{item.title}</span>
                        <span className="rating-waitrow__missing">
                          {missing.length === 0 ? "…" : `waiting on ${missing.map(nickOf).join(", ")}`}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            </aside>
          </div>

          <CursorLayer cursors={cursors} drags={remoteDrags} media={{}} />
        </div>
      </div>

      {votingOn && (
        <VoteModal
          item={votingOn}
          current={state.votes[votingOn.id]?.[user.id]}
          onClose={() => setVotingOn(null)}
          onSave={(score) => {
            sendOp({ type: "vote", itemId: votingOn.id, score });
            setVotingOn(null);
          }}
        />
      )}

      <ChatPanel messages={chat} onSend={sendChat} currentUserId={user.id} />
    </main>
  );
}

function AddPanel({
  roomId,
  state,
  sendOp,
}: {
  roomId: string;
  state: RatingState;
  sendOp: (op: RatingOp) => void;
}) {
  const { user } = useUser();
  const toast = useToast();
  const [anilistUser, setAnilistUser] = useState("");
  const [importing, setImporting] = useState(false);
  const [matches, setMatches] = useState<AniListUser[] | null>(null);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MediaItem[]>([]);
  const [searching, setSearching] = useState(false);

  const findUsers = async (e: FormEvent) => {
    e.preventDefault();
    if (!anilistUser.trim()) return;
    setSearchingUsers(true);
    setMatches(null);
    try {
      const d = await api<{ users: AniListUser[] }>(`/api/search/anilist-users?q=${encodeURIComponent(anilistUser.trim())}`);
      if (!d.users.length) {
        toast(`no AniList user matches "${anilistUser.trim()}"`);
      } else {
        setMatches(d.users);
      }
    } catch (err: any) {
      toast(err.message);
    } finally {
      setSearchingUsers(false);
    }
  };

  const importFrom = async (name: string) => {
    setImporting(true);
    try {
      const r = await api<{ added: number; scored: number; skipped: number }>(`/api/rooms/${roomId}/rating/import`, {
        method: "POST",
        body: JSON.stringify({ userId: user.id, nick: user.nick, anilistUser: name }),
      });
      toast(`imported ${r.added} anime, ${r.scored} of your scores${r.skipped ? ` (${r.skipped} skipped — board full)` : ""}`);
      setAnilistUser("");
      setMatches(null);
    } catch (err: any) {
      toast(err.message);
    } finally {
      setImporting(false);
    }
  };

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setSearching(true);
    try {
      const d = await api<{ items: MediaItem[] }>(`/api/search/anime?q=${encodeURIComponent(q.trim())}`);
      setResults(d.items);
      if (!d.items.length) toast("nothing found. spell it right maybe?");
    } catch (err: any) {
      toast(err.message);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="rating-addpanel">
      <form className="rating-import" onSubmit={findUsers}>
        <label className="label">import your AniList (adds the anime + your scores)</label>
        <div className="drawer__search">
          <input
            className="input"
            value={anilistUser}
            onChange={(e) => { setAnilistUser(e.target.value); setMatches(null); }}
            placeholder="your AniList username"
            maxLength={40}
          />
          <button className="btn btn--sm" type="submit" disabled={searchingUsers || importing}>
            {searchingUsers ? "…" : "find"}
          </button>
        </div>
        <p className="hint">
          MAL isn't importable by username anymore — they killed the public list API right as we needed it, deeply personal. AniList only; you can mirror your MAL list over to AniList and import that instead.
        </p>
        {matches && (
          <div className="rating-userpicker">
            <span className="hint">that you? pick the right one — usernames aren't unique:</span>
            <div className="rating-userlist">
              {matches.map((u) => (
                <button key={u.id} className="rating-userrow" disabled={importing} onClick={() => importFrom(u.name)} title={`import ${u.name}'s list`}>
                  {u.avatar ? <img src={u.avatar} alt="" /> : <span className="rating-userrow__noavatar">?</span>}
                  <span>{u.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </form>

      <form className="rating-search" onSubmit={search}>
        <label className="label">or add one at a time</label>
        <div className="drawer__search">
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="search anime (via AniList)" />
          <button className="btn btn--sm" type="submit" disabled={searching}>
            {searching ? "…" : "search"}
          </button>
        </div>
        {results.length > 0 && (
          <div className="results">
            {results.map((r) => {
              const added = !!state.items[r.id];
              return (
                <button
                  key={r.id}
                  className={`result ${added ? "result--added" : ""}`}
                  title={`add "${r.title}"`}
                  onClick={() => !added && sendOp({ type: "addItems", items: [{ id: r.id, title: r.title, image_url: r.image_url, subtitle: r.subtitle }] })}
                >
                  <img src={r.image_url} alt={r.title} loading="lazy" />
                  <span className="result__name">{r.title}</span>
                </button>
              );
            })}
          </div>
        )}
      </form>
    </div>
  );
}

function ScaleAxis({
  axis,
  revealed,
  nickOf,
  isOwner,
  onRemove,
  onEdit,
}: {
  axis: "x" | "y";
  revealed: { item: RatingItem; avg: number; votes: Record<string, number> }[];
  nickOf: (id: string) => string;
  isOwner: boolean;
  onRemove: (itemId: string) => void;
  onEdit: (item: RatingItem) => void;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [crossSize, setCrossSize] = useState(700);

  // cross-axis = the dimension perpendicular to the score line (width for a
  // vertical scale, height for a horizontal one) — that's what bounds how many
  // tied items can sit side by side before they'd run off the edge
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setCrossSize(axis === "y" ? el.clientWidth : el.clientHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [axis]);

  const ITEM_PITCH = 60; // dot width (52px) + gap
  const maxCols = Math.max(1, Math.floor((crossSize - 70) / ITEM_PITCH));

  // collision handling: greedy lane assignment. sorted by score, each item
  // takes the first lane whose previous occupant is far enough away in score
  // units that the covers can't overlap (~0.75 points of clearance on a
  // 760px-tall axis). identical scores stack into parallel lanes, and once a
  // "row" of lanes fills the container's cross-size, ties wrap into a new row
  // nudged along the score axis instead of running off the edge
  const placed = useMemo(() => {
    const MIN_GAP = 0.78;
    const sorted = [...revealed].sort((a, b) => b.avg - a.avg);
    const lanes: number[] = []; // last score placed in each lane
    return sorted.map((r) => {
      let lane = lanes.findIndex((last) => last - r.avg >= MIN_GAP);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push(r.avg);
      } else {
        lanes[lane] = r.avg;
      }
      const row = Math.floor(lane / maxCols);
      const col = lane % maxCols;
      return { ...r, crossPx: 64 + col * ITEM_PITCH, alongNudgePx: row * 54 };
    });
  }, [revealed, maxCols]);

  const ticks = Array.from({ length: 11 }, (_, i) => i);

  if (revealed.length === 0) {
    return (
      <div className="pool__empty" style={{ padding: "60px 20px" }}>
        nothing revealed yet — an anime shows up here once EVERYONE who's voting has scored it. democracy is slow.
      </div>
    );
  }

  return (
    <div className={`rating-axis rating-axis--${axis}`} ref={containerRef}>
      <div className="rating-axis__line" />
      {ticks.map((t) => (
        <div
          key={t}
          className="rating-axis__tick"
          style={axis === "y" ? { top: `${(1 - t / 10) * 100}%` } : { left: `${(t / 10) * 100}%` }}
        >
          <span>{t}</span>
        </div>
      ))}
      {placed.map(({ item, avg, votes, crossPx, alongNudgePx }) => {
        const pos = axis === "y"
          ? { top: `calc(${(1 - avg / 10) * 100}% + ${alongNudgePx}px)`, left: `${crossPx}px` }
          : { left: `calc(${(avg / 10) * 100}% + ${alongNudgePx}px)`, top: `${crossPx}px` };
        return (
          <div
            key={item.id}
            className="rating-dot"
            style={pos}
            onPointerEnter={() => setHovered(item.id)}
            onPointerLeave={() => setHovered((h) => (h === item.id ? null : h))}
            onClick={() => onEdit(item)}
            title="click to edit your vote"
          >
            <img src={item.image_url} alt={item.title} loading="lazy" />
            <span className="rating-dot__avg">{avg.toFixed(1)}</span>
            {hovered === item.id && (
              <div className="rating-tooltip">
                <div className="rating-tooltip__title">{item.title}</div>
                {Object.entries(votes)
                  .sort((a, b) => b[1] - a[1])
                  .map(([uid, score]) => (
                    <div key={uid} className="rating-tooltip__row">
                      <span>{nickOf(uid)}</span>
                      <strong>{fmt(score)}</strong>
                    </div>
                  ))}
                <div className="rating-tooltip__row rating-tooltip__row--avg">
                  <span>average</span>
                  <strong>{avg.toFixed(2)}</strong>
                </div>
                {isOwner && (
                  <button
                    className="btn btn--danger btn--sm no-export"
                    style={{ marginTop: 6 }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
                  >
                    remove
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function VoteModal({
  item,
  current,
  onClose,
  onSave,
}: {
  item: RatingItem;
  current: number | undefined;
  onClose: () => void;
  onSave: (score: number | null) => void;
}) {
  const [score, setScore] = useState<string>(current !== undefined ? String(current) : "7.0");

  const parsed = Number(score);
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 10;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    onSave(Math.round(parsed * 100) / 100);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal__close" onClick={onClose}>×</button>
        <div className="rating-votehead">
          <img src={item.image_url} alt="" />
          <div>
            <div className="modal__title" style={{ marginBottom: 4 }}>{item.title}</div>
            <div className="hint">{item.subtitle}</div>
          </div>
        </div>
        <form onSubmit={submit}>
          <div className="modal__row rating-voterow">
            <input
              type="range"
              min={0}
              max={10}
              step={0.1}
              value={valid ? parsed : 7}
              onChange={(e) => setScore(e.target.value)}
              className="rating-slider"
            />
            <input
              className="input rating-scoreinput"
              inputMode="decimal"
              value={score}
              onChange={(e) => setScore(e.target.value.replace(",", "."))}
              maxLength={4}
              autoFocus
            />
          </div>
          <div className="modal__actions">
            {current !== undefined && (
              <button type="button" className="btn btn--ghost" onClick={() => onSave(null)}>
                clear my vote
              </button>
            )}
            <button className="btn" type="submit" disabled={!valid}>
              {current !== undefined ? "update" : "cast"} vote{valid ? ` · ${fmt(Math.round(parsed * 100) / 100)}` : ""}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
