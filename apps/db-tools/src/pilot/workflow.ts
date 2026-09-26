/**
 * The pilot workflow over the public API (M6 STEP 6 rehearsal): Project → rectangular kitchen → KIT_BASE_STANDARD
 * base run → DesignVersion → validation → approval → BOM → BOQ → Pricing → Quotation → Drawings → Issue → PDF.
 *
 * It speaks HTTP only (the same routes the pilot UI uses) and computes nothing itself: every number comes from the
 * API's engines. It then proves that every output derives from the SAME design version, the same engineering inputs
 * (input hash, exact pins, dependency hashes) and the same room resolution as the resolved-model preview.
 */
import { createHash, randomUUID } from "node:crypto";

export interface HttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: unknown;
  readonly bytes: Uint8Array;
}
export type Http = (method: "GET" | "POST" | "PATCH" | "DELETE", path: string, o?: { readonly token?: string; readonly body?: unknown; readonly headers?: Record<string, string> }) => Promise<HttpResponse>;

/** An HTTP client over fetch (the rehearsal CLI); `base` is the API origin, e.g. http://127.0.0.1:3000. */
export function fetchHttp(base: string): Http {
  return async (method, path, o = {}) => {
    const headers: Record<string, string> = { ...o.headers };
    if (o.token !== undefined) headers.authorization = `Bearer ${o.token}`;
    if (o.body !== undefined) headers["content-type"] = "application/json";
    const url = path.startsWith("http") ? path : `${base.replace(/\/+$/, "")}${path}`;
    const r = await fetch(url, { method, headers, ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }) });
    const bytes = new Uint8Array(await r.arrayBuffer());
    const type = r.headers.get("content-type") ?? "";
    let body: unknown = null;
    if (/json/.test(type) && bytes.byteLength > 0) body = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    return { status: r.status, headers: Object.fromEntries(r.headers.entries()), body, bytes };
  };
}

