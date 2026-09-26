/** Engine provenance: the fingerprint identifies the semantic version AND the exact build, so code changes are detectable without a version bump. */
import { ROOM_ENGINE_VERSION } from "@lintel/design-engine";
import { describe, expect, it } from "vitest";
import { loadConfig, resolveBuildRevision } from "../../src/config.js";
import { engineIdentity } from "../../src/modules/design-versions/engine.js";

const A = "3f2a9c1e7b4d5a6f8e9d0c1b2a3f4e5d6c7b8a90";
const B = "3f2a9c1e7b4d5a6f8e9d0c1b2a3f4e5d6c7b8a91";

describe("engineIdentity", () => {
  it("two different builds give different fingerprints with the same semantic engine version", () => {
    const a = engineIdentity(A);
    const b = engineIdentity(B);
    expect([a.version, b.version]).toEqual([ROOM_ENGINE_VERSION, ROOM_ENGINE_VERSION]);
    expect([a.build, b.build]).toEqual([A, B]);
    expect(a.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(a.hash).not.toBe(b.hash);
  });
  it("is deterministic for one build", () => {
    expect(engineIdentity(A)).toEqual(engineIdentity(A));
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
