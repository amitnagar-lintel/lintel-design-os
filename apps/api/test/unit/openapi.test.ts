/**
 * OpenAPI 3.1 (Step 6 plan §17): generated from the route table and the Zod schemas; the committed document must be
 * exactly what the code generates (drift check), every route must be documented, and the document must be
 * internally consistent (path parameters, $refs, unique operation ids, access metadata).
 */
import "reflect-metadata";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FEATURE_MODULES } from "../../src/app.js";
import { routesOf } from "../../src/openapi/document.js";
import { OPENAPI_PATH, openApiJson } from "../../src/openapi/openapi-file.js";

type Json = Record<string, unknown>;
const generated = openApiJson();
const doc = JSON.parse(generated) as { openapi: string; paths: Record<string, Record<string, Json>>; components: { schemas: Record<string, Json> } };
const operations = Object.entries(doc.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ path, method, op })));

describe("OpenAPI document", () => {
  it("is up to date: the committed apps/api/openapi/openapi.json equals the generated document (run `pnpm api:openapi`)", () => {
    expect(readFileSync(OPENAPI_PATH, "utf8") === generated, "apps/api/openapi/openapi.json is out of date: run `pnpm api:openapi` and commit it").toBe(true);
  });

  it("documents every route of every feature module (an undocumented route fails generation)", () => {
    const routes = routesOf(FEATURE_MODULES);
    expect(routes.filter((r) => r.doc === undefined).map((r) => `${r.controller}.${r.handler}`)).toEqual([]);
    expect(operations).toHaveLength(routes.length);
  });

  it("is OpenAPI 3.1 and internally consistent: path parameters declared, $refs resolve, operation ids unique", () => {
    expect(doc.openapi).toBe("3.1.0");
    const ids = operations.map((o) => o.op.operationId as string);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { path, method, op } of operations) {
      const declared = ((op.parameters ?? []) as { name: string; in: string }[]).filter((p) => p.in === "path").map((p) => p.name).sort();
      const inPath = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]).sort();
      expect([`${method.toUpperCase()} ${path}`, declared]).toEqual([`${method.toUpperCase()} ${path}`, inPath]);
      expect(Object.keys(op.responses as Json)).toContain("default");
    }
    const refs = [...generated.matchAll(/"\$ref": "#\/components\/schemas\/([^"]+)"/g)].map((m) => m[1] as string);
    expect(refs.filter((r) => doc.components.schemas[r] === undefined)).toEqual([]);
  });

  it("carries access, identity and HTTP preconditions", () => {
    const op = (method: string, path: string) => doc.paths[path]?.[method] as Json & { parameters?: { name: string; in: string; required: boolean }[] };
    const drawing = op("post", "/api/v1/design-versions/{versionId}/drawing-snapshots");
    expect(drawing["x-lintel-access"]).toEqual({ actions: ["output.generate.engineering"] });
    expect(drawing.parameters?.find((p) => p.name === "Idempotency-Key")).toMatchObject({ in: "header", required: true });
    expect(op("patch", "/api/v1/clients/{clientId}").parameters?.find((p) => p.name === "If-Match")).toMatchObject({ required: true });
    const content = op("get", "/api/v1/file-content/{path}");
    expect([content.security, content["x-lintel-access"], content["x-lintel-identity"]]).toEqual([[], { kind: "public" }, "ANY"]);
    expect(op("get", "/api/v1/files/{fileId}/url")["x-lintel-identity"]).toBe("ANY");
    const runs = op("get", "/api/v1/design-versions/{versionId}/validation-runs").parameters?.find((p) => p.name === "purpose");
    expect(runs).toMatchObject({ in: "query", required: false, schema: { enum: ["APPROVAL", "OUTPUT_GENERATION"] } });
    for (const path of ["/api/v1/design-versions/{versionId}/outputs", "/api/v1/drawing-snapshots/{snapshotId}/files", "/api/v1/drawing-snapshots/{snapshotId}/staleness"]) {
      expect([path, Object.keys(doc.paths[path] ?? {})]).toEqual([path, ["get"]]);
    }
    // Issue (checkpoint 4) is documented; manufacturing stays deferred and absent (OD-S6-1).
    expect(Object.keys(doc.paths).filter((p) => p.endsWith("/issue")).sort()).toEqual(["/api/v1/drawing-snapshots/{snapshotId}/issue", "/api/v1/quotation-snapshots/{snapshotId}/issue"]);
    expect(op("post", "/api/v1/quotation-snapshots/{snapshotId}/issue")["x-lintel-access"]).toEqual({ actions: ["quotation.issue"] });
    expect(op("post", "/api/v1/drawing-snapshots/{snapshotId}/issue")["x-lintel-access"]).toEqual({ actions: ["drawing.issue"] });
    expect(Object.keys(doc.paths).filter((p) => /manufacturing/.test(p))).toEqual([]);
  });
});
