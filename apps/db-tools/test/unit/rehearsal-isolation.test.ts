/** The LOCAL rehearsal marker lives only in the pilot tooling, its tests and the pilot docs — never in migrations, packages or the API. */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const MARKER = ["LOCAL", "REHEARSAL", "ONLY"].join(" ");
const SKIP = new Set(["node_modules", ".git", "dist", "coverage", ".pilot"]);
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  if (SKIP.has(n)) return [];
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|js|sql|json|md)$/.test(n) ? [p] : [];
});

describe("rehearsal data stays local", () => {
  it("the marker appears only in apps/db-tools/src/pilot, tests and docs", () => {
    const allowed = [/^apps\/db-tools\/src\/pilot\//, /^apps\/db-tools\/test\//, /^apps\/api\/test\//, /^docs\//];
    const offenders = files(ROOT).map((p) => relative(ROOT, p).split(sep).join("/"))
      .filter((r) => readFileSync(join(ROOT, r), "utf8").includes(MARKER)).filter((r) => !allowed.some((a) => a.test(r)));
    expect(offenders).toEqual([]);
  });
});
