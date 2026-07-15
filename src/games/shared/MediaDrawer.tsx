import { FormEvent, useRef, useState } from "react";
import type { MediaItem } from "../../types";
import { api, ApiError } from "../../lib/api";
import { useToast } from "../../components/Toasts";
import { useUser } from "../../App";

type Tab = "anime" | "characters" | "games" | "upload" | "link";

const SEARCH_TABS: { key: Tab; label: string; endpoint: string; hint: string }[] = [
  { key: "anime", label: "🎌 anime", endpoint: "/api/search/anime", hint: "search MyAnimeList (via Jikan)" },
  { key: "characters", label: "👤 characters", endpoint: "/api/search/characters", hint: "search anime/manga characters" },
  { key: "games", label: "🎮 games", endpoint: "/api/search/games", hint: "search game covers (RAWG)" },
];

export default function MediaDrawer({
  onAdd,
  inBoard,
}: {
  onAdd: (items: Partial<MediaItem>[]) => void;
  inBoard: (id: string) => boolean;
}) {
  const [tab, setTab] = useState<Tab>("anime");
  const [open, setOpen] = useState(true);
  const [added, setAdded] = useState<Set<string>>(new Set());

  const add = (items: Partial<MediaItem>[]) => {
    onAdd(items);
    setAdded((prev) => {
      const next = new Set(prev);
      for (const it of items) if (it.id) next.add(it.id);
      return next;
    });
  };

  return (
    <div className="drawer">
      <div className="drawer__bar">
        {SEARCH_TABS.map((t) => (
          <button
            key={t.key}
            className={`drawer__tab ${tab === t.key && open ? "on" : ""}`}
            onClick={() => { setTab(t.key); setOpen(true); }}
          >
            {t.label}
          </button>
        ))}
        <button className={`drawer__tab ${tab === "upload" && open ? "on" : ""}`} onClick={() => { setTab("upload"); setOpen(true); }}>
          📤 upload
        </button>
        <button className={`drawer__tab ${tab === "link" && open ? "on" : ""}`} onClick={() => { setTab("link"); setOpen(true); }}>
          🔗 paste url
        </button>
        <button className="drawer__toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "▼ hide" : "▲ add images"}
        </button>
      </div>
      {open && (
        <div className="drawer__body">
          {tab === "upload" ? (
            <UploadPane onAdd={add} />
          ) : tab === "link" ? (
            <LinkPane onAdd={add} />
          ) : (
            <SearchPane
              key={tab}
              config={SEARCH_TABS.find((t) => t.key === tab)!}
              onAdd={add}
              isAdded={(id) => added.has(id) || inBoard(id)}
            />
          )}
        </div>
      )}
    </div>
  );
}

function SearchPane({
  config,
  onAdd,
  isAdded,
}: {
  config: { endpoint: string; hint: string };
  onAdd: (items: Partial<MediaItem>[]) => void;
  isAdded: (id: string) => boolean;
}) {
  const toast = useToast();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [noKey, setNoKey] = useState(false);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    try {
      const d = await api<{ items: MediaItem[] }>(`${config.endpoint}?q=${encodeURIComponent(q.trim())}`);
      setResults(d.items);
      setNoKey(false);
      if (!d.items.length) toast("nothing found. spell it right maybe?");
    } catch (err: any) {
      if (err instanceof ApiError && err.data?.error === "no_key") setNoKey(true);
      else toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (noKey) {
    return (
      <p className="hint">
        game search needs a (free) RAWG API key — grab one at{" "}
        <a href="https://rawg.io/apidocs" target="_blank" rel="noreferrer">rawg.io/apidocs</a>, put{" "}
        <span className="mono">RAWG_API_KEY=...</span> into <span className="mono">.env</span> and restart the server.
        uploads &amp; anime search work fine without it.
      </p>
    );
  }

  return (
    <>
      <form className="drawer__search" onSubmit={search}>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={config.hint}
          autoFocus
        />
        <button className="btn btn--sm" type="submit" disabled={busy}>
          {busy ? "…" : "search"}
        </button>
      </form>
      {results.length > 0 && (
        <div className="results">
          {results.map((r) => (
            <button
              key={r.id}
              className={`result ${isAdded(r.id) ? "result--added" : ""}`}
              title={`add "${r.title}" to the board`}
              onClick={() => !isAdded(r.id) && onAdd([r])}
            >
              <img src={r.image_url} alt={r.title} loading="lazy" />
              <span className="result__name">{r.title}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function UploadPane({ onAdd }: { onAdd: (items: Partial<MediaItem>[]) => void }) {
  const { user } = useUser();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const send = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return toast("those aren't images");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("userId", user.id);
      for (const f of list.slice(0, 10)) fd.append("files", f);
      const d = await api<{ items: MediaItem[] }>("/api/upload", { method: "POST", body: fd });
      onAdd(d.items);
      toast(`added ${d.items.length} image${d.items.length > 1 ? "s" : ""} to the pool`);
    } catch (err: any) {
      toast(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div
        className={`dropzone ${over ? "over" : ""}`}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); send(e.dataTransfer.files); }}
      >
        {busy ? "uploading…" : "drop images here, or click to pick (jpg/png/gif/webp, max 8MB, up to 10 at once)"}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => e.target.files?.length && send(e.target.files)}
      />
    </>
  );
}

function LinkPane({ onAdd }: { onAdd: (items: Partial<MediaItem>[]) => void }) {
  const toast = useToast();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    let u: URL;
    try {
      u = new URL(url.trim());
      if (!/^https?:$/.test(u.protocol)) throw new Error();
    } catch {
      return toast("that's not a real image URL");
    }
    onAdd([{ title: title.trim() || u.pathname.split("/").pop() || "mystery image", image_url: u.toString(), source: "manual_url" }]);
    setUrl("");
    setTitle("");
    toast("added to the pool");
  };

  return (
    <form onSubmit={submit} style={{ maxWidth: 560 }}>
      <div className="modal__row">
        <label className="label">image url</label>
        <input className="input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/something.png (right-click any image → copy image address)" />
      </div>
      <div className="modal__row">
        <label className="label">label (optional)</label>
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="what is it" maxLength={120} />
      </div>
      <button className="btn btn--sm" type="submit" disabled={!url.trim()}>add to pool</button>
    </form>
  );
}
