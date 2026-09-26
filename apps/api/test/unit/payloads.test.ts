/**
 * Stored output payloads reach an engine only as: stored JSON → Zod schema → validated domain object → engine.
 * The content hash (and the engine seal, where the payload has one) is verified too; neither check replaces the other.
 * Payloads here come from the real engines on the synthetic TEST_FIXTURE room (in memory only; never persisted).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contentHash } from "@lintel/persistence";
import type { SnapshotRow } from "@lintel/persistence";
import { LINTEL_CATALOG } from "@lintel/catalog-engine";
import { TEST_FIXTURE_PRICING_RULES, TEST_FIXTURE_QUOTATION_POLICY, TEST_FIXTURE_RATE_CARD, priceRoom, quoteRoom } from "@lintel/pricing-engine";
import type { QuotationSnapshot, RoomPriceSnapshot } from "@lintel/types";
import { ApiProblem } from "../../src/common/errors/api-problem.js";
import type { OutputKind } from "../../src/modules/outputs/output-context.js";
import { producedFrom } from "../../src/modules/outputs/output-generation.js";
import { StoredPayloadError, parseStoredPayload } from "../../src/modules/outputs/payloads.js";
import { fixtureRoom } from "../../../../tests/support/room.js";
import { QUOTED_AT, roomCommercials } from "../../../../tests/support/quotation.js";
import { created as drawn, elevation } from "../../../../tests/support/drawing.js";
import { createdRoom, wallElevation } from "../../../../tests/support/room-drawing.js";

const room = fixtureRoom();
const { roomBom, roomBoq } = roomCommercials(room);
const priced = priceRoom({ mode: "TEST_FIXTURE", room, roomBom, roomBoq, rateCard: TEST_FIXTURE_RATE_CARD, rules: TEST_FIXTURE_PRICING_RULES, createdAt: QUOTED_AT });
if (priced.status !== "PRICED") throw new Error("fixture must price");
const pricing: RoomPriceSnapshot = priced.snapshot;
const quoted = quoteRoom({ mode: "TEST_FIXTURE", room, roomBoq, pricing, policy: TEST_FIXTURE_QUOTATION_POLICY, catalog: LINTEL_CATALOG, revision: "1", createdAt: QUOTED_AT });
if (quoted.status !== "PRICED") throw new Error("fixture must quote");
const quotation: QuotationSnapshot = quoted.snapshot;

const cabinetDrawing = drawn(elevation(room.cabinets[0]!));
const roomDrawing = createdRoom(wallElevation(room, "A"));

const PAYLOADS: Readonly<Record<OutputKind, unknown>> = { BOM: roomBom, BOQ: roomBoq, PRICING: pricing, QUOTATION: quotation, DRAWING: cabinetDrawing };
/** A stored row exactly as the database returns it (JSON round trip), sealed with the payload's content hash. */
const stored = (payload: unknown, hash = contentHash(payload)) => ({ id: "00000000-0000-4000-8000-000000000001", payload: JSON.parse(JSON.stringify(payload)) as unknown, content_hash: hash });
type Path = readonly (string | number)[];
type Edit = { readonly set: unknown } | { readonly delete: true } | { readonly add: number };
/** A copy of a payload with one edit at `path`, re-sealed with a correct content hash (so only the schema or seal can reject it). */
const mutated = (kind: OutputKind, path: Path, edit: Edit) => {
  const p = JSON.parse(JSON.stringify(PAYLOADS[kind])) as Record<string | number, unknown>;
  let node = p;
  for (const k of path.slice(0, -1)) node = node[k] as Record<string | number, unknown>;
  const last = path[path.length - 1] as string | number;
  if ("set" in edit) node[last] = edit.set;
  else if ("delete" in edit) Reflect.deleteProperty(node, last);
  else node[last] = (node[last] as number) + edit.add;
  return stored(p);
};
const del = { delete: true } as const;
const failure = (kind: OutputKind, row: ReturnType<typeof stored>) => {
  try {
    parseStoredPayload(kind, row);
  } catch (e) {
    if (e instanceof StoredPayloadError) return e.reason;
    throw e;
  }
  return "PARSED";
};

