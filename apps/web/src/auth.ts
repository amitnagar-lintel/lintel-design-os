/**
 * Sign-in for the pilot UI.
 *
 * - SUPABASE (default): email + password against Supabase Auth with the project's PUBLISHABLE key (VITE_SUPABASE_URL,
 *   VITE_SUPABASE_PUBLISHABLE_KEY). The browser never holds a secret key. The API verifies the access token itself.
 * - LOCAL (VITE_APP_ENV=local, `pnpm pilot:demo`): paste an access token printed by the demo (.pilot/tokens/*.txt).
 *
 * Several people can be signed in in one tab (the pilot's roles are different people: designer, design head, sales…);
 * the header switches between them. Sessions live in sessionStorage only (closing the tab signs everyone out).
 */
export interface Session {
  readonly token: string;
  readonly email: string;
  readonly userId: string;
  readonly expiresAt: number;
}

export const APP_ENV = (import.meta.env.VITE_APP_ENV as string | undefined) === "local" ? "LOCAL" : "SUPABASE";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
const KEY = "lintel.pilot.sessions";

/** Reads (does not verify) the claims of an access token, to label the session. The API verifies every request. */
export function claimsOf(token: string): { sub: string; email: string; exp: number } | null {
  const part = token.split(".")[1];
  if (part === undefined) return null;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: unknown; email?: unknown; exp?: unknown };
    if (typeof json.sub !== "string" || typeof json.exp !== "number") return null;
    return { sub: json.sub, email: typeof json.email === "string" ? json.email : json.sub, exp: json.exp };
  } catch {
    return null;
  }
}

export function sessionFromToken(token: string): Session {
  const t = token.trim();
  const c = claimsOf(t);
  if (c === null) throw new Error("This is not an access token (expected a JWT).");
  if (c.exp * 1000 < Date.now()) throw new Error("This access token has expired.");
  return { token: t, email: c.email, userId: c.sub, expiresAt: c.exp * 1000 };
}

export async function signInWithPassword(email: string, password: string): Promise<Session> {
  if (SUPABASE_URL === undefined || PUBLISHABLE_KEY === undefined) throw new Error("Supabase Auth is not configured (VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY).");
  const r = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: PUBLISHABLE_KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password }),
  });
  const body = await r.json().catch(() => ({})) as { access_token?: string; error_description?: string; msg?: string };
  if (!r.ok || body.access_token === undefined) throw new Error(body.error_description ?? body.msg ?? `Sign-in failed (HTTP ${String(r.status)})`);
  return sessionFromToken(body.access_token);
}

export function loadSessions(): Session[] {
  try {
    const raw = sessionStorage.getItem(KEY);
    const all = raw === null ? [] : JSON.parse(raw) as Session[];
    return all.filter((s) => s.expiresAt > Date.now());
  } catch {
    return [];
  }
}

export function saveSessions(sessions: readonly Session[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(sessions));
  } catch { /* storage unavailable: sessions last until reload */ }
}
