/**
 * Shared deterministic serialisation primitives (used for golden fixtures,
 * model fingerprints and immutable snapshot hashes).
 */

/** JSON with recursively sorted object keys — identical data ⇒ identical string. */
export function stableStringify(value: unknown, indent?: number): string {
  const normalise = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(normalise);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, normalise((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(normalise(value), null, indent);
}

/** 53-bit non-cryptographic string hash (cyrb53), rendered as 14 hex chars. Deterministic across platforms. */
export function hash53(str: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}

/** Recursively freeze an object graph (immutable snapshots). Returns the same reference. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
  }
  return value;
}
