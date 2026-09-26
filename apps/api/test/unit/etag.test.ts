/** ETags (OD-3): deterministic canonical hashes, strong version tags, and lifecycle-before-ETag preconditions. */
import { describe, expect, it } from "vitest";
import type { ApiProblem } from "../../src/common/errors/api-problem.js";
import { assertWritable, canonicalRecord, canonicalValue, parseIfMatch, recordEtag, versionEtag } from "../../src/common/http/etag.js";

const CLIENT = {
  id: "5B1B0E0C-8B5E-4E1F-9C1A-2B7C0D2E3F40",
  org_id: "0c7f3f5e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
  client_code: "C_001",
  name: "Mehta Residence",
  contact: { phone: "+91 00000 00000", email: "client@example.test" },
  ops_client_ref: null,
  ops_lead_ref: "LEAD-42",
  created_at: "2026-09-26 10:00:00.5+00",
};

function problem(fn: () => void): ApiProblem {
  try {
    fn();
  } catch (e) {
    return e as ApiProblem;
  }
  throw new Error("expected a problem");
}

describe("canonical record ETags", () => {
  it("are identical whatever the key order of the row or its JSON values", () => {
    const reordered = Object.fromEntries(Object.entries(CLIENT).reverse().map(([k, v]) => [k, k === "contact" ? { email: "client@example.test", phone: "+91 00000 00000" } : v]));
    expect(recordEtag("client", reordered)).toBe(recordEtag("client", CLIENT));
  });
  it("normalize uuids, timestamps (UTC, microseconds) and integers", () => {
    expect(canonicalValue("5B1B0E0C-8B5E-4E1F-9C1A-2B7C0D2E3F40")).toBe("5b1b0e0c-8b5e-4e1f-9c1a-2b7c0d2e3f40");
    expect(canonicalValue("2026-09-26 10:00:00.5+00")).toBe("2026-09-26T10:00:00.500000Z");
    expect(canonicalValue("2026-09-26 10:00:00+00")).toBe("2026-09-26T10:00:00.000000Z");
    expect(canonicalValue("2026-09-26T10:00:00.123456Z")).toBe("2026-09-26T10:00:00.123456Z");
    expect(() => canonicalValue("2026-09-26 15:30:00+05:30")).toThrow(/UTC/);
    expect(() => canonicalValue(new Date())).toThrow(/text/);
    expect(canonicalValue(42)).toBe("42");
    expect(canonicalValue(undefined)).toBeNull();
  });
  it("use only the allow-listed columns; an extra column never changes the ETag, a missing one is an error", () => {
    expect(recordEtag("client", { ...CLIENT, some_future_column: "x" })).toBe(recordEtag("client", CLIENT));
    const partial: Record<string, unknown> = { ...CLIENT };
    delete partial.ops_lead_ref;
    expect(() => canonicalRecord("client", partial)).toThrow(/ops_lead_ref/);
  });
  it("change when any mutable value changes", () => {
    expect(recordEtag("client", { ...CLIENT, name: "Mehta Residence 2" })).not.toBe(recordEtag("client", CLIENT));
    expect(recordEtag("client", { ...CLIENT, contact: { ...CLIENT.contact, phone: "x" } })).not.toBe(recordEtag("client", CLIENT));
  });
  it("golden: the canonical form and hash of a fixed row are pinned", () => {
    expect(canonicalRecord("client", CLIENT)).toEqual({
      id: "5b1b0e0c-8b5e-4e1f-9c1a-2b7c0d2e3f40", org_id: "0c7f3f5e-1a2b-4c3d-8e9f-0a1b2c3d4e5f", client_code: "C_001", name: "Mehta Residence",
      contact: { phone: "+91 00000 00000", email: "client@example.test" }, ops_client_ref: null, ops_lead_ref: "LEAD-42", created_at: "2026-09-26T10:00:00.500000Z",
    });
    expect(recordEtag("client", CLIENT)).toBe('"sha256:53cc733b0cbdd82f427db153f2181df62ceb62f90001aa25b922de46d6a96d39"');
  });
});

describe("version ETags and If-Match", () => {
  it("version ETags are strong: \"<id>:<row_version>\"", () => {
    expect(versionEtag("5B1B0E0C-8B5E-4E1F-9C1A-2B7C0D2E3F40", 3)).toBe('"5b1b0e0c-8b5e-4e1f-9c1a-2b7c0d2e3f40:3"');
    expect(() => versionEtag("x", 0)).toThrow();
  });
  it("If-Match parsing: *, lists, and weak tags (which never match strongly)", () => {
    expect(parseIfMatch(undefined)).toBeNull();
    expect(parseIfMatch(" ")).toBeNull();
    expect(parseIfMatch("*")).toBe("*");
    expect(parseIfMatch('"a", W/"b", "c"')).toEqual(['"a"', '"c"']);
  });
  it("lifecycle is checked before the ETag: LOCKED / non-DRAFT refuse even a correct ETag", () => {
    const tag = '"id:4"';
    expect(problem(() => { assertWritable({ ifMatch: tag, currentEtag: tag, lifecycle: "LOCKED" }); }).code).toBe("RECORD_LOCKED");
    expect(problem(() => { assertWritable({ ifMatch: tag, currentEtag: tag, lifecycle: "IN_REVIEW" }); }).code).toBe("RECORD_NOT_EDITABLE");
    expect(problem(() => { assertWritable({ ifMatch: undefined, currentEtag: tag, lifecycle: "APPROVED" }); }).code).toBe("RECORD_NOT_EDITABLE");
  });
  it("missing If-Match → 428; stale → 412 with the current ETag; match or * → ok", () => {
    expect(problem(() => { assertWritable({ ifMatch: undefined, currentEtag: '"x"' }); }).code).toBe("PRECONDITION_REQUIRED");
    const stale = problem(() => { assertWritable({ ifMatch: '"old"', currentEtag: '"new"', lifecycle: "DRAFT" }); });
    expect([stale.code, stale.status, stale.options.context, stale.options.headers]).toEqual(["STALE_VERSION", 412, { currentEtag: '"new"' }, { etag: '"new"' }]);
    expect(problem(() => { assertWritable({ ifMatch: 'W/"new"', currentEtag: '"new"' }); }).code).toBe("STALE_VERSION");
    expect(() => { assertWritable({ ifMatch: '"new"', currentEtag: '"new"', lifecycle: "DRAFT" }); }).not.toThrow();
    expect(() => { assertWritable({ ifMatch: "*", currentEtag: '"new"' }); }).not.toThrow();
  });
});
