import type { ResolvedCabinet } from "@lintel/types";

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

/** 53-bit non-cryptographic string hash (cyrb53), rendered as hex. Deterministic across platforms. */
function hash53(str: string): string {
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

/**
 * Fingerprint of the resolved model (components, hardware, trace). Derived artifacts
 * (drawings, quotes) store it; a different fingerprint means the artifact is stale.
 */
export function modelFingerprint(resolved: ResolvedCabinet): string {
  return hash53(
    stableStringify({
      trace: resolved.trace,
      components: resolved.components,
      hardwareRequirements: resolved.hardwareRequirements,
      hardwareResolutions: resolved.hardwareResolutions,
    }),
  );
}
