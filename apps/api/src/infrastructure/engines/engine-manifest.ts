/**
 * Engine identity (Step 6 plan revision 4 §6, OD-S6-9). Each output engine has one composition entry module; its
 * fingerprint is the SHA-256 of { engine name, semantic version, the reached source files per internal package, the
 * entry module, the locked external dependency versions, the runtime major }. Same engine code and dependency closure
 * ⇔ same fingerprint; the repository as a whole is never hashed. The human-readable build (commit SHA) is recorded
 * beside the fingerprint and is not an input to it.
 *
 * Production artifacts carry a manifest generated at build time (`pnpm engines:manifest`); development and tests
 * compute it at startup from the working tree (engine-manifest.build.ts).
 */
import { readFile } from "node:fs/promises";
import type { EngineClosure, EngineName, EngineProvenance, Sha256 } from "@lintel/persistence";
import { contentHash } from "@lintel/persistence";
import { z } from "zod";

export interface EngineManifestEntry {
  readonly name: EngineName;
  readonly version: string;
  readonly fingerprint: Sha256;
  readonly closure: EngineClosure;
}

export interface EngineManifest {
  readonly schema: 1;
  readonly engines: Readonly<Partial<Record<EngineName, EngineManifestEntry>>>;
}

/** The fingerprint of one engine: a pure function of what its closure covers. */
export function engineFingerprint(e: { readonly name: EngineName; readonly version: string; readonly closure: EngineClosure }): Sha256 {
  return contentHash({
    engine: e.name, version: e.version, packages: e.closure.packages, entry: e.closure.entry, externals: e.closure.externals, runtime: e.closure.runtime,
  });
}

const Sha = z.custom<Sha256>((v) => typeof v === "string" && /^sha256:[0-9a-f]{64}$/.test(v), "sha256:<64 hex>");
const Entry = z.strictObject({
  name: z.enum(["validation", "bom", "boq", "pricing", "quotation", "drawing", "manufacturing"]),
  version: z.string().min(1),
  fingerprint: Sha,
  closure: z.strictObject({ packages: z.record(z.string(), Sha), externals: z.record(z.string(), z.string()), entry: Sha, runtime: z.string().regex(/^node-\d+$/) }),
});
const Manifest = z.strictObject({ schema: z.literal(1), engines: z.record(z.string(), Entry) });

/** Parse and verify a manifest: every fingerprint must recompute from its closure. */
export function parseEngineManifest(value: unknown): EngineManifest {
  const m = Manifest.parse(value);
  for (const [key, e] of Object.entries(m.engines)) {
    if (key !== e.name) throw new Error(`engine manifest: entry ${key} is named ${e.name}`);
    if (engineFingerprint(e) !== e.fingerprint) throw new Error(`engine manifest: fingerprint of ${key} does not match its closure`);
  }
  return m;
}

/** Load the build-time manifest, or compute it from the working tree when no manifest path is configured. */
export async function loadEngineManifest(path: string | undefined): Promise<EngineManifest> {
  if (path !== undefined) return parseEngineManifest(JSON.parse(await readFile(path, "utf8")) as unknown);
  const { computeEngineManifest } = await import("./engine-manifest.build.js");
  return computeEngineManifest();
}

/** The exact provenance of one engine for a result produced by this process. */
export function engineProvenance(manifest: EngineManifest, name: EngineName, build: string): EngineProvenance {
  const e = manifest.engines[name];
  if (e === undefined) throw new Error(`engine manifest has no ${name} engine`);
  return { name, version: e.version, build, fingerprint: e.fingerprint, closure: e.closure };
}
