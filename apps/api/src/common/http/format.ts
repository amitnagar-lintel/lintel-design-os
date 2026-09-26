import { canonicalValue } from "./etag.js";

/** Timestamps in responses: UTC ISO 8601 with microseconds ("2026-09-26T10:00:00.123456Z"). */
export function iso(v: string): string;
export function iso(v: string | null): string | null;
export function iso(v: string | null): string | null {
  return v === null ? null : String(canonicalValue(v));
}
