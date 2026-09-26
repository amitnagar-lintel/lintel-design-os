/**
 * `pnpm engines:manifest [out.json]`: compute the engine manifest (per-engine version, closure and fingerprint) from
 * the working tree and write it for a production artifact (loaded through ENGINE_MANIFEST_PATH, verified at startup).
 */
import { writeFileSync } from "node:fs";
import { computeEngineManifest } from "./engine-manifest.build.js";

const out = process.argv[2] ?? "engine-manifest.json";
const manifest = computeEngineManifest();
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
for (const e of Object.values(manifest.engines)) process.stdout.write(`${e.name} ${e.version} ${e.fingerprint}\n`);
