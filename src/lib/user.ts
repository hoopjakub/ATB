import type { User } from "../types";

const KEY = "atb:user";

export const USER_COLORS = [
  "#c6ff3d", "#ff3dae", "#3dc8ff", "#ffb03d", "#a03dff",
  "#3dff88", "#ff5c5c", "#ffd75c", "#5c9dff", "#ff8bd1",
];

export function loadUser(): User | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const u = JSON.parse(raw);
    if (u?.id && u?.nick && u?.color) return u;
    return null;
  } catch {
    return null;
  }
}

export function saveUser(nick: string, color?: string): User {
  const existing = loadUser();
  const user: User = {
    id: existing?.id ?? crypto.randomUUID(),
    nick: nick.trim().slice(0, 24),
    color: color ?? existing?.color ?? USER_COLORS[Math.floor(Math.random() * USER_COLORS.length)],
  };
  localStorage.setItem(KEY, JSON.stringify(user));
  return user;
}
