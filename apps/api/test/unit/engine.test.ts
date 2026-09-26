/**
 * Engine provenance (OD-S6-9): the fingerprint is a dependency-closure hash, so engine code changes are detected
 * without a version bump while unrelated changes never alter it; the build / commit is recorded separately.
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ROOM_ENGINE_VERSION } from "@lintel/design-engine";
import { describe, expect, it } from "vitest";
import { loadConfig, resolveBuildRevision } from "../../src/config.js";
import { ENGINE_ENTRIES } from "../../src/infrastructure/engines/engine-entries.js";
import type { EngineManifestEntry } from "../../src/infrastructure/engines/engine-manifest.js";
import { engineFingerprint, engineProvenance, loadEngineManifest, parseEngineManifest } from "../../src/infrastructure/engines/engine-manifest.js";
import { computeEngineManifest } from "../../src/infrastructure/engines/engine-manifest.build.js";

const A = "3f2a9c1e7b4d5a6f8e9d0c1b2a3f4e5d6c7b8a90";
const B = "3f2a9c1e7b4d5a6f8e9d0c1b2a3f4e5d6c7b8a91";

const VALIDATION = ENGINE_ENTRIES.validation as { entry: string; version: string };
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const abs = (rel: string) => join(ROOT, rel);
const real = (p: string) => readFileSync(p, "utf8");
/** A reader that changes exactly one file's content; everything else is read from disk. */
const patched = (target: string, change: (text: string) => string) => (p: string) => (p === abs(target) ? change(real(p)) : real(p));
const fp = (o: Parameters<typeof computeEngineManifest>[0] = {}) => (computeEngineManifest({ entries: { validation: VALIDATION }, ...o }).engines.validation as EngineManifestEntry);

describe("engine fingerprint (OD-S6-9): dependency-closure hash", () => {
  it("covers the semantic version, the reached source per internal package, locked externals and the runtime; not the commit", () => {
    const e = fp();
    expect(e).toMatchObject({ name: "validation", version: ROOM_ENGINE_VERSION });
    expect(e.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.keys(e.closure.packages)).toEqual(expect.arrayContaining(["@lintel/api", "@lintel/design-engine", "@lintel/hettich-engine", "@lintel/persistence", "@lintel/rules-engine", "@lintel/types"]));
    // Only engines and persistence: no UI, no HTTP stack, no database driver is reachable from an engine entry.
    for (const p of ["@lintel/ui", "@lintel/storage", "@lintel/drawing-engine"]) expect(Object.keys(e.closure.packages)).not.toContain(p);
    expect(e.closure.externals).toEqual({});
    expect(e.closure.runtime).toMatch(/^node-\d+$/);
    expect(engineFingerprint(e)).toBe(e.fingerprint);
  });
  it("same engine code + same dependency closure → same fingerprint (deterministic; independent of the build / commit)", () => {
    expect(fp({ readFile: real })).toEqual(fp({ readFile: real }));
    const e = fp();
    expect(engineProvenance({ schema: 1, engines: { validation: e } }, "validation", "a".repeat(40)).fingerprint)
      .toBe(engineProvenance({ schema: 1, engines: { validation: e } }, "validation", "b".repeat(40)).fingerprint);
  });
  it("a change to a reached engine file, a reached dependency, the entry module or the semantic version changes the fingerprint", () => {
    const base = fp({ readFile: real }).fingerprint;
    expect(fp({ readFile: patched("packages/design-engine/src/room.ts", (t) => `${t}\n// engine change\n`) }).fingerprint).not.toBe(base);
    expect(fp({ readFile: patched("packages/rules-engine/src/evaluator.ts", (t) => `${t}\n// dependency change\n`) }).fingerprint).not.toBe(base);
    expect(fp({ readFile: patched(VALIDATION.entry, (t) => `${t}\n// entry change\n`) }).fingerprint).not.toBe(base);
    expect(fp({ entries: { validation: { ...VALIDATION, version: "9.9.9" } } }).fingerprint).not.toBe(base);
    expect(fp({ runtime: "node-99" }).fingerprint).not.toBe(base);
  });
  it("docs, tests, UI and unreached modules never change it", () => {
    const base = fp({ readFile: real }).fingerprint;
    for (const unreached of ["docs/architecture/M5-STEP6-OUTPUT-PLAN.md", "packages/design-engine/README.md", "packages/design-engine/test/components.test.ts",
      "apps/api/src/modules/clients/clients.service.ts", "packages/drawing-engine/src/svg.ts"]) {
      expect([unreached, fp({ readFile: patched(unreached, (t) => `${t}\n// unrelated change\n`) }).fingerprint]).toEqual([unreached, base]);
    }
  });
  it("a locked external version is part of the closure fingerprint", () => {
    const e = fp();
    const withExternal = { ...e, closure: { ...e.closure, externals: { zod: "4.6.5+sha512-a" } } };
    expect(engineFingerprint(withExternal)).not.toBe(e.fingerprint);
    expect(engineFingerprint({ ...e, closure: { ...e.closure, externals: { zod: "4.6.6+sha512-b" } } })).not.toBe(engineFingerprint(withExternal));
  });
  it("a dynamic import or require() in the closure is refused (nothing may escape the fingerprint)", () => {
    expect(() => fp({ readFile: patched(VALIDATION.entry, (t) => `${t}\nexport const lazy = () => import("./x.js");\n`) })).toThrow(/dynamic import/);
    expect(() => fp({ readFile: patched("packages/design-engine/src/room.ts", (t) => `${t}\nconst m = require("x");\n`) })).toThrow(/dynamic import/);
  });
  it("production loads the build-time manifest file (ENGINE_MANIFEST_PATH) instead of computing it", async () => {
    const m = computeEngineManifest();
    const path = join(mkdtempSync(join(tmpdir(), "engine-manifest-")), "engine-manifest.json");
    writeFileSync(path, JSON.stringify(m));
    expect(await loadEngineManifest(path)).toEqual(m);
    expect(await loadEngineManifest(undefined)).toEqual(m);
  });
  it("a build-time manifest is verified when loaded: a tampered fingerprint or closure is refused", () => {
    const m = computeEngineManifest();
    expect(parseEngineManifest(JSON.parse(JSON.stringify(m)))).toEqual(m);
    const e = m.engines.validation as EngineManifestEntry;
    expect(() => parseEngineManifest({ schema: 1, engines: { validation: { ...e, fingerprint: `sha256:${"0".repeat(64)}` } } })).toThrow(/does not match/);
    expect(() => parseEngineManifest({ schema: 1, engines: { validation: { ...e, closure: { ...e.closure, externals: { x: "1" } } } } })).toThrow(/does not match/);
  });
});

