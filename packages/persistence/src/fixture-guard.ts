import { TestFixturePersistenceError } from "./errors.js";

const FIXTURE = "TEST_FIXTURE";
/** Fields that carry a data status or classification anywhere in engine data. */
const CLASSIFYING_KEYS = new Set(["status", "classification", "dataClassification", "kind", "licenseStatus"]);

/** Throws when a single status / classification value marks TEST_FIXTURE data. */
export function assertNotTestFixture(what: string, ...markers: readonly (string | null | undefined)[]): void {
  if (markers.some((m) => m === FIXTURE)) throw new TestFixturePersistenceError(what);
}

/**
 * Deep scan: the path of the first TEST_FIXTURE marker in an object graph, or null.
 * Also catches `trace.testFixtureSources` entries, which list every fixture input.
 */
export function findTestFixtureMarker(value: unknown, path = "$"): string | null {
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const hit = findTestFixtureMarker(v, `${path}[${i}]`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (CLASSIFYING_KEYS.has(k) && v === FIXTURE) return `${path}.${k}`;
      if (k === "testFixtureSources" && Array.isArray(v) && v.length > 0) return `${path}.${k}`;
      const hit = findTestFixtureMarker(v, `${path}.${k}`);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/** Throws when any part of `value` is TEST_FIXTURE data. */
export function assertNoTestFixture(what: string, value: unknown): void {
  const hit = findTestFixtureMarker(value);
  if (hit !== null) throw new TestFixturePersistenceError(`${what} (${hit})`);
}
