import { ReactNode, useEffect, useRef, useState } from "react";

const MESSAGES = [
  "waking up the server…",
  "free hosting takes naps after 15 minutes idle — this can take up to a minute",
  "still going, hang tight…",
  "almost there, the database is stretching too…",
];

// Render's free tier fully spins down the process after ~15min idle, and
// Supabase's free tier separately pauses the database after ~1 week idle —
// two different kinds of cold start. We deliberately probe an endpoint that
// touches the database (not just a static in-memory route) so "ready" here
// actually means "the whole stack answered," not just "Node is up."
// Note: this can't do anything about the very first browser request itself
// (loading index.html) — that part is the browser's own blank-tab spinner,
// before any of our JS exists to render a custom screen. This only covers
// what happens after our JS has loaded and starts talking to the backend.
const PROBE_URL = "/api/rooms?game=tierlist";
const POLL_INTERVAL_MS = 2500;

export default function BootGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef(Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        const res = await fetch(PROBE_URL);
        if (res.ok && !cancelled) {
          setReady(true);
          return;
        }
      } catch {
        // network error while waking up — expected, just keep polling
      }
      if (!cancelled) timer = setTimeout(tick, POLL_INTERVAL_MS);
    };
    tick();

    const clock = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(clock);
    };
  }, []);

  if (ready) return <>{children}</>;

  const message = MESSAGES[Math.min(Math.floor(elapsed / 8), MESSAGES.length - 1)];

  return (
    <div className="bootscreen">
      <div className="bootscreen__mark">ALL THE <em>BULLSHIT</em></div>
      <div className="bootscreen__spinner" />
      <div className="bootscreen__msg">{message}</div>
      <div className="bootscreen__elapsed">{elapsed}s elapsed</div>
    </div>
  );
}
