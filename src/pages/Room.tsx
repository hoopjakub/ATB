import { ComponentType, FormEvent, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { RoomMeta } from "../types";
import { api, getRoomToken, saveRoomToken } from "../lib/api";
import { useUser } from "../App";
import { useToast } from "../components/Toasts";
import TierBoard from "../games/tierlist/TierBoard";
import AlignmentBoard from "../games/alignment/AlignmentBoard";
import ShowdownBoard from "../games/showdown/ShowdownBoard";

const BOARDS: Record<string, ComponentType<{ roomId: string }>> = {
  tierlist: TierBoard,
  alignment: AlignmentBoard,
  showdown: ShowdownBoard,
};

export default function Room() {
  const { id = "" } = useParams();
  const roomId = id.toUpperCase();
  const { user } = useUser();
  const [meta, setMeta] = useState<RoomMeta | null>(null);
  const [status, setStatus] = useState<"loading" | "locked" | "ready" | "missing">("loading");

  useEffect(() => {
    setStatus("loading");
    api<{ room: RoomMeta }>(`/api/rooms/${roomId}`)
      .then(({ room }) => {
        setMeta(room);
        const needsCode = room.has_passcode && room.owner_id !== user.id && !getRoomToken(roomId);
        setStatus(needsCode ? "locked" : "ready");
      })
      .catch(() => setStatus("missing"));
  }, [roomId, user.id]);

  if (status === "loading") {
    return <div className="roomerror"><p>finding the room…</p></div>;
  }
  if (status === "missing") {
    return (
      <div className="roomerror">
        <h2>room not found</h2>
        <p>wrong code, or the owner nuked it.</p>
        <Link className="btn" to="/">back to games</Link>
      </div>
    );
  }
  if (status === "locked" && meta) {
    return <PasscodeGate roomId={roomId} roomName={meta.name} onUnlocked={() => setStatus("ready")} />;
  }
  const Board = (meta && BOARDS[meta.game]) || TierBoard;
  return <Board roomId={roomId} />;
}

function PasscodeGate({ roomId, roomName, onUnlocked }: { roomId: string; roomName: string; onUnlocked: () => void }) {
  const { user } = useUser();
  const toast = useToast();
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { token } = await api<{ token: string }>(`/api/rooms/${roomId}/join`, {
        method: "POST",
        body: JSON.stringify({ passcode, userId: user.id }),
      });
      saveRoomToken(roomId, token);
      onUnlocked();
    } catch (err: any) {
      toast(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <div className="gate__card">
        <div className="gate__title">
          <em>{roomName}</em> is locked
        </div>
        <p className="gate__sub">this room wants a passcode. ask whoever sent you here.</p>
        <form onSubmit={submit}>
          <div className="modal__row">
            <input
              className="input"
              type="password"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              placeholder="passcode"
              autoFocus
            />
          </div>
          <div className="modal__actions">
            <button className="btn" type="submit" disabled={busy || !passcode}>
              {busy ? "checking…" : "unlock"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
