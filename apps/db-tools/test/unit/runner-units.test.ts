/** Pure parts of the migration runner (G6): the migration set, the ledger comparison, the target guard and arguments. */
import { describe, expect, it } from "vitest";
import type { Migration } from "../../src/migrations.js";
import { assess, checksumOf, loadMigrations } from "../../src/migrations.js";
import { environmentFlag, guard, parseArgs, RefusedError, targetOf } from "../../src/target.js";

const m = (version: string, name = `m${version}`, up = `-- ${version}`): Migration => ({ version, name, up, down: "", checksum: checksumOf(up) });
const row = (x: Migration) => ({ version: x.version, name: x.name, checksum: x.checksum });
const set = [m("0001"), m("0002"), m("0003")];

describe("the migration set", () => {
  it("loads the repository migrations in order, each with a rollback and the SHA-256 of its up file", () => {
    const all = loadMigrations();
    expect(all.map((x) => x.version)).toEqual([...all.map((x) => x.version)].sort());
    expect(all[0]).toMatchObject({ version: "0001", name: "foundation" });
    for (const x of all) expect(x.checksum).toBe(checksumOf(x.up));
    expect(new Set(all.map((x) => x.version)).size).toBe(all.length);
  });
});

describe("assess (ledger vs files)", () => {
  it("UNINITIALISED without a ledger; PENDING after a prefix; UP_TO_DATE when complete", () => {
    expect(assess(set, null)).toMatchObject({ state: "UNINITIALISED", pending: set, drift: [] });
    expect(assess(set, [row(set[0]!)])).toMatchObject({ state: "PENDING", applied: ["0001"], pending: [set[1], set[2]] });
    expect(assess(set, set.map(row))).toMatchObject({ state: "UP_TO_DATE", pending: [], drift: [] });
  });
  it("any mismatch is DRIFT", () => {
    const kinds = (ledger: Parameters<typeof assess>[1]) => assess(set, ledger).drift.map((d) => `${d.version}:${d.kind}`);
    expect(kinds([{ ...row(set[0]!), checksum: "0".repeat(64) }])).toEqual(["0001:CHECKSUM_MISMATCH"]);
    expect(kinds([{ ...row(set[0]!), name: "other" }])).toEqual(["0001:NAME_MISMATCH"]);
    expect(kinds([...set.map(row), { version: "0004", name: "x", checksum: "y" }])).toEqual(["0004:UNKNOWN_APPLIED"]);
    expect(kinds([row(set[0]!), row(set[2]!)])).toEqual(["0002:OUT_OF_ORDER"]);
    expect(assess(set, [row(set[0]!), row(set[2]!)]).state).toBe("DRIFT");
  });
});

describe("target and guard", () => {
  it("identifies a Supabase project from the direct host or the pooler user, anything else by host:port/database", () => {
    expect(targetOf("postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres")).toMatchObject({ identity: "abcdefghijklmnopqrst", hosted: true });
    expect(targetOf("postgresql://postgres.abcdefghijklmnopqrst:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres")).toMatchObject({ identity: "abcdefghijklmnopqrst", hosted: true });
    expect(targetOf("postgresql://postgres@127.0.0.1:55432/design_os")).toEqual({ identity: "127.0.0.1:55432/design_os", hosted: false, display: "127.0.0.1:55432/design_os" });
    expect(targetOf("postgres://u:secret@localhost/x").display).not.toContain("secret");
    expect(() => targetOf("mysql://x")).toThrow(RefusedError);
    expect(() => targetOf("postgresql://postgres:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres")).toThrow(/postgres\.<project-ref>/);
  });
  it("staging / production need an exact --confirm; local / ci never accept a hosted database", () => {
    const hosted = targetOf("postgresql://postgres:pw@db.abcdefghijklmnopqrst.supabase.co:5432/postgres");
    const local = targetOf("postgresql://postgres@127.0.0.1:55432/postgres");
    expect(() => { guard("production", hosted, undefined); }).toThrow(/--confirm abcdefghijklmnopqrst/);
    expect(() => { guard("production", hosted, "zzzzzzzzzzzzzzzzzzzz"); }).toThrow(/does not match/);
    expect(() => { guard("production", hosted, "ABCDEFGHIJKLMNOPQRST"); }).not.toThrow();
    expect(() => { guard("staging", local, "127.0.0.1:55432/postgres"); }).not.toThrow();
    expect(() => { guard("local", hosted, undefined); }).toThrow(/staging or --env production/);
    expect(() => { guard("ci", local, undefined); }).not.toThrow();
  });
  it("parses arguments strictly", () => {
    expect(parseArgs(["up", "--env", "ci", "--dry-run", "--to=0003"])).toEqual({ command: "up", flags: new Map<string, string | true>([["env", "ci"], ["dry-run", true], ["to", "0003"]]) });
    expect(() => parseArgs(["up", "extra"])).toThrow(/unexpected argument/);
    expect(() => environmentFlag(parseArgs(["up", "--env", "prod"]))).toThrow(/--env must be one of/);
    expect(() => environmentFlag(parseArgs(["up"]))).toThrow(/--env is required/);
  });
});
