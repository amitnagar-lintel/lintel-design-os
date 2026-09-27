/** The pilot tools can never reach staging / production by accident; the rehearsal dataset never passes as anything else. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateIntake } from "../../src/intake/spec.js";
import { classify } from "../../src/pilot/environment.js";
import { REHEARSAL_MARKER, rehearsalDataset } from "../../src/pilot/rehearsal-dataset.js";
import { assertRehearsalDatabase } from "../../src/pilot/rehearsal.js";
import { templateReports, templatesReadme } from "../../src/pilot/templates.js";

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "docs", "pilot", "intake-templates");

const LOCAL_DB = "postgresql://postgres@127.0.0.1:5432/lintel_rehearsal";
const HOSTED = "postgresql://postgres:pw@db.abcdefghijklmnop.supabase.co:5432/postgres";

describe("pilot environment classification", () => {
  it("defaults to LOCAL and accepts only loopback database, API and UI there", () => {
    expect(classify({ MIGRATION_DATABASE_URL: LOCAL_DB }, undefined)).toMatchObject({ env: "LOCAL", database: "127.0.0.1:5432/lintel_rehearsal", apiUrl: "http://127.0.0.1:3000" });
    expect(() => classify({ MIGRATION_DATABASE_URL: HOSTED }, undefined)).toThrow(/not on this machine/);
    expect(() => classify({ MIGRATION_DATABASE_URL: LOCAL_DB, PILOT_API_URL: "https://api.lintel.example" }, undefined)).toThrow(/PILOT_ENV/);
    expect(() => classify({ PILOT_WEB_URL: "https://app.lintel.example" }, undefined)).toThrow(/UI/);
  });
  it("STAGING / PRODUCTION need the direct connection and --confirm of exactly that database, and non-loopback URLs", () => {
    const e = { PILOT_ENV: "production", MIGRATION_DATABASE_URL: HOSTED, PILOT_API_URL: "https://api.lintel.example", PILOT_WEB_URL: "https://app.lintel.example" };
    expect(() => classify(e, undefined)).toThrow(/--confirm abcdefghijklmnop/);
    expect(() => classify(e, "otherref")).toThrow(/does not match/);
    expect(classify(e, "abcdefghijklmnop")).toMatchObject({ env: "PRODUCTION", databaseHosted: true });
    expect(() => classify({ ...e, MIGRATION_DATABASE_URL: "postgresql://postgres.abcdefghijklmnop:pw@aws-0-x.pooler.supabase.com:6543/postgres" }, "abcdefghijklmnop")).toThrow(/pooler/);
    expect(() => classify({ ...e, PILOT_API_URL: "http://127.0.0.1:3000" }, "abcdefghijklmnop")).toThrow(/loopback/);
    expect(() => classify({ PILOT_ENV: "staging" }, "x")).toThrow(/MIGRATION_DATABASE_URL/);
    expect(() => classify({ PILOT_ENV: "prod" }, undefined)).toThrow(/PILOT_ENV must be/);
  });
});

describe("rehearsal isolation", () => {
  it("the rehearsal runs only on a loopback lintel_rehearsal* database", () => {
    expect(assertRehearsalDatabase(LOCAL_DB)).toEqual({ host: "127.0.0.1", database: "lintel_rehearsal" });
    expect(() => assertRehearsalDatabase(HOSTED)).toThrow(/loopback/);
    expect(() => assertRehearsalDatabase("postgresql://postgres@127.0.0.1:5432/postgres")).toThrow(/lintel_rehearsal/);
    expect(() => assertRehearsalDatabase("postgresql://postgres@10.0.0.5:5432/lintel_rehearsal")).toThrow(/loopback/);
  });
  it("every rehearsal file is a valid intake file that names itself as rehearsal data", () => {
    const files = rehearsalDataset();
    expect(files.length).toBe(22);
    for (const f of files) {
      const v = validateIntake(JSON.stringify(f.file));
      expect([f.type, f.entityCode, v.accepted, v.findings]).toEqual([f.type, f.entityCode, true, []]);
      expect(String(f.file.source)).toContain(REHEARSAL_MARKER);
      expect(f.author).not.toBe(f.approver);
    }
  });
});

describe("production intake templates", () => {
  it("are valid WORKING_DRAFT intake files that invent nothing, and the committed copies are current (pnpm pilot:templates)", () => {
    const reports = templateReports();
    for (const r of reports) {
      expect([r.template.name, r.accepted, r.errors]).toEqual([r.template.name, true, []]);
      expect(r.template.file.intent).toBe("WORKING_DRAFT");
      expect(JSON.stringify(r.template.file)).not.toContain(REHEARSAL_MARKER);
      expect(readFileSync(join(TEMPLATES, r.template.name), "utf8")).toBe(`${JSON.stringify(r.template.file, null, 2)}\n`);
    }
    expect(readFileSync(join(TEMPLATES, "README.md"), "utf8")).toBe(templatesReadme(reports));
  });
});