describe("build identity resolution", () => {
  const noGit = () => null;
  it("prefers BUILD_REVISION, then GITHUB_SHA, then the Git checkout", () => {
    expect(resolveBuildRevision({ BUILD_REVISION: A, GITHUB_SHA: B }, () => "c".repeat(40))).toBe(A);
    expect(resolveBuildRevision({ GITHUB_SHA: B }, () => "c".repeat(40))).toBe(B);
    expect(resolveBuildRevision({}, () => `${A}+dirty`)).toBe(`${A}+dirty`);
  });
  it("refuses to start without a valid build identity (no default is invented)", () => {
    expect(() => resolveBuildRevision({}, noGit)).toThrow(/build identity is required/);
    for (const bad of ["", "abc", "has space", "-leading"]) expect(() => resolveBuildRevision({ BUILD_REVISION: bad }, noGit)).toThrow(/build identity is required/);
  });
  it("is part of the loaded API config", () => {
    const env = { DATABASE_URL: "postgresql://x", AUTH_ISSUER: "https://auth.test.local/auth/v1", AUTH_JWT_SECRET: "s".repeat(40), CURSOR_SECRET: "c".repeat(40), BUILD_REVISION: A };
    expect(loadConfig(env, noGit).buildRevision).toBe(A);
    expect(() => loadConfig({ ...env, BUILD_REVISION: undefined }, noGit)).toThrow(/build identity is required/);
  });
});

describe("one fingerprint per output engine (M5 Step 7 checkpoint 2)", () => {
  const all = (o: Parameters<typeof computeEngineManifest>[0] = {}) => computeEngineManifest(o).engines;
  const outputs = ["validation", "bom", "boq", "pricing", "quotation"] as const;
  it("validation, bom, boq, pricing and quotation each have their own entry, semantic version and fingerprint", () => {
    const m = all();
    expect(Object.keys(m).sort()).toEqual([...outputs].sort());
    for (const name of outputs) expect([name, m[name]?.version]).toEqual([name, ENGINE_ENTRIES[name]?.version]);
    expect(new Set(outputs.map((n) => m[n]?.fingerprint)).size).toBe(outputs.length);
  });
  it("every output engine's closure includes the room resolution it consumes (the execution context's model), and only its own output engine", () => {
    const m = all();
    const pkgs = (n: (typeof outputs)[number]) => Object.keys(m[n]?.closure.packages ?? {});
    for (const n of outputs) expect(pkgs(n)).toEqual(expect.arrayContaining(["@lintel/design-engine", "@lintel/hettich-engine", "@lintel/persistence"]));
    expect(pkgs("bom")).toContain("@lintel/bom-engine");
    expect(pkgs("boq")).toContain("@lintel/boq-engine");
    for (const n of ["pricing", "quotation"] as const) expect(pkgs(n)).toContain("@lintel/pricing-engine");
    for (const n of ["validation", "bom", "boq"] as const) expect(pkgs(n)).not.toContain("@lintel/pricing-engine");
    for (const n of outputs) expect(pkgs(n)).not.toContain("@lintel/drawing-engine");
  });
  it("a pricing-engine change moves the pricing and quotation fingerprints only; a design-engine change moves all of them", () => {
    const base = all({ readFile: real });
    const priced = all({ readFile: patched("packages/pricing-engine/src/price.ts", (t) => `${t}\n// pricing change\n`) });
    expect(outputs.map((n) => [n, priced[n]?.fingerprint === base[n]?.fingerprint])).toEqual([["validation", true], ["bom", true], ["boq", true], ["pricing", false], ["quotation", false]]);
    const designed = all({ readFile: patched("packages/design-engine/src/room.ts", (t) => `${t}\n// design change\n`) });
    for (const n of outputs) expect([n, designed[n]?.fingerprint === base[n]?.fingerprint]).toEqual([n, false]);
  });
  it("the room is resolved in exactly one place of the outputs module: buildOutputExecutionContext", () => {
    const dir = abs("apps/api/src/modules/outputs");
    const files = ["output-context.ts", "output-generation.ts", "outputs.service.ts", "staleness.ts", "outputs.controller.ts", "engines/bom.ts", "engines/boq.ts", "engines/pricing.ts", "engines/quotation.ts"];
    const calls = files.flatMap((f) => [...real(join(dir, f)).matchAll(/\b(resolveEngineeringModel|resolveRoom|runDesignEngine)\(/g)].map(() => f));
    expect(calls).toEqual(["output-context.ts"]);
  });
});
