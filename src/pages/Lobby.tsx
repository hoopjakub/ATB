import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { GameInfo, RoomListing } from "../types";
import { api, saveRoomToken } from "../lib/api";
import { useUser } from "../App";
import { useToast } from "../components/Toasts";

export default function Lobby() {
  const { game = "tierlist" } = useParams();
  const { user } = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState<RoomListing[] | null>(null);
  const [gameInfo, setGameInfo] = useState<GameInfo | null>(null);
  const [creating, setCreating] = useState(false);
  const [code, setCode] = useState("");

  useEffect(() => {
    api<{ games: GameInfo[] }>("/api/games")
      .then((d) => setGameInfo(d.games.find((g) => g.slug === game) ?? null))
      .catch(() => {});
  }, [game]);

  useEffect(() => {
    let dead = false;
    const load = () =>
      api<{ rooms: RoomListing[] }>(`/api/rooms?game=${game}`)
        .then((d) => !dead && setRooms(d.rooms))
        .catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      dead = true;
      clearInterval(t);
    };
  }, [game]);

  const joinByCode = async (e: FormEvent) => {
    e.preventDefault();
    const id = code.trim().toUpperCase();
    if (!id) return;
    try {
      await api(`/api/rooms/${id}`);
      navigate(`/room/${id}`);
    } catch {
      toast(`no room with code ${id}`);
    }
  };

  return (
    <main className="lobby">
      <div className="lobby__head">
        <h1 className="lobby__title">
          {gameInfo ? `${gameInfo.display_name} rooms` : "rooms"}
          <small>public rooms show up here · private ones need a code</small>
        </h1>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={() => setCreating(true)}>+ new room</button>
      </div>

      {rooms === null ? (
        <div className="emptystate">loading…</div>
      ) : rooms.length === 0 ? (
        <div className="emptystate">
          dead silence in here. make the first room and get this party started.
        </div>
      ) : (
        <div className="roomlist">
          {rooms.map((r) => (
            <Link key={r.id} to={`/room/${r.id}`} className="roomcard">
              <div>
                <div className="roomcard__name">{r.name}</div>
                <div className="roomcard__meta">
                  <span>code {r.id}</span>
                  <span>by {r.owner_nick || "someone"}</span>
                </div>
              </div>
              <span className="roomcard__online">
                {r.online > 0 && <span className="dot" />}
                {r.online > 0 ? `${r.online} online` : "empty"}
              </span>
            </Link>
          ))}
        </div>
      )}

      <form className="joincode" onSubmit={joinByCode}>
        <input
          className="input"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="GOT A CODE?"
          maxLength={6}
        />
        <button className="btn btn--ghost" type="submit">join</button>
      </form>

      {creating && <CreateRoomModal game={game} displayName={gameInfo?.display_name ?? "room"} onClose={() => setCreating(false)} />}
    </main>
  );
}

function CreateRoomModal({ game, displayName, onClose }: { game: string; displayName: string; onClose: () => void }) {
  const { user } = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api<{ id: string; token: string }>("/api/rooms", {
        method: "POST",
        body: JSON.stringify({
          game,
          name: name.trim() || "untitled chaos",
          visibility,
          passcode: visibility === "private" && passcode ? passcode : undefined,
          user,
        }),
      });
      saveRoomToken(res.id, res.token);
      navigate(`/room/${res.id}`);
    } catch (err: any) {
      toast(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal__close" onClick={onClose}>×</button>
        <div className="modal__title">new {displayName.toLowerCase()} room</div>
        <form onSubmit={create}>
          <div className="modal__row">
            <label className="label">room name</label>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. ranking every animal martin has feared"
              maxLength={60}
              autoFocus
            />
          </div>
          <div className="modal__row">
            <label className="label">visibility</label>
            <div className="seg">
              <button type="button" className={visibility === "public" ? "on" : ""} onClick={() => setVisibility("public")}>
                public — listed
              </button>
              <button type="button" className={visibility === "private" ? "on" : ""} onClick={() => setVisibility("private")}>
                private — code only
              </button>
            </div>
          </div>
          {visibility === "private" && (
            <div className="modal__row">
              <label className="label">passcode (optional)</label>
              <input
                className="input"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="leave empty = anyone with the code gets in"
                maxLength={40}
              />
            </div>
          )}
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={onClose}>nah</button>
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "spawning…" : "create room"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
