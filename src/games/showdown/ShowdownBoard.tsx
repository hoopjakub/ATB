import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ShowdownEntry, ShowdownOp, ShowdownState } from "../../types";
import { useRoom } from "../../lib/useRoom";
import { useUser } from "../../App";
import { useToast } from "../../components/Toasts";
import { api, ApiError } from "../../lib/api";
import CursorLayer from "../shared/CursorLayer";
import ChatPanel from "../shared/ChatPanel";
import { downloadElementAsImage } from "../../lib/downloadImage";
import { contentTypeLabel, currentMatch, derivePlacements, roundName, roundPairs } from "./derive";

function youtubeEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    let id = "";
    if (u.hostname.includes("youtu.be")) id = u.pathname.slice(1);
    else if (u.searchParams.get("v")) id = u.searchParams.get("v")!;
    else if (u.pathname.includes("/embed/")) id = u.pathname.split("/embed/")[1];
    return id ? `https://www.youtube.com/embed/${id}?rel=0` : null;
  } catch {
    return null;
  }
}

const MAX_MEDIA_RETRIES = 3;
const RETRY_DELAYS_MS = [800, 2000, 4000];
const AUDIO_ONLY_KEY = "atb:showdownAudioOnly";

// AnimeThemes' CDN occasionally 503s a request — a plain <video>/<audio> that
// hits this on its very first byte just sits broken forever (browsers don't
// retry a failed media fetch on their own), while one that happened to
// succeed keeps playing fine regardless of any later blips. Force a fresh
// attempt (remount via `key`) a few times before giving up and offering a
// manual retry. Same fix covers both hosts (v.animethemes.moe video files and
// a.animethemes.moe audio-only rips) since it's the same underlying issue.
function RetryMedia({ src, kind }: { src: string; kind: "video" | "audio" }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(retryTimer.current), []);
  useEffect(() => {
    setAttempt(0);
    setFailed(false);
  }, [src]);

  const handleError = () => {
    if (attempt < MAX_MEDIA_RETRIES) {
      retryTimer.current = setTimeout(() => setAttempt((a) => a + 1), RETRY_DELAYS_MS[attempt] ?? 4000);
    } else {
      setFailed(true);
    }
  };

  if (failed) {
    return (
      <div className="showdown-nofile">
        <div className="showdown-nofile__title">the archive host is having trouble right now</div>
        <button
          className="btn btn--sm"
          style={{ marginTop: 8 }}
          onClick={() => {
            setFailed(false);
            setAttempt(0);
          }}
        >
          retry
        </button>
      </div>
    );
  }

  if (kind === "audio") {
    return (
      <div className="showdown-audioplayer">
        <div className="showdown-audioplayer__icon">🎧</div>
        <audio key={attempt} src={src} controls preload="metadata" className="showdown-audio" onError={handleError} />
      </div>
    );
  }

  return (
    <video
      key={attempt}
      src={src}
      controls
      playsInline
      preload="metadata"
      className="showdown-video"
      onError={handleError}
    />
  );
}

function EntryMedia({ entry, audioOnly }: { entry: ShowdownEntry; audioOnly: boolean }) {
  if (entry.kind === "file" && entry.videoUrl) {
    if (audioOnly && entry.audioUrl) return <RetryMedia src={entry.audioUrl} kind="audio" />;
    return <RetryMedia src={entry.videoUrl} kind="video" />;
  }
  if (entry.kind === "youtube" && entry.videoUrl) {
    const embed = youtubeEmbed(entry.videoUrl);
    if (embed) {
      return (
        <iframe
          className="showdown-video"
          src={embed}
          title={entry.title}
          allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      );
    }
    return (
      <a className="showdown-nofile" href={entry.videoUrl} target="_blank" rel="noreferrer">
        watch on YouTube ↗
      </a>
    );
  }
  return (
    <div className="showdown-nofile">
      <div className="showdown-nofile__title">{entry.title}</div>
      <div className="showdown-nofile__sub">no video found — vote on vibes</div>
    </div>
  );
}

