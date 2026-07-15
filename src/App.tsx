import { createContext, useContext, useState, FormEvent } from "react";
import { Link, Route, Routes } from "react-router-dom";
import type { User } from "./types";
import { loadUser, saveUser, USER_COLORS } from "./lib/user";
import { ToastProvider } from "./components/Toasts";
import Home from "./pages/Home";
import Lobby from "./pages/Lobby";
import Room from "./pages/Room";

const UserCtx = createContext<{ user: User; setUser: (u: User) => void }>(null!);
export function useUser() {
  return useContext(UserCtx);
}

export default function App() {
  const [user, setUser] = useState<User | null>(loadUser());
  const [editing, setEditing] = useState(false);

  if (!user) {
    return (
      <IdentityForm
        title={<>who the hell <em>are</em> you?</>}
        sub="pick a name and a color. no accounts, no passwords, no bullshit — it just lives in this browser."
        onDone={setUser}
      />
    );
  }

  return (
    <UserCtx.Provider value={{ user, setUser }}>
      <ToastProvider>
        <header className="header">
          <Link to="/" className="header__logo">
            ALL THE <em>BULLSHIT</em>
          </Link>
          <div className="header__spacer" />
          <button className="header__user" onClick={() => setEditing(true)} title="change your name / color">
            <span className="avatar" style={{ background: user.color }}>
              {user.nick.slice(0, 1).toUpperCase()}
            </span>
            {user.nick}
          </button>
        </header>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/g/:game" element={<Lobby />} />
          <Route path="/room/:id" element={<Room />} />
          <Route path="*" element={<Home />} />
        </Routes>
        {editing && (
          <div className="modal-backdrop" onClick={() => setEditing(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <button className="modal__close" onClick={() => setEditing(false)}>×</button>
              <IdentityFields
                initial={user}
                submitLabel="save"
                onDone={(u) => {
                  setUser(u);
                  setEditing(false);
                }}
              />
            </div>
          </div>
        )}
      </ToastProvider>
    </UserCtx.Provider>
  );
}

function IdentityForm({ title, sub, onDone }: { title: React.ReactNode; sub: string; onDone: (u: User) => void }) {
  return (
    <div className="gate">
      <div className="gate__card">
        <div className="gate__title">{title}</div>
        <p className="gate__sub">{sub}</p>
        <IdentityFields submitLabel="let me in" onDone={onDone} />
      </div>
    </div>
  );
}

function IdentityFields({
  initial,
  submitLabel,
  onDone,
}: {
  initial?: User;
  submitLabel: string;
  onDone: (u: User) => void;
}) {
  const [nick, setNick] = useState(initial?.nick ?? "");
  const [color, setColor] = useState(initial?.color ?? USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!nick.trim()) return;
    onDone(saveUser(nick, color));
  };

  return (
    <form onSubmit={submit}>
      <div className="modal__row">
        <label className="label">nickname</label>
        <input
          className="input"
          value={nick}
          onChange={(e) => setNick(e.target.value)}
          placeholder="e.g. tierlord_9000"
          maxLength={24}
          autoFocus
        />
      </div>
      <div className="modal__row">
        <label className="label">your color</label>
        <div className="colorpick">
          {USER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={c === color ? "on" : ""}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </div>
      <div className="modal__actions">
        <button className="btn" type="submit" disabled={!nick.trim()}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
