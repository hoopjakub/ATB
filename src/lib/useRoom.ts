import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import type { RoomMeta, User } from "../types";
import { getRoomToken } from "./api";

export interface RemoteDrag {
  user: User;
  itemId: string;
  x: number;
  y: number;
  hasPos: boolean;
}

export interface RemoteCursor {
  user: User;
  x: number;
  y: number;
  at: number;
}

export interface RoomError {
  code: string;
  message: string;
}

export function useRoom<State, OpType>(roomId: string, user: User | null) {
  const socketRef = useRef<Socket | null>(null);
  const [room, setRoom] = useState<RoomMeta | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [presence, setPresence] = useState<User[]>([]);
  const [error, setError] = useState<RoomError | null>(null);
  const [connected, setConnected] = useState(false);
  // ephemeral layers live outside React state churn where possible
  const [cursors, setCursors] = useState<Record<string, RemoteCursor>>({});
  const [remoteDrags, setRemoteDrags] = useState<Record<string, RemoteDrag>>({});
  const lastToast = useRef<(msg: string) => void>(() => {});

  useEffect(() => {
    if (!user) return;
    const socket = io({
      auth: { roomId, user, token: getRoomToken(roomId) },
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;

    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));

    socket.on("room:init", (payload) => {
      setRoom(payload.room);
      setState(payload.state);
      setPresence(payload.presence);
      setError(null);
    });
    socket.on("room:state", ({ state }) => setState(state));
    socket.on("room:meta", (meta) => setRoom(meta));
    socket.on("room:presence", (list: User[]) => {
      setPresence(list);
      setCursors((prev) => {
        const ids = new Set(list.map((u) => u.id));
        const next: Record<string, RemoteCursor> = {};
        for (const [id, c] of Object.entries(prev)) if (ids.has(id)) next[id] = c;
        return next;
      });
      setRemoteDrags((prev) => {
        const ids = new Set(list.map((u) => u.id));
        const next: Record<string, RemoteDrag> = {};
        for (const [id, d] of Object.entries(prev)) if (ids.has(id)) next[id] = d;
        return next;
      });
    });
    socket.on("room:error", (err: RoomError) => setError(err));

    socket.on("cursor", ({ user: u, x, y }) => {
      if (u.id === user.id) return;
      setCursors((prev) => ({ ...prev, [u.id]: { user: u, x, y, at: Date.now() } }));
    });
    socket.on("drag:start", ({ user: u, itemId }) => {
      if (u.id === user.id) return;
      setRemoteDrags((prev) => ({ ...prev, [u.id]: { user: u, itemId, x: 0, y: 0, hasPos: false } }));
    });
    socket.on("drag:move", ({ userId, itemId, x, y }) => {
      setRemoteDrags((prev) => {
        const d = prev[userId];
        if (!d) return prev;
        return { ...prev, [userId]: { ...d, itemId, x, y, hasPos: true } };
      });
    });
    socket.on("drag:end", ({ userId }) => {
      setRemoteDrags((prev) => {
        const { [userId]: _, ...rest } = prev;
        return rest;
      });
    });

    // sweep stale cursors so ghosts don't linger after someone goes idle
    const sweep = setInterval(() => {
      setCursors((prev) => {
        const now = Date.now();
        const entries = Object.entries(prev).filter(([, c]) => now - c.at < 8000);
        return entries.length === Object.keys(prev).length ? prev : Object.fromEntries(entries);
      });
    }, 4000);

    return () => {
      clearInterval(sweep);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [roomId, user?.id]);

  const sendOp = useCallback((op: OpType, optimistic?: (s: State) => State) => {
    if (optimistic) setState((s) => (s ? optimistic(structuredClone(s)) : s));
    socketRef.current?.emit("op", op, (res: { ok: boolean; error?: string }) => {
      if (!res?.ok && res?.error) lastToast.current(res.error);
    });
  }, []);

  const emit = useCallback((event: string, payload?: unknown) => {
    socketRef.current?.emit(event, payload);
  }, []);

  const emitVolatile = useCallback((event: string, payload?: unknown) => {
    socketRef.current?.volatile.emit(event, payload);
  }, []);

  return {
    room, state, presence, error, connected,
    cursors, remoteDrags,
    sendOp, emit, emitVolatile,
    onOpError: (fn: (msg: string) => void) => { lastToast.current = fn; },
  };
}
