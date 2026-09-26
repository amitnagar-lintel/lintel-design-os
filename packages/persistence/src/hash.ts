import { createHash } from "node:crypto";
import { stableStringify } from "@lintel/types";

/** `sha256:` + 64 lowercase hex characters. */
export type Sha256 = `sha256:${string}`;

const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function isSha256(value: string): value is Sha256 {
  return SHA256_PATTERN.test(value);
}

/**
 * Content hash used for integrity in the database (M5 §3): SHA-256 over the canonical
 * `stableStringify` form. Key order never matters; the engine's `hash53` is kept only
 * inside payloads for golden parity and is never used for integrity.
 */
export function contentHash(value: unknown): Sha256 {
  return `sha256:${createHash("sha256").update(stableStringify(value), "utf8").digest("hex")}`;
}
