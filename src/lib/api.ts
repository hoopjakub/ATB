export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.message || data.error || `request failed (${res.status})`, res.status, data);
  return data as T;
}

export class ApiError extends Error {
  status: number;
  data: any;
  constructor(message: string, status: number, data: any) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const TOKENS_KEY = "atb:roomTokens";

export function saveRoomToken(roomId: string, token: string) {
  try {
    const all = JSON.parse(sessionStorage.getItem(TOKENS_KEY) || "{}");
    all[roomId] = token;
    sessionStorage.setItem(TOKENS_KEY, JSON.stringify(all));
  } catch {}
}

export function getRoomToken(roomId: string): string | undefined {
  try {
    return JSON.parse(sessionStorage.getItem(TOKENS_KEY) || "{}")[roomId];
  } catch {
    return undefined;
  }
}
