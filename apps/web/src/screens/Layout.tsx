/**
 * Screen 4 — base cabinet layout: only KIT_BASE_STANDARD, one run along wall A. Add, set width, position, arrange the
 * run edge to edge, remove. The design version is pinned to the organization's APPROVED / LOCKED reference data.
 * Cabinet height and depth are the product definition's defaults (read from the API), never typed here.
 */
import { useState } from "react";
import type { ScreenProps } from "../App";
import type { Schemas } from "../api/client";
import { api, idempotency, must, versionWithEtag } from "../api/client";
import { arrangeRun, mm, nextFreeX } from "../geometry";
import { Action, Badge, ErrorBox, Field, Section, useLoad } from "../ui";

const PRODUCT = "KIT_BASE_STANDARD";
const PIN_TYPES = [
  ["constructionStandardVersionId", "construction_standard"], ["planningStandardVersionId", "planning_standard"], ["edgeBandStandardVersionId", "edge_band_standard"],
  ["materialCatalogVersionId", "material_catalog"], ["finishCatalogVersionId", "finish_catalog"], ["hardwareCatalogVersionId", "hardware_catalog"],
  ["productCatalogVersionId", "product_catalog"], ["hettichDatasetVersionId", "hettich_dataset"],
] as const;
type PinName = (typeof PIN_TYPES)[number][0];
type Pins = Record<PinName, string>;

interface Param { readonly key: string; readonly default?: unknown; readonly min?: number | null; readonly max?: number | null }

/** The newest APPROVED / LOCKED version of each pinned type, or the types that have none. */
async function usablePins(): Promise<{ pins: Partial<Pins>; missing: string[] }> {
  const pins: Partial<Pins> = {};
  const missing: string[] = [];
  for (const [name, type] of PIN_TYPES) {
    const r = await must(api.GET("/api/v1/reference-data/{type}/versions", { params: { path: { type }, query: { status: "APPROVED,LOCKED", limit: 100 } } }));
    const best = [...r.items].sort((a, b) => b.versionNumber - a.versionNumber)[0];
    if (best === undefined) missing.push(type);
    else pins[name] = best.id;
  }
  return { pins, missing };
}

/** The exact KIT_BASE_STANDARD version the pinned product catalog lists, and its parameter definitions. */
async function pinnedProduct(productCatalogVersionId: string): Promise<{ productVersionId: string; params: Param[] } | null> {
  const entities = await must(api.GET("/api/v1/reference-data/{type}/entities", { params: { path: { type: "product" }, query: { code: PRODUCT } } }));
  const entity = entities.items[0];
  if (entity === undefined) return null;
  const catalog = await must(api.GET("/api/v1/reference-data/{type}/versions/{versionId}", { params: { path: { type: "product_catalog", versionId: productCatalogVersionId } } }));
  const member = Object.values(catalog.children).flat().find((m) => m.product_id === entity.id);
  const productVersionId = typeof member?.product_version_id === "string" ? member.product_version_id : null;
  if (productVersionId === null) return null;
  const product = await must(api.GET("/api/v1/reference-data/{type}/versions/{versionId}", { params: { path: { type: "product", versionId: productVersionId } } }));
  const definition = product.content.definition as { parameters?: Param[] } | undefined;
  return { productVersionId, params: definition?.parameters ?? [] };
}

