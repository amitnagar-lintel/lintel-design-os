/**
 * Scrubbing of anything sent to error tracking. Pure and conservative: whole sections that can carry request or user
 * data are dropped, and every remaining string is redacted for credentials and personal data.
 */
const PATTERNS: readonly [RegExp, string][] = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]"],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, "[redacted-jwt]"],
  [/\bsb_(secret|publishable)_[A-Za-z0-9_-]+/g, "[redacted-supabase-key]"],
  [/\b(postgres(?:ql)?|https?):\/\/[^\s:/@]+:[^\s@/]+@/gi, "$1://[redacted]@"],
  [/\b(password|passwd|pwd|secret|token|api[_-]?key|authorization|cookie)\b(\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi, "$1$2[redacted]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[redacted-email]"],
  // Phone-like digit runs (not ids: a run touching a letter, digit group or hyphen of a UUID is left alone).
  [/(?<![\w-])\+?\d[\d ]{8,}\d(?![\w-])/g, "[redacted-number]"],
];

export function scrubText(s: string): string {
  let out = s;
  for (const [re, by] of PATTERNS) out = out.replace(re, by);
  return out;
}

/** A Sentry-shaped event (only the parts this module touches). */
export interface ScrubbableEvent {
  message?: string | undefined;
  request?: unknown;
  user?: unknown;
  breadcrumbs?: unknown;
  extra?: unknown;
  server_name?: string | undefined;
  contexts?: Record<string, unknown> | undefined;
  tags?: Record<string, unknown> | undefined;
  exception?: { values?: { value?: string | undefined; stacktrace?: { frames?: { vars?: unknown }[] | undefined } | undefined }[] | undefined } | undefined;
}

const ALLOWED_TAGS = new Set(["requestId", "route", "method", "status", "code"]);
const ALLOWED_CONTEXTS = new Set(["runtime", "os", "app"]);

export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  delete event.request;
  delete event.user;
  delete event.breadcrumbs;
  delete event.extra;
  delete event.server_name;
  if (event.contexts !== undefined) event.contexts = Object.fromEntries(Object.entries(event.contexts).filter(([k]) => ALLOWED_CONTEXTS.has(k)));
  if (event.tags !== undefined) {
    event.tags = Object.fromEntries(Object.entries(event.tags).filter(([k]) => ALLOWED_TAGS.has(k)).map(([k, v]) => [k, typeof v === "string" ? scrubText(v) : v]));
  }
  if (event.message !== undefined) event.message = scrubText(event.message);
  for (const v of event.exception?.values ?? []) {
    if (v.value !== undefined) v.value = scrubText(v.value);
    for (const f of v.stacktrace?.frames ?? []) delete f.vars;
  }
  return event;
}