export default function ShowdownBoard({ roomId }: { roomId: string }) {
  const { user } = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  const {
    room, state, presence, error, connected,
    cursors, remoteDrags, chat, sendOp, emit, emitVolatile, sendChat, onOpError,
  } = useRoom<ShowdownState, ShowdownOp>(roomId, user);

  useEffect(() => onOpError(toast), [onOpError, toast]);

  const isOwner = room?.owner_id === user.id;
  const boardRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const lastTieMessage = useRef<string | null>(null);
  const [audioOnly, setAudioOnly] = useState(() => localStorage.getItem(AUDIO_ONLY_KEY) === "1");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    localStorage.setItem(AUDIO_ONLY_KEY, audioOnly ? "1" : "0");
  }, [audioOnly]);

  useEffect(() => {
    if (state?.tieMessage && state.tieMessage !== lastTieMessage.current) {
      toast(state.tieMessage);
    }
    lastTieMessage.current = state?.tieMessage ?? null;
  }, [state?.tieMessage, toast]);

  const lastCursorSent = useRef(0);
  const onBoardPointerMove = (e: React.PointerEvent) => {
    const now = performance.now();
    if (now - lastCursorSent.current < 40) return;
    lastCursorSent.current = now;
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;
    emitVolatile("cursor", { x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  if (error) {
    return (
      <div className="roomerror">
        <h2>{error.code === "deleted" ? "room nuked" : "can't get in"}</h2>
        <p>{error.message}</p>
        <Link className="btn" to="/g/showdown">back to rooms</Link>
      </div>
    );
  }
  if (!room || !state) {
    return <div className="roomerror"><p>connecting…</p></div>;
  }

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
      navigate("/g/showdown");
    } catch (err: any) {
      toast(err.message);
    }
  };

  const downloadResults = async () => {
    if (!resultsRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadElementAsImage(resultsRef.current, `${room.name}-results`);
    } catch (err: any) {
      toast(`couldn't generate the image: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="room">
      <div className="roombar">
        <Link to="/g/showdown" className="btn btn--ghost btn--sm" title="back to room list">←</Link>
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
        {state.status === "complete" && (
          <button className="btn btn--ghost btn--sm" onClick={downloadResults} disabled={downloading} title="download the results as an image">
            {downloading ? "…" : "⬇ save results"}
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
        <div className="board showdown-board" ref={boardRef}>
          {state.status === "seeding" && (
            <SeedingView state={state} isOwner={isOwner} roomId={roomId} sendOp={sendOp} />
          )}
          {state.status === "in_progress" && (
            <MatchView
              state={state}
              presence={presence}
              userId={user.id}
              isOwner={isOwner}
              sendOp={sendOp}
              audioOnly={audioOnly}
              setAudioOnly={setAudioOnly}
            />
          )}
          {state.status === "complete" && (
            <ResultsView state={state} isOwner={isOwner} sendOp={sendOp} resultsRef={resultsRef} />
          )}
          <CursorLayer cursors={cursors} drags={remoteDrags} media={{}} />
        </div>
      </div>

      <ChatPanel messages={chat} onSend={sendChat} currentUserId={user.id} />
    </main>
  );
}

function SeedingView({
  state,
  isOwner,
  roomId,
  sendOp,
}: {
  state: ShowdownState;
  isOwner: boolean;
  roomId: string;
  sendOp: (op: ShowdownOp, optimistic?: (s: ShowdownState) => ShowdownState) => void;
}) {
  const toast = useToast();
  const { user } = useUser();
  const [autofilling, setAutofilling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [animeTitle, setAnimeTitle] = useState("");

  const entries = Object.values(state.entries);
  const full = entries.length >= state.size;
  // rough estimate from observed timings (~0.5s/entry once the shared per-name
  // cache is warm; a fully cold run can run a bit longer for large brackets)
  const estimateSeconds = Math.round(state.size * 0.5);

  useEffect(() => {
    if (!autofilling) return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, [autofilling]);

  const autofill = async () => {
    setAutofilling(true);
    try {
      await api(`/api/rooms/${roomId}/showdown/autofill`, {
        method: "POST",
        body: JSON.stringify({ userId: user.id }),
      });
      toast(`pulled ${state.size} popular anime + their ${contentTypeLabel(state.contentType)}`);
    } catch (err: any) {
      toast(err instanceof ApiError ? err.message : "autofill failed");
    } finally {
      setAutofilling(false);
    }
  };

  const addManual = (e: FormEvent) => {
    e.preventDefault();
    if (!url.trim() && !title.trim()) return;
    sendOp({
      type: "addEntries",
      entries: [{ title: title.trim() || "untitled", animeTitle: animeTitle.trim(), videoUrl: url.trim() || undefined }],
    });
    setUrl("");
    setTitle("");
    setAnimeTitle("");
  };

  return (
    <div className="showdown-seed">
      <div className="showdown-seed__head">
        <h2>
          building the bracket · {entries.length} / {state.size}
        </h2>
        <p className="hint">
          {contentTypeLabel(state.contentType)} tournament — {state.size} entries needed before
          anyone can hit start. yes, all of them. no skipping to the good part.
        </p>
      </div>

      {isOwner && (
        <div className="showdown-seed__tools">
          <div>
            <button className="btn" onClick={autofill} disabled={autofilling || full}>
              {autofilling ? `pulling from AniList + AnimeThemes… ${elapsed}s` : `auto-fill top ${state.size} popular anime`}
            </button>
            {!autofilling && (
              <p className="hint" style={{ marginTop: 6 }}>
                usually takes around ~{estimateSeconds}s for a bracket this size — bigger brackets take longer, it's
                pulling real data per anime, not vibes. go make a sandwich.
              </p>
            )}
          </div>
          {entries.length > 0 && (
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => confirm("clear all entries and start over?") && entries.forEach((en) => sendOp({ type: "removeEntry", entryId: en.id }))}
            >
              clear all
            </button>
          )}
        </div>
      )}

      {isOwner && (
        <form className="showdown-seed__manual" onSubmit={addManual}>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="theme title (e.g. OP1 · R★O★C★K★S)" maxLength={200} />
          <input className="input" value={animeTitle} onChange={(e) => setAnimeTitle(e.target.value)} placeholder="anime title" maxLength={200} />
          <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="video URL (YouTube link, or .webm/.mp4 — optional)" />
          <button className="btn btn--sm" type="submit" disabled={full}>add manually</button>
        </form>
      )}

      <div className="showdown-entrylist">
        {entries.length === 0 ? (
          <div className="pool__empty">no entries yet, the bracket is a void. {isOwner ? "hit auto-fill above, or add some manually." : "waiting on the room owner to get their act together."}</div>
        ) : (
          entries.map((en) => (
            <div key={en.id} className="showdown-entryrow">
              <span className={`showdown-kind showdown-kind--${en.kind}`}>{en.kind === "none" ? "no video" : en.kind}</span>
              <div className="showdown-entryrow__text">
                <div className="showdown-entryrow__title">{en.title}</div>
                <div className="showdown-entryrow__sub">{en.animeTitle}{en.subtitle ? ` · ${en.subtitle}` : ""}</div>
              </div>
              {isOwner && (
                <button className="btn btn--ghost btn--sm" onClick={() => sendOp({ type: "removeEntry", entryId: en.id })}>
                  remove
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {isOwner && (
        <button className="btn btn--pink showdown-start" disabled={!full} onClick={() => sendOp({ type: "startTournament" })}>
          {full ? `start the ${state.size}-way showdown →` : `need ${state.size - entries.length} more`}
        </button>
      )}
    </div>
  );
}

function MatchView({
  state,
  presence,
  userId,
  isOwner,
  sendOp,
  audioOnly,
  setAudioOnly,
}: {
  state: ShowdownState;
  presence: { id: string; nick: string }[];
  userId: string;
  isOwner: boolean;
  sendOp: (op: ShowdownOp, optimistic?: (s: ShowdownState) => ShowdownState) => void;
  audioOnly: boolean;
  setAudioOnly: (v: boolean) => void;
}) {
  const match = currentMatch(state);
  const pairs = roundPairs(state, state.round);
  const myVote = state.votes[userId];
  const voted = presence.filter((p) => state.votes[p.id]);
  const waiting = presence.filter((p) => !state.votes[p.id]);

  const vote = (side: "left" | "right") => {
    if (myVote) return;
    sendOp({ type: "vote", side }, (s) => {
      s.votes = { ...s.votes, [userId]: side };
      return s;
    });
  };

  if (!match) {
    return <div className="roomerror"><p>waiting for the next matchup…</p></div>;
  }
  const [leftId, rightId] = match;
  const left = state.entries[leftId];
  const right = state.entries[rightId];

  return (
    <div className="showdown-match">
      <div className="showdown-match__head">
        <span className="sticker sticker--acid">{roundName(state.round, state.size)}</span>
        <span className="hint">match {state.matchIndex + 1} / {pairs.length}</span>
        <span className="hint">{voted.length}/{presence.length} voted{waiting.length > 0 && waiting.length <= 4 ? ` — waiting on ${waiting.map((w) => w.nick).join(", ")}` : ""}</span>
        {isOwner && (
          <div className="showdown-match__owner">
            <button className="btn btn--ghost btn--sm" disabled={state.history.length === 0} onClick={() => sendOp({ type: "stepBack" })}>
              ↺ step back
            </button>
            <button className="btn btn--ghost btn--sm" onClick={() => confirm("reset the whole bracket back to round 1?") && sendOp({ type: "reset" })}>
              reset
            </button>
          </div>
        )}
      </div>

      {(left?.audioUrl || right?.audioUrl) && (
        <div className="showdown-mediatoggle">
          <div className="seg">
            <button type="button" className={!audioOnly ? "on" : ""} onClick={() => setAudioOnly(false)}>
              🎬 video
            </button>
            <button type="button" className={audioOnly ? "on" : ""} onClick={() => setAudioOnly(true)}>
              🎧 audio only — faster on slow wifi
            </button>
          </div>
        </div>
      )}

      {(left?.kind === "file" || right?.kind === "file") && (
        <p className="hint showdown-match__videohint">
          {audioOnly
            ? "audio-only mode — much smaller files, should load fast even on your cursed dorm wifi."
            : "videos stream from a third-party archive — first play can take a few seconds to buffer, that's normal, not broken, breathe."}
        </p>
      )}

      <div className="showdown-panels">
        {[{ id: leftId, entry: left, side: "left" as const }, { id: rightId, entry: right, side: "right" as const }].map(({ id, entry, side }) => (
          <div key={id} className={`showdown-panel ${myVote === side ? "showdown-panel--chosen" : ""}`}>
            {entry ? <EntryMedia entry={entry} audioOnly={audioOnly} /> : <div className="showdown-nofile">missing entry</div>}
            <div className="showdown-panel__title">{entry?.title}</div>
            <div className="showdown-panel__sub">{entry?.animeTitle}</div>
            <button className="btn showdown-panel__choose" disabled={!!myVote} onClick={() => vote(side)}>
              {myVote === side ? "✓ your pick" : myVote ? "—" : "choose"}
            </button>
          </div>
        ))}
      </div>
      <div className="showdown-vs">VS</div>
    </div>
  );
}

function ResultsView({
  state,
  isOwner,
  sendOp,
  resultsRef,
}: {
  state: ShowdownState;
  isOwner: boolean;
  sendOp: (op: ShowdownOp, optimistic?: (s: ShowdownState) => ShowdownState) => void;
  resultsRef: React.RefObject<HTMLDivElement>;
}) {
  const placements = useMemo(() => derivePlacements(state), [state]);
  return (
    <div className="showdown-results" ref={resultsRef}>
      <h2>and the winner is...</h2>
      {placements.map((g) => (
        <div key={g.label} className={`showdown-place ${g.label === "Champion" ? "showdown-place--champ" : ""}`}>
          <div className="showdown-place__label">{g.label}</div>
          <div className="showdown-place__names">
            {g.ids.map((id) => state.entries[id]?.title).filter(Boolean).join(" · ")}
          </div>
        </div>
      ))}
      {isOwner && (
        <div className="showdown-match__owner no-export" style={{ marginTop: 20 }}>
          <button className="btn" onClick={() => sendOp({ type: "reset" })}>run it back (same bracket)</button>
          <button className="btn btn--ghost" onClick={() => confirm("wipe entries and rebuild from scratch?") && sendOp({ type: "backToSeeding" })}>
            new entries
          </button>
        </div>
      )}
    </div>
  );
}