export class WorkflowError extends Error {
  constructor(readonly step: string, message: string, readonly response?: unknown) {
    super(`${step}: ${message}`);
    this.name = "WorkflowError";
  }
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v !== null && typeof v === "object" ? v as Json : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const ENGINEERING_PINS = ["construction_standard_version_id", "planning_standard_version_id", "edge_band_standard_version_id", "material_catalog_version_id",
  "finish_catalog_version_id", "hardware_catalog_version_id", "product_catalog_version_id", "hettich_dataset_version_id", "appliance_catalog_version_id"];
const idem = () => ({ "idempotency-key": randomUUID() });

export type PilotRole = "ADMIN" | "SALES" | "SITE_ENGINEER" | "DESIGNER" | "DESIGN_HEAD" | "COSTING" | "FINANCE" | "PRODUCTION" | "PROCUREMENT";
export type Tokens = Readonly<Record<PilotRole, string>>;

export interface PilotInput {
  readonly clientName: string;
  readonly projectName: string;
  readonly codeSuffix: string;
  readonly room: { readonly lengthMm: number; readonly widthMm: number; readonly heightMm: number; readonly wallThicknessMm: number };
  /** Cabinet widths along wall A, left to right, arranged edge to edge from x = 0. */
  readonly cabinetWidths: readonly number[];
}

export const REHEARSAL_INPUT: PilotInput = {
  clientName: "Rehearsal client (test fixture)", projectName: "Rehearsal kitchen (test fixture)", codeSuffix: "",
  room: { lengthMm: 4200, widthMm: 3200, heightMm: 3000, wallThicknessMm: 150 },
  cabinetWidths: [600, 750, 600],
};

export interface PilotReport {
  readonly projectId: string;
  readonly roomId: string;
  readonly designId: string;
  readonly designVersionId: string;
  readonly designStatus: string;
  readonly inputHash: string;
  readonly pins: Json;
  readonly modelFingerprint: string;
  readonly validation: { readonly runId: string; readonly blockers: number; readonly warnings: number };
  readonly outputs: Readonly<Record<string, { readonly id: string; readonly contentHash: string; readonly blockers: number }>>;
  readonly quotation: { readonly grandTotal: unknown; readonly currency: unknown };
  readonly issued: { readonly quotation: string; readonly drawings: readonly string[] };
  readonly pdfs: readonly { readonly drawingNumber: string; readonly fileId: string; readonly bytes: number; readonly sha256: string; readonly checksumVerified: boolean }[];
  /** Each proof of "one DesignVersion, one execution context, exact pins": name → true. */
  readonly consistency: Readonly<Record<string, boolean>>;
}

/** Latest APPROVED / LOCKED version of each pinned type (the organization's usable reference data). */
export async function usablePins(http: Http, token: string): Promise<Json> {
  const pin: [string, string][] = [
    ["constructionStandardVersionId", "construction_standard"], ["planningStandardVersionId", "planning_standard"], ["edgeBandStandardVersionId", "edge_band_standard"],
    ["materialCatalogVersionId", "material_catalog"], ["finishCatalogVersionId", "finish_catalog"], ["hardwareCatalogVersionId", "hardware_catalog"],
    ["productCatalogVersionId", "product_catalog"], ["hettichDatasetVersionId", "hettich_dataset"],
  ];
  const out: Json = {};
  for (const [name, type] of pin) {
    const r = await http("GET", `/api/v1/reference-data/${type}/versions?status=APPROVED,LOCKED&limit=100`, { token });
    const items = (obj(r.body).items as Json[] | undefined) ?? [];
    const best = [...items].sort((a, b) => Number(b.versionNumber) - Number(a.versionNumber))[0];
    if (r.status !== 200 || best === undefined) throw new WorkflowError("pins", `no APPROVED / LOCKED ${type} version`, r.body);
    out[name] = best.id;
  }
  return out;
}

export async function commercialVersion(http: Http, token: string, type: "pricing_standard" | "quotation_policy"): Promise<string> {
  const r = await http("GET", `/api/v1/reference-data/${type}/versions?status=APPROVED,LOCKED&limit=100`, { token });
  const best = [...((obj(r.body).items as Json[] | undefined) ?? [])].sort((a, b) => Number(b.versionNumber) - Number(a.versionNumber))[0];
  if (best === undefined) throw new WorkflowError("commercial", `no APPROVED / LOCKED ${type} version`, r.body);
  return str(best.id);
}

export async function runPilotWorkflow(http: Http, t: Tokens, input: PilotInput = REHEARSAL_INPUT, log: (line: string) => void = () => undefined): Promise<PilotReport> {
  const call = async (step: string, expect: number, method: "GET" | "POST" | "PATCH" | "DELETE", path: string, token: string, body?: unknown, headers?: Record<string, string>): Promise<HttpResponse> => {
    const r = await http(method, path, { token, ...(body === undefined ? {} : { body }), ...(headers === undefined ? {} : { headers }) });
    if (r.status !== expect) throw new WorkflowError(step, `HTTP ${String(r.status)} (expected ${String(expect)})`, r.body);
    log(`ok  ${step}`);
    return r;
  };
  const suffix = input.codeSuffix === "" ? randomUUID().slice(0, 8).toUpperCase() : input.codeSuffix;

  // 1. Project (SALES) with its client; the designer and site engineer are project members.
  const client = obj((await call("client", 201, "POST", "/api/v1/clients", t.SALES, { clientCode: `CL-${suffix}`, name: input.clientName })).body);
  const project = obj((await call("project", 201, "POST", "/api/v1/projects", t.SALES, { clientId: client.id, projectCode: `PR-${suffix}`, name: input.projectName })).body);
  const projectId = str(project.id);
  const me = async (token: string) => str(obj((await call("me", 200, "GET", "/api/v1/me", token)).body).userId);
  for (const role of ["DESIGNER", "SITE_ENGINEER", "DESIGN_HEAD", "COSTING"] as const) {
    await call(`project member ${role}`, 201, "POST", `/api/v1/projects/${projectId}/members`, t.SALES, { userId: await me(t[role]), role });
  }

  // 2. Rectangular kitchen, no openings (SITE_ENGINEER survey).
  const room = obj((await call("room", 201, "POST", `/api/v1/projects/${projectId}/rooms`, t.SITE_ENGINEER, { name: "Kitchen", roomType: "KITCHEN", initialSurvey: { ...input.room, source: "Pilot survey" } }, idem())).body);
  const roomId = str(room.id);

  // 3. Design, DesignVersion pinned to the usable reference data, base cabinet run on wall A.
  const design = obj((await call("design", 201, "POST", `/api/v1/rooms/${roomId}/designs`, t.DESIGNER, { name: "Kitchen design" }, idem())).body);
  const pins = await usablePins(http, t.DESIGNER);
  const version = obj((await call("design version", 201, "POST", `/api/v1/designs/${str(design.id)}/versions`, t.DESIGNER, { pins, changeReason: "Pilot design" }, idem())).body);
  const versionId = str(version.id);
  const productVersionId = await productVersionOf(http, t.DESIGNER, str(pins.productCatalogVersionId), "KIT_BASE_STANDARD");
  if (productVersionId === null) throw new WorkflowError("product", "KIT_BASE_STANDARD is not in the pinned product catalog");
  let x = 0;
  for (const [i, width] of input.cabinetWidths.entries()) {
    const etag = (await call("etag", 200, "GET", `/api/v1/design-versions/${versionId}`, t.DESIGNER)).headers.etag ?? "";
    await call(`cabinet ${String(i + 1)}`, 201, "POST", `/api/v1/design-versions/${versionId}/objects`, t.DESIGNER, {
      objectCode: `BC-${String(i + 1).padStart(3, "0")}`, objectType: "BASE_CABINET", productCode: "KIT_BASE_STANDARD", productVersionId,
      position: { xMm: x, yMm: 0, zMm: 0 }, rotationY: 0, dimensions: { widthMm: width, heightMm: 720, depthMm: 560 }, parameters: {},
    }, { "if-match": etag });
    x += width;
  }

  // 4. Resolved model (the 2D preview's source) and the APPROVAL validation run.
  const model = obj((await call("model", 200, "GET", `/api/v1/design-versions/${versionId}/model`, t.DESIGNER)).body);
  const mv = obj(model.validation);
  if (Number(obj(mv.counts).BLOCKER) !== 0) throw new WorkflowError("model", "the resolved model has BLOCKERs", mv.messages);
  const run = obj((await call("validation run", 201, "POST", `/api/v1/design-versions/${versionId}/validation-runs`, t.DESIGNER, {}, idem())).body);
  if (Number(run.blockerCount) !== 0) throw new WorkflowError("validation", `${String(run.blockerCount)} BLOCKERs`, run);

  // 5. Lifecycle: SUBMIT (designer) → APPROVE (design head, reviewed hash) → LOCK (sales).
  const transition = async (action: string, token: string) => {
    const v = await call("etag", 200, "GET", `/api/v1/design-versions/${versionId}`, token);
    const body = { action, reason: `Pilot ${action.toLowerCase()}`, ...(action === "APPROVE" ? { expectedContentHash: obj(v.body).contentHash } : {}) };
    await call(`transition ${action}`, 200, "POST", `/api/v1/design-versions/${versionId}/transitions`, token, body, { "if-match": v.headers.etag ?? "", ...idem() });
  };
  await transition("SUBMIT", t.DESIGNER);
  await transition("APPROVE", t.DESIGN_HEAD);
  await transition("LOCK", t.SALES);

  // 6. FOR_PRODUCTION outputs. Pricing and quotation name the exact commercial versions.
  const pricingStandardVersionId = await commercialVersion(http, t.COSTING, "pricing_standard");
  const quotationPolicyVersionId = await commercialVersion(http, t.COSTING, "quotation_policy");
  const generate = async (kind: string, token: string, body: Json) => {
    const r = await http("POST", `/api/v1/design-versions/${versionId}/${kind}-snapshots`, { token, body: { purpose: "FOR_PRODUCTION", ...body }, headers: idem() });
    if (r.status !== 201 && r.status !== 200) throw new WorkflowError(`generate ${kind}`, `HTTP ${String(r.status)} ${JSON.stringify(r.body)}`, r.body);
    const g = obj(r.body);
    const s = obj(g.snapshot);
    if (g.status !== "AVAILABLE" || s.id === undefined) throw new WorkflowError(`generate ${kind}`, `status ${str(g.status)}`, g);
    log(`ok  generate ${kind}${g.reused === true ? " (reused)" : ""}`);
    return s;
  };
  const bom = await generate("bom", t.DESIGNER, {});
  const boq = await generate("boq", t.DESIGNER, {});
  const pricing = await generate("pricing", t.COSTING, { pricingStandardVersionId });
  const quotation = await generate("quotation", t.COSTING, { pricingStandardVersionId, quotationPolicyVersionId });
  const drawings = [
    await generate("drawing", t.DESIGNER, { drawingType: "WALL_INTERNAL_ELEVATION", wallId: "A", drawingNumber: `PILOT-${suffix}-A`, drawingRevision: "A" }),
    await generate("drawing", t.DESIGNER, { drawingType: "ROOM_PANEL_SCHEDULE", drawingNumber: `PILOT-${suffix}-PS`, drawingRevision: "A" }),
  ];

  // 7. Issue (existing issue workflow): quotation by SALES, drawings by DESIGN_HEAD.
  await call("issue quotation", 201, "POST", `/api/v1/quotation-snapshots/${str(quotation.id)}/issue`, t.SALES,
    { reason: "Pilot rehearsal issue", expectedContentHash: quotation.contentHash, pricingStandardVersionId, quotationPolicyVersionId }, idem());
  for (const d of drawings) await call("issue drawing", 201, "POST", `/api/v1/drawing-snapshots/${str(d.id)}/issue`, t.DESIGN_HEAD, { reason: "Pilot rehearsal issue", expectedContentHash: d.contentHash }, idem());

  // 8. Issued PDFs: signed download URL → bytes → checksum against the stored manifest.
  const pdfs: { drawingNumber: string; fileId: string; bytes: number; sha256: string; checksumVerified: boolean }[] = [];
  for (const d of drawings) {
    const files = (obj((await call("drawing files", 200, "GET", `/api/v1/drawing-snapshots/${str(d.id)}/files`, t.DESIGNER)).body).items as Json[] | undefined) ?? [];
    const pdf = files.find((f) => f.format === "PDF" || f.contentType === "application/pdf");
    if (pdf === undefined) throw new WorkflowError("pdf", "the issued drawing has no PDF", files);
    const url = obj((await call("file url", 200, "GET", `/api/v1/files/${str(pdf.fileId)}/url?disposition=attachment`, t.DESIGNER)).body);
    const got = await http("GET", str(url.url));
    const sha = `sha256:${createHash("sha256").update(got.bytes).digest("hex")}`;
    const head = new TextDecoder().decode(got.bytes.slice(0, 5));
    if (got.status !== 200 || head !== "%PDF-") throw new WorkflowError("pdf", `download HTTP ${String(got.status)}, starts with ${head}`);
    pdfs.push({ drawingNumber: str(obj(d.drawing).drawingNumber), fileId: str(pdf.fileId), bytes: got.bytes.byteLength, sha256: sha, checksumVerified: sha === str(pdf.checksum) });
  }
  log("ok  PDFs downloaded");

  // 9. Consistency: one DesignVersion, one input hash, exact pins, same dependency set, same room resolution.
  const final = obj((await call("design version", 200, "GET", `/api/v1/design-versions/${versionId}`, t.DESIGNER)).body);
  const locked = obj((await call("model (locked)", 200, "GET", `/api/v1/design-versions/${versionId}/model`, t.DESIGNER)).body);
  const all = { bom, boq, pricing, quotation, drawingA: drawings[0] ?? {}, drawingPS: drawings[1] ?? {} };
  const list = Object.values(all);
  const same = (f: (s: Json) => unknown) => new Set(list.map((s) => JSON.stringify(f(s)))).size === 1;
  const quotationPayload = obj(quotation.payload);
  const consistency: Record<string, boolean> = {
    "every output names this DesignVersion": list.every((s) => s.designVersionId === versionId),
    "every output was made from the LOCKED version": list.every((s) => s.designVersionStatus === "LOCKED"),
    "same design content hash": same((s) => s.designVersionContentHash),
    "same engineering input hash as the version": list.every((s) => obj(s.input).hash === final.inputHash),
    "same exact engineering pins as the version": list.every((s) => Object.entries(pins).every(([k, v]) => obj(s.engineeringPins)[k] === v)),
    "same engineering dependency content hashes": same((s) => Object.fromEntries(Object.entries(obj(s.dependencyHashes)).filter(([k]) => ENGINEERING_PINS.includes(k)).sort())),
    "same OUTPUT_GENERATION validation evidence (0 BLOCKERs)": list.every((s) => Number(obj(s.validationRun).blockerCount) === 0),
    "every output resolved the same room as the resolved-model preview": list.every((s) => (obj(s.payload).roomFingerprint ?? obj(s.payload).modelFingerprint) === locked.modelFingerprint),
    "the preview shows the same objects before and after approval": JSON.stringify(locked.objects) === JSON.stringify(model.objects),
    "quotation uses the exact pricing standard and quotation policy": obj(quotation.commercial).pricingStandardVersionId === pricingStandardVersionId && obj(quotation.commercial).quotationPolicyVersionId === quotationPolicyVersionId,
    "no output has BLOCKERs": list.every((s) => Number(s.blockerCount) === 0),
    "the quotation and drawings qualify for issue": [quotation, ...drawings].every((s) => s.qualifiesForIssue === true),
    "every issued PDF matches its stored checksum": pdfs.every((p) => p.checksumVerified),
  };
  const failed = Object.entries(consistency).filter(([, ok]) => !ok).map(([k]) => k);
  if (failed.length > 0) throw new WorkflowError("consistency", failed.join("; "), all);
  log("ok  consistency");

  return {
    projectId, roomId, designId: str(design.id), designVersionId: versionId, designStatus: str(final.status), inputHash: str(final.inputHash), pins,
    modelFingerprint: str(locked.modelFingerprint),
    validation: { runId: str(run.id), blockers: Number(run.blockerCount), warnings: Number(run.warningCount) },
    outputs: Object.fromEntries(Object.entries(all).map(([k, s]) => [k, { id: str(s.id), contentHash: str(s.contentHash), blockers: Number(s.blockerCount) }])),
    quotation: { grandTotal: quotationPayload.grandTotal ?? obj(quotationPayload.totals).grandTotal ?? null, currency: quotationPayload.currency ?? null },
    issued: { quotation: str(quotation.id), drawings: drawings.map((d) => str(d.id)) },
    pdfs, consistency,
  };
}

/** The exact version of a product (by code) that a product catalog version lists, or null. Reads the reference-data API only. */
export async function productVersionOf(http: Http, token: string, productCatalogVersionId: string, productCode: string): Promise<string | null> {
  const entities = obj((await http("GET", `/api/v1/reference-data/product/entities?code=${encodeURIComponent(productCode)}`, { token })).body);
  const entity = ((entities.items as Json[] | undefined) ?? [])[0];
  if (entity === undefined) return null;
  const catalog = obj((await http("GET", `/api/v1/reference-data/product_catalog/versions/${productCatalogVersionId}`, { token })).body);
  for (const rows of Object.values(obj(catalog.children))) {
    for (const m of (rows as Json[])) if (m.product_id === entity.id && typeof m.product_version_id === "string") return m.product_version_id;
  }
  return null;
}
