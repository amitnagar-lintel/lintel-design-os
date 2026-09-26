/**
 * Synthetic database-test values never become persistent reference data (M5 step 3):
 * - the synthetic marker and the synthetic module are referenced only under tests/db;
 * - migrations insert only schema registries and governance rows — never values, versions or content;
 * - the database seed folder holds no data; the variable registries match the engines' declared codes exactly.
 * (The database suite additionally proves, at teardown, that no row survives the rolled-back tests.)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KITCHEN_BASE_STANDARD_V1, PLANNING_VARIABLES } from "@lintel/catalog-engine";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MARKER = ["DB", "TEST", "ONLY"].join(" ");
const SKIP = new Set(["node_modules", ".git", "dist", "coverage"]);
const TEXT = /\.(ts|js|mjs|sql|md|json|ya?ml|txt)$/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : TEXT.test(name) ? [p] : [];
  });
}
const rel = (p: string): string => relative(ROOT, p).split(sep).join("/");
const all = files(ROOT);
const migrations = all.filter((p) => rel(p).startsWith("database/migrations/") && p.endsWith(".sql"));

/** Tables a migration may insert into: schema registries, seeded grants and governance rows written by functions/triggers. */
const ALLOWED_INSERT_TARGETS = new Set([
  "role", "permission", "default_role_permission", "construction_variable", "planning_variable", "versioned_table",
  "role_permission", "approval_request", "approval_decision", "audit_log", "validation_run",
  // 0012 error-code and output-purpose registries; 0013 idempotency claims (written only at runtime by design_os.claim_idempotency()).
  "error_code", "output_purpose_rule", "idempotency_record",
  // 0017 output registries: the output engines and the file formats snapshots may carry (schema, not content).
  "output_engine", "output_file_format",
]);

describe("synthetic database-test data stays isolated", () => {
  it("the synthetic marker and the synthetic module are referenced only under tests/db", () => {
    const offenders = all.filter((p) => rel(p) !== "tests/synthetic-data-isolation.test.ts")
      .filter((p) => { const t = readFileSync(p, "utf8"); return t.includes(MARKER) || /support\/synthetic(\.js)?["']/.test(t); })
      .map(rel).filter((r) => !r.startsWith("tests/db/"));
    expect(offenders).toEqual([]);
    expect(all.map(rel)).toContain("tests/db/support/synthetic.ts");
  });
  it("no package source imports anything from tests/", () => {
    const offenders = all.filter((p) => rel(p).startsWith("packages/")).filter((p) => /from\s+["'][^"']*tests\//.test(readFileSync(p, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });
  it("migrations insert only schema registries and governance rows — never values, versions or content", () => {
    const targets = new Set<string>();
    for (const p of migrations) for (const m of readFileSync(p, "utf8").matchAll(/INSERT\s+INTO\s+design_os\.(\w+)/gi)) targets.add(m[1] ?? "");
    expect([...targets].filter((t) => !ALLOWED_INSERT_TARGETS.has(t))).toEqual([]);
    for (const p of migrations) {
      const t = readFileSync(p, "utf8");
      expect([rel(p), t.includes(MARKER) || /DBTEST/i.test(t)]).toEqual([rel(p), false]);
    }
  });
  it("the ManufacturingStandard registry is never seeded (no invented codes)", () => {
    for (const p of migrations) expect(readFileSync(p, "utf8")).not.toMatch(/INSERT\s+INTO\s+design_os\.manufacturing_variable/i);
  });
  it("seeded variable codes are exactly the engines' declared codes", () => {
    const sql = readFileSync(join(ROOT, "database/migrations/0003_standards.up.sql"), "utf8");
    const block = (table: string): string[] => {
      const start = sql.indexOf(`INSERT INTO design_os.${table}`);
      const end = sql.indexOf(");\n", start);
      return [...sql.slice(start, end).matchAll(/\('([A-Z_]+)',/g)].map((m) => m[1] ?? "").sort();
    };
    expect(block("construction_variable")).toEqual(KITCHEN_BASE_STANDARD_V1.constructionVariables.map((v) => v.key).sort());
    expect(block("planning_variable")).toEqual(PLANNING_VARIABLES.map((v) => v.key).sort());
  });
  it("the database seed folder contains no data", () => {
    expect(readdirSync(join(ROOT, "database/seed"))).toEqual(["README.md"]);
  });
});