describe("stored payload → Zod schema → validated domain object", () => {
  it("a valid stored snapshot of every kind parses to exactly the engine output, deep-frozen", () => {
    for (const kind of ["BOM", "BOQ", "PRICING", "QUOTATION", "DRAWING"] as const) {
      const value = parseStoredPayload(kind, stored(PAYLOADS[kind]));
      expect([kind, value]).toEqual([kind, PAYLOADS[kind]]);
      expect(Object.isFrozen(value)).toBe(true);
    }
    // Both drawing scopes: a cabinet drawing and a room drawing.
    expect(parseStoredPayload("DRAWING", stored(roomDrawing))).toEqual(roomDrawing);
  });
  it("a missing required field is refused", () => {
    expect(failure("BOM", mutated("BOM", ["roomFingerprint"], del))).toBe("SCHEMA");
    expect(failure("PRICING", mutated("PRICING", ["totals", "gst"], del))).toBe("SCHEMA");
    expect(failure("QUOTATION", mutated("QUOTATION", ["lines", 0, "priceSnapshotHash"], del))).toBe("SCHEMA");
  });
  it("a wrong field type is refused", () => {
    expect(failure("BOM", mutated("BOM", ["incomplete"], { set: "no" }))).toBe("SCHEMA");
    expect(failure("BOQ", mutated("BOQ", ["items", 0, "quantity"], { set: "1" }))).toBe("SCHEMA");
    expect(failure("PRICING", mutated("PRICING", ["totals", "sellingPriceExGst"], { set: 10.5 }))).toBe("SCHEMA");
  });
  it("a malformed nested object is refused", () => {
    expect(failure("BOM", mutated("BOM", ["objectBoms", 0, "items", 0], { set: { kind: "PANEL" } }))).toBe("SCHEMA");
    expect(failure("BOQ", mutated("BOQ", ["trace", "objects", 0], { set: { objectId: "x" } }))).toBe("SCHEMA");
    expect(failure("PRICING", mutated("PRICING", ["priceSnapshots", 0, "rateCard"], { set: null }))).toBe("SCHEMA");
    expect(failure("QUOTATION", mutated("QUOTATION", ["policy", "rounding"], { set: { tax: { mode: "HALF_UP" } } }))).toBe("SCHEMA");
  });
  it("an unexpected enum value or an unknown field is refused", () => {
    expect(failure("BOM", mutated("BOM", ["totals", 0, "unit"], { set: "KG" }))).toBe("SCHEMA");
    expect(failure("BOM", mutated("BOM", ["objectBoms", 0, "items", 0, "kind"], { set: "GLUE" }))).toBe("SCHEMA");
    expect(failure("PRICING", mutated("PRICING", ["classification"], { set: "DEMO" }))).toBe("SCHEMA");
    expect(failure("QUOTATION", mutated("QUOTATION", ["policy", "taxPolicy"], { set: "PER_ITEM" }))).toBe("SCHEMA");
    expect(failure("BOQ", mutated("BOQ", ["latest"], { set: true }))).toBe("SCHEMA");
  });
  it("a tampered payload (content changed after sealing) is refused by the content hash", () => {
    // Sealed first, then changed (the stored hash is the original payload's).
    const row = { ...mutated("BOM", ["objectBoms", 0, "items", 0, "quantity"], { add: 1 }), content_hash: contentHash(PAYLOADS.BOM) };
    expect(failure("BOM", row)).toBe("CONTENT_HASH");
  });
  it("a schema-valid payload with another snapshot's content hash is refused", () => {
    expect(failure("BOQ", stored(PAYLOADS.BOQ, contentHash(PAYLOADS.BOM)))).toBe("CONTENT_HASH");
    expect(failure("PRICING", stored(PAYLOADS.PRICING, `sha256:${"0".repeat(64)}`))).toBe("CONTENT_HASH");
  });
  it("a schema-valid payload re-sealed with a matching content hash but a broken engine seal is refused", () => {
    expect(failure("PRICING", mutated("PRICING", ["totals", "margin"], { add: 1 }))).toBe("ENGINE_SEAL");
    expect(failure("QUOTATION", mutated("QUOTATION", ["totals", "grandTotal"], { add: 100 }))).toBe("ENGINE_SEAL");
    expect(failure("DRAWING", mutated("DRAWING", ["titleBlock", "checker"], { set: "someone else" }))).toBe("ENGINE_SEAL");
  });
  it("a malformed drawing (bad primitive, unknown layer, wrong sheet) is refused", () => {
    expect(failure("DRAWING", mutated("DRAWING", ["sheets", 0, "primitives", 0, "layer"], { set: "GLOW" }))).toBe("SCHEMA");
    expect(failure("DRAWING", mutated("DRAWING", ["sheets", 0, "primitives", 0], { set: { kind: "arc" } }))).toBe("SCHEMA");
    expect(failure("DRAWING", mutated("DRAWING", ["sheets", 0, "paper", "name"], { set: "A4" }))).toBe("SCHEMA");
  });
  it("in the API a failing stored payload is a 500 STORED_OUTPUT_INVALID problem, never an engine input", () => {
    const row = { ...mutated("BOM", ["incomplete"], { set: "no" }), kind: "BOM" } as unknown as SnapshotRow;
    let problem: unknown;
    try {
      producedFrom(row, false);
    } catch (e) {
      problem = e;
    }
    expect(problem).toBeInstanceOf(ApiProblem);
    expect([(problem as ApiProblem).code, (problem as ApiProblem).status, (problem as ApiProblem).options.context?.reason]).toEqual(["STORED_OUTPUT_INVALID", 500, "SCHEMA"]);
  });
  it("no outputs-module code casts a stored payload to an engine type", () => {
    const dir = join(resolve(dirname(fileURLToPath(import.meta.url)), "../../src/modules/outputs"));
    for (const f of ["output-generation.ts", "outputs.service.ts", "staleness.ts", "output-context.ts"]) {
      expect([f, /\.payload\s+as\b/.test(readFileSync(join(dir, f), "utf8"))]).toEqual([f, false]);
    }
  });
});