export function LayoutScreen({ me, sel, setSel, go }: ScreenProps) {
  const roomId = sel.roomId ?? "";
  const designs = useLoad(() => must(api.GET("/api/v1/rooms/{roomId}/designs", { params: { path: { roomId }, query: { limit: 100 } } })), `designs:${roomId}`);
  const designId = sel.designId ?? designs.data?.items[0]?.id;
  const versions = useLoad(() => (designId === undefined ? Promise.resolve(null) : must(api.GET("/api/v1/designs/{designId}/versions", { params: { path: { designId }, query: { limit: 100 } } }))), `versions:${designId ?? ""}`);
  const latest = [...(versions.data?.items ?? [])].sort((a, b) => b.versionNumber - a.versionNumber)[0];
  const version = versions.data?.items.find((v) => v.id === sel.versionId) ?? latest;
  const pinsNow = useLoad(usablePins, `pins:${roomId}`);
  const [designName, setDesignName] = useState("Kitchen design");

  const createVersion = async (basedOn?: Schemas["VersionResponse"]) => {
    if (designId === undefined) return;
    const { pins, missing } = await usablePins();
    if (missing.length > 0) throw new Error(`No APPROVED reference data for: ${missing.join(", ")}`);
    const v = await must(api.POST("/api/v1/designs/{designId}/versions", {
      params: { path: { designId }, header: { "Idempotency-Key": idempotency() } },
      body: { pins: pins as Pins, changeReason: basedOn === undefined ? "Pilot design" : `Changes after version ${String(basedOn.versionNumber)}`, ...(basedOn === undefined ? {} : { basedOnVersionId: basedOn.id }) },
    }));
    setSel({ ...sel, designId, versionId: v.id });
    versions.reload();
  };

  return (
    <>
      <Section title="Design and version">
        <ErrorBox error={designs.error ?? versions.error} />
        {designs.data?.items.length === 0 ? (
          <div className="row">
            <Field label="Design name"><input value={designName} onChange={(e) => { setDesignName(e.target.value); }} /></Field>
            <Action kind="primary" label="Create design" run={async () => {
              const d = await must(api.POST("/api/v1/rooms/{roomId}/designs", { params: { path: { roomId }, header: { "Idempotency-Key": idempotency() } }, body: { name: designName.trim() } }));
              setSel({ ...sel, designId: d.id, versionId: undefined });
              designs.reload();
            }} />
          </div>
        ) : (
          <div className="row">
            <select aria-label="Design" value={designId ?? ""} onChange={(e) => { setSel({ ...sel, designId: e.target.value, versionId: undefined }); }}>
              {(designs.data?.items ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
            <select aria-label="Version" value={version?.id ?? ""} onChange={(e) => { setSel({ ...sel, designId, versionId: e.target.value }); }}>
              {(versions.data?.items ?? []).map((v) => <option key={v.id} value={v.id}>v{v.versionNumber} — {v.status}</option>)}
            </select>
            {version === undefined && designId !== undefined && <Action kind="primary" label="Create version (pinned to approved data)" run={() => createVersion()} disabled={(pinsNow.data?.missing.length ?? 1) > 0} />}
            {version !== undefined && version.status !== "DRAFT" && <Action label={`New DRAFT version based on v${String(version.versionNumber)}`} run={() => createVersion(version)} />}
          </div>
        )}
        {pinsNow.data !== null && pinsNow.data.missing.length > 0 && (
          <div className="error">No APPROVED / LOCKED reference data for {pinsNow.data.missing.join(", ")}. A design version cannot be created until they are approved (see docs/PILOT-BLOCKERS.md).</div>
        )}
        {version !== undefined && (
          <p>Version {version.versionNumber}: <Badge tone={version.status === "DRAFT" ? "info" : version.status === "LOCKED" ? "ok" : "warn"}>{version.status}</Badge> input <code>{version.inputHash.slice(0, 19)}…</code></p>
        )}
      </Section>
      {version !== undefined && <Cabinets version={version} canEdit={version.status === "DRAFT" && me.permissions.includes("design_version.author")} onChanged={versions.reload} go={go} setSelVersion={() => { setSel({ ...sel, designId, versionId: version.id }); }} />}
    </>
  );
}

function Cabinets({ version, canEdit, onChanged, go, setSelVersion }: { readonly version: Schemas["VersionResponse"]; readonly canEdit: boolean; readonly onChanged: () => void; readonly go: ScreenProps["go"]; readonly setSelVersion: () => void }) {
  const versionId = version.id;
  const objects = useLoad(() => must(api.GET("/api/v1/design-versions/{versionId}/objects", { params: { path: { versionId }, query: { limit: 100 } } })), `objects:${versionId}:${String(version.rowVersion)}`);
  const product = useLoad(() => pinnedProduct(version.pins.productCatalogVersionId), `product:${version.pins.productCatalogVersionId}`);
  const items = [...(objects.data?.items ?? [])].sort((a, b) => a.position.xMm - b.position.xMm);
  const param = (key: string) => product.data?.params.find((p) => p.key === key);
  const def = (key: string) => { const v = param(key)?.default; return typeof v === "number" ? v : null; };
  const [width, setWidth] = useState("");
  const [edits, setEdits] = useState<Record<string, { width?: string; x?: string }>>({});
  const refresh = () => { onChanged(); objects.reload(); };
  const w = param("width");

  const add = async () => {
    const p = product.data;
    const height = def("height");
    const depth = def("depth");
    if (p === null || height === null || depth === null) throw new Error("The pinned product catalog does not define KIT_BASE_STANDARD with default height and depth.");
    const { etag } = await versionWithEtag(versionId);
    const n = items.reduce((m, o) => Math.max(m, Number(/(\d+)$/.exec(o.objectCode)?.[1] ?? 0)), 0) + 1;
    await must(api.POST("/api/v1/design-versions/{versionId}/objects", {
      params: { path: { versionId }, header: { "If-Match": etag } },
      body: {
        objectCode: `BC-${String(n).padStart(3, "0")}`, objectType: "BASE_CABINET", productCode: PRODUCT, productVersionId: p.productVersionId,
        position: { xMm: nextFreeX(items.map((o) => ({ id: o.id, x: o.position.xMm, width: o.dimensions.widthMm }))), yMm: 0, zMm: 0 }, rotationY: 0,
        dimensions: { widthMm: Number(width === "" ? def("width") : width), heightMm: height, depthMm: depth }, parameters: {},
      },
    }));
    setWidth("");
    refresh();
  };
  const patch = async (o: Schemas["ObjectResponse"], body: Schemas["ObjectUpdate"]) => {
    const { etag } = await versionWithEtag(versionId);
    await must(api.PATCH("/api/v1/design-objects/{objectId}", { params: { path: { objectId: o.id }, header: { "If-Match": etag } }, body }));
  };

  return (
    <Section title="Base cabinets — KIT_BASE_STANDARD on wall A" aside={<button type="button" onClick={() => { setSelVersion(); go("preview"); }}>Preview →</button>}>
      <ErrorBox error={objects.error ?? product.error} />
      {product.data === null && !product.loading && <div className="error">KIT_BASE_STANDARD is not in the pinned product catalog.</div>}
      <table>
        <thead><tr><th>Cabinet</th><th>Position from wall A start</th><th>Width</th><th>Height</th><th>Depth</th>{canEdit && <th />}</tr></thead>
        <tbody>
          {items.map((o) => (
            <tr key={o.id}>
              <td>{o.objectCode}</td>
              <td>{canEdit ? <input className="num" aria-label={`${o.objectCode} position`} value={edits[o.id]?.x ?? String(o.position.xMm)} onChange={(e) => { setEdits({ ...edits, [o.id]: { ...edits[o.id], x: e.target.value } }); }} /> : mm(o.position.xMm)}</td>
              <td>{canEdit ? <input className="num" aria-label={`${o.objectCode} width`} value={edits[o.id]?.width ?? String(o.dimensions.widthMm)} onChange={(e) => { setEdits({ ...edits, [o.id]: { ...edits[o.id], width: e.target.value } }); }} /> : mm(o.dimensions.widthMm)}</td>
              <td>{mm(o.dimensions.heightMm)}</td><td>{mm(o.dimensions.depthMm)}</td>
              {canEdit && (
                <td>
                  <Action label="Save" disabled={edits[o.id] === undefined} run={async () => {
                    const e = edits[o.id] ?? {};
                    await patch(o, {
                      ...(e.x === undefined ? {} : { position: { ...o.position, xMm: Number(e.x) } }),
                      ...(e.width === undefined ? {} : { dimensions: { ...o.dimensions, widthMm: Number(e.width) } }),
                    });
                    setEdits(Object.fromEntries(Object.entries(edits).filter(([k]) => k !== o.id)));
                    refresh();
                  }} />
                  <Action kind="danger" label="Remove" run={async () => {
                    const { etag } = await versionWithEtag(versionId);
                    await must(api.DELETE("/api/v1/design-objects/{objectId}", { params: { path: { objectId: o.id }, header: { "If-Match": etag } } }));
                    refresh();
                  }} />
                </td>
              )}
            </tr>
          ))}
          {items.length === 0 && <tr><td colSpan={6}>No cabinet yet.</td></tr>}
        </tbody>
      </table>
      {canEdit ? (
        <div className="row">
          <Field label="Width (mm)" hint={w === undefined ? undefined : `default ${String(w.default)}${w.min != null ? `, min ${String(w.min)}` : ""}${w.max != null ? `, max ${String(w.max)}` : ""}`}>
            <input className="num" inputMode="numeric" value={width} placeholder={String(def("width") ?? "")} onChange={(e) => { setWidth(e.target.value); }} />
          </Field>
          <Action kind="primary" label="Add cabinet at the end of the run" run={add} disabled={product.data === null} />
          <Action label="Arrange run (edge to edge)" disabled={items.length < 2} run={async () => {
            for (const m of arrangeRun(items.map((o) => ({ id: o.id, x: o.position.xMm, width: o.dimensions.widthMm })))) {
              const o = items.find((x) => x.id === m.id);
              if (o !== undefined) await patch(o, { position: { ...o.position, xMm: m.x } });
            }
            refresh();
          }} />
        </div>
      ) : <p>This version is {version.status}: it can no longer be edited. Create a new DRAFT version to change the layout.</p>}
    </Section>
  );
}
