const TOKEN_KEY = "medchat.jwt";
const USER_KEY = "medchat.user";

export type StoredUser = { id: string; email: string };

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser(): StoredUser | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredUser;
    if (parsed && typeof parsed.id === "string" && typeof parsed.email === "string") {
      return parsed;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function setStoredAuth(token: string, user: StoredUser) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearStoredAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

/** Merge into fetch headers (e.g. with Content-Type). */
export function authHeaderFields(): Record<string, string> {
  const t = getStoredToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
