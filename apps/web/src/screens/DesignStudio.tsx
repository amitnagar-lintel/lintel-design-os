/**
 * Design Studio (Phase D6, Slice 1): the primary cabinet-design experience, replacing the old "4 Base cabinets" /
 * "5 Preview" screens as the primary editing surface. Three panes plus a bottom bar: a Cabinet Library (left), a
 * live 3D viewport with a plan / elevation / BOM bottom bar (centre), and a Properties panel (right). Every shape
 * shown comes from the API's already-resolved model (`GET .../model`); this screen computes no geometry, price or
 * quantity itself — it only maps a `CabinetInstance` (`@lintel/cabinet-engine`) to and from the API's existing
 * object endpoints (`compile.ts` / `decode.ts`), the same endpoints "4 Base cabinets" always used.
 */
import { useEffect, useState } from "react";
import type { CabinetFront, CabinetInstance, CabinetType, OverlayMode, Shutter } from "@lintel/cabinet-engine";
import { CABINET_LIBRARY, compileCreate, compileUpdate, decodeCabinetInstance, findAvailableCabinetType } from "@lintel/cabinet-engine";
import type { ScreenProps } from "../App";
import type { ModelPreview, Schemas } from "../api/client";
import { api, idempotency, must, versionWithEtag } from "../api/client";
import { nextFreeX } from "../geometry";
import { snapshotOf, SnapshotView } from "./Outputs";
import { pinnedProduct, usablePins } from "./Layout";
import type { Pins } from "./Layout";
import { Elevation, Plan, ValidationBadges } from "./Preview";
import { Action, Badge, ErrorBox, Field, Section, useLoad } from "../ui";
import { Viewport3D } from "./Viewport3D";

type Obj = ModelPreview["objects"][number];

function shutterFront(shutterCount: 1 | 2, overlay: OverlayMode, widthMm: number, heightMm: number): CabinetFront {
  const columnWidth = widthMm / shutterCount;
  const columns = Array.from({ length: shutterCount }, (_, i) => {
    const shutter: Shutter = { kind: "SHUTTER", widthMm: columnWidth, heightMm, overlay, hinge: { mounting: overlay === "OVERLAY" ? "FULL_OVERLAY" : "INSET", openingAngle: null } };
    return { columnId: `C${String(i)}`, widthMm: columnWidth, element: shutter };
  });
  return { rows: [{ rowId: "R0", heightMm, columns }] };
}

type ProductParam = { readonly key: string; readonly default?: unknown };

function paramNumber(params: readonly ProductParam[], key: string): number | undefined {
  const value = params.find((p) => p.key === key)?.default;
  return typeof value === "number" ? value : undefined;
}

function paramString(params: readonly ProductParam[], key: string): string {
  const value = params.find((p) => p.key === key)?.default;
  return typeof value === "string" ? value : "";
}

export function DesignStudioScreen({ me, sel, setSel, go }: ScreenProps) {
  const roomId = sel.roomId ?? "";
  const designs = useLoad(() => must(api.GET("/api/v1/rooms/{roomId}/designs", { params: { path: { roomId }, query: { limit: 100 } } })), `sdesigns:${roomId}`);
  const designId = sel.designId ?? designs.data?.items[0]?.id;
  const versions = useLoad(() => (designId === undefined ? Promise.resolve(null) : must(api.GET("/api/v1/designs/{designId}/versions", { params: { path: { designId }, query: { limit: 100 } } }))), `sversions:${designId ?? ""}`);
  const latest = [...(versions.data?.items ?? [])].sort((a, b) => b.versionNumber - a.versionNumber)[0];
  const version = versions.data?.items.find((v) => v.id === sel.versionId) ?? latest;
  const pinsNow = useLoad(usablePins, `spins:${roomId}`);
  const [designName, setDesignName] = useState("Kitchen design");

  const createVersion = async (basedOn?: Schemas["VersionResponse"]) => {
    if (designId === undefined) return;
    const { pins, missing } = await usablePins();
    if (missing.length > 0) throw new Error(`No APPROVED reference data for: ${missing.join(", ")}`);
    const v = await must(api.POST("/api/v1/designs/{designId}/versions", {
      params: { path: { designId }, header: { "Idempotency-Key": idempotency() } },
      body: { pins: pins as Pins, changeReason: basedOn === undefined ? "Design Studio" : `Changes after version ${String(basedOn.versionNumber)}`, ...(basedOn === undefined ? {} : { basedOnVersionId: basedOn.id }) },
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
      </Section>
      {version !== undefined && (
        <Studio version={version} canEdit={version.status === "DRAFT" && me.permissions.includes("design_version.author")} go={go} setSelVersion={() => { setSel({ ...sel, designId, versionId: version.id }); }} />
      )}
    </>
  );
}

function Studio({ version, canEdit, go, setSelVersion }: { readonly version: Schemas["VersionResponse"]; readonly canEdit: boolean; readonly go: ScreenProps["go"]; readonly setSelVersion: () => void }) {
  const versionId = version.id;
  const [n, setN] = useState(0);
  const model = useLoad(() => must(api.GET("/api/v1/design-versions/{versionId}/model", { params: { path: { versionId } } })), `smodel:${versionId}:${String(n)}`);
  const product = useLoad(() => pinnedProduct(version.pins.productCatalogVersionId), `sproduct:${version.pins.productCatalogVersionId}`);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [bottomTab, setBottomTab] = useState<"PLAN" | "ELEVATION" | "BOM">("PLAN");
  const [bom, setBom] = useState<Schemas["Snapshot"] | null>(null);
  const m = model.data;
  const objects = m?.objects ?? [];
  const selected: Obj | undefined = objects.find((o) => o.lineageId === selectedId) ?? objects[0];
  const cabinetType: CabinetType | undefined = selected === undefined ? undefined : findAvailableCabinetType(selected.productCode);
  const refresh = () => { setN((x) => x + 1); model.reload(); };

  const addCabinet = async (type: CabinetType) => {
    const p = product.data;
    if (p === null) throw new Error("The pinned product catalog does not define this cabinet type's product.");
    const width = paramNumber(p.params, "width");
    const height = paramNumber(p.params, "height");
    const depth = paramNumber(p.params, "depth");
    if (width === undefined || height === undefined || depth === undefined) throw new Error("The pinned product does not define default width/height/depth.");
    const n2 = objects.reduce((mx, o) => Math.max(mx, Number(/(\d+)$/.exec(o.objectCode)?.[1] ?? 0)), 0) + 1;
    const instance: CabinetInstance = {
      instanceId: "",
      objectCode: `BC-${String(n2).padStart(3, "0")}`,
      lineageId: null,
      cabinetType: type,
      recipe: { recipeId: type.recipeId, productCode: type.productCode, productVersionId: p.productVersionId, frontComponentTypes: ["SHUTTER"] },
      position: { xMm: nextFreeX(objects.map((o) => ({ id: o.objectId, x: o.transform.x, width: o.dimensions.width }))), yMm: 0, zMm: 0 },
      rotationY: 0,
      dimensions: { widthMm: width, heightMm: height, depthMm: depth },
      front: shutterFront(2, "OVERLAY", width, height),
      internals: [],
      corner: null,
      finish: {
        carcassMaterialId: paramString(p.params, "material"),
        backMaterialId: paramString(p.params, "backMaterial"),
        frontMaterialId: paramString(p.params, "shutterMaterial"),
        frontFinishId: paramString(p.params, "finish"),
      },
      hardware: { hinges: [], runners: [], handle: null },
    };
    const { etag } = await versionWithEtag(versionId);
    const body = compileCreate(instance);
    const created = await must(api.POST("/api/v1/design-versions/{versionId}/objects", { params: { path: { versionId }, header: { "If-Match": etag } }, body }));
    setSelectedId(created.object.lineageId);
    refresh();
  };

  const saveCabinet = async (objectId: string, next: CabinetInstance) => {
    const { etag } = await versionWithEtag(versionId);
    const body = compileUpdate(next);
    await must(api.PATCH("/api/v1/design-objects/{objectId}", { params: { path: { objectId }, header: { "If-Match": etag } }, body }));
    refresh();
  };

  const removeCabinet = async (objectId: string) => {
    const { etag } = await versionWithEtag(versionId);
    await must(api.DELETE("/api/v1/design-objects/{objectId}", { params: { path: { objectId }, header: { "If-Match": etag } } }));
    setSelectedId(null);
    refresh();
  };

  return (
    <Section title={`Design Studio — version ${String(version.versionNumber)}`} aside={m === null ? undefined : <ValidationBadges m={m} />}>
      <ErrorBox error={model.error ?? product.error} />
      {!canEdit && <p>This version is {version.status}: it can no longer be edited. Create a new DRAFT version above to change the design.</p>}
      <div className="studio">
        <aside className="studio-library">
          <CabinetLibraryPanel canEdit={canEdit} onAdd={addCabinet} />
        </aside>
        <div className="studio-center">
          <Viewport3D model={m} selectedId={selected?.lineageId ?? null} onSelect={setSelectedId} />
          <div className="studio-bottom">
            <nav className="studio-tabs">
              <button type="button" className={bottomTab === "PLAN" ? "current" : ""} onClick={() => { setBottomTab("PLAN"); }}>Plan</button>
              <button type="button" className={bottomTab === "ELEVATION" ? "current" : ""} onClick={() => { setBottomTab("ELEVATION"); }}>Elevation</button>
              <button type="button" className={bottomTab === "BOM" ? "current" : ""} onClick={() => { setBottomTab("BOM"); }}>BOM</button>
              <button type="button" onClick={() => { setSelVersion(); go("outputs"); }}>All outputs →</button>
            </nav>
            {m !== null && bottomTab === "PLAN" && <Plan m={m} />}
            {m !== null && bottomTab === "ELEVATION" && <Elevation m={m} />}
            {bottomTab === "BOM" && (
              <div className="studio-bom">
                <Action kind="primary" label="Generate BOM (PRELIMINARY)" run={async () => {
                  const created = await must(api.POST("/api/v1/design-versions/{versionId}/bom-snapshots", { params: { path: { versionId }, header: { "Idempotency-Key": idempotency() } }, body: { purpose: "PRELIMINARY" } }));
                  setBom(await snapshotOf("BOM", created.snapshot.id));
                }} />
                {bom !== null && <SnapshotView s={bom} />}
              </div>
            )}
            {m !== null && objects.length === 0 && <p>Add a cabinet from the library to begin.</p>}
          </div>
        </div>
        <aside className="studio-properties">
          {selected !== undefined && cabinetType !== undefined ? (
            <PropertiesPanel
              instance={decodeCabinetInstance(selected, cabinetType)}
              canEdit={canEdit}
              onSave={(next) => saveCabinet(selected.objectId, next)}
              onRemove={() => removeCabinet(selected.objectId)}
            />
          ) : <p>Select a cabinet, or add one from the library.</p>}
        </aside>
      </div>
    </Section>
  );
}

function CabinetLibraryPanel({ canEdit, onAdd }: { readonly canEdit: boolean; readonly onAdd: (type: CabinetType) => Promise<void> }) {
  const categories = ["BASE", "WALL", "TALL", "CORNER"] as const;
  return (
    <>
      <h3>Cabinet library</h3>
      {categories.map((category) => (
        <div key={category} className="cabinet-lib-group">
          <h4>{category}</h4>
          {CABINET_LIBRARY.filter((e) => e.category === category).map((entry) => {
            const availability = entry.availability;
            return (
              <div key={entry.cabinetTypeId} className={`cabinet-lib-item ${availability.kind === "PLANNED" ? "planned" : ""}`}>
                <div>
                  <strong>{entry.label}</strong>
                  <p>{entry.description}</p>
                </div>
                {availability.kind === "AVAILABLE"
                  ? <Action label="+ Add" disabled={!canEdit} run={() => onAdd(availability.cabinetType)} />
                  : <Badge tone="info">Slice {availability.slice}</Badge>}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

function PropertiesPanel({ instance, canEdit, onSave, onRemove }: { readonly instance: CabinetInstance; readonly canEdit: boolean; readonly onSave: (next: CabinetInstance) => Promise<void>; readonly onRemove: () => Promise<void> }) {
  const currentShutterCount = instance.front.rows[0]?.columns.length === 2 ? 2 : 1;
  const firstShutter = instance.front.rows[0]?.columns[0]?.element;
  const currentOverlay: OverlayMode = firstShutter?.kind === "SHUTTER" ? firstShutter.overlay : "OVERLAY";
  const [width, setWidth] = useState(String(instance.dimensions.widthMm));
  const [height, setHeight] = useState(String(instance.dimensions.heightMm));
  const [depth, setDepth] = useState(String(instance.dimensions.depthMm));
  const [shutterCount, setShutterCount] = useState<1 | 2>(currentShutterCount);
  const [overlay, setOverlay] = useState<OverlayMode>(currentOverlay);

  useEffect(() => {
    setWidth(String(instance.dimensions.widthMm));
    setHeight(String(instance.dimensions.heightMm));
    setDepth(String(instance.dimensions.depthMm));
    setShutterCount(currentShutterCount);
    setOverlay(currentOverlay);
    // Resync the editable fields whenever a different cabinet becomes selected.
  }, [instance.instanceId]);

  const save = async (): Promise<void> => {
    const widthMm = Number(width);
    const heightMm = Number(height);
    const depthMm = Number(depth);
    await onSave({
      ...instance,
      dimensions: { widthMm, heightMm, depthMm },
      front: shutterFront(shutterCount, overlay, widthMm, heightMm),
    });
  };

  return (
    <>
      <h3>Properties — {instance.objectCode}</h3>
      <Field label="Cabinet type"><input value={instance.cabinetType.label} disabled /></Field>
      <Field label="Width (mm)"><input className="num" value={width} disabled={!canEdit} onChange={(e) => { setWidth(e.target.value); }} /></Field>
      <Field label="Height (mm)"><input className="num" value={height} disabled={!canEdit} onChange={(e) => { setHeight(e.target.value); }} /></Field>
      <Field label="Depth (mm)"><input className="num" value={depth} disabled={!canEdit} onChange={(e) => { setDepth(e.target.value); }} /></Field>
      <Field label="Front">
        <select value={String(shutterCount)} disabled={!canEdit} onChange={(e) => { setShutterCount(e.target.value === "2" ? 2 : 1); }}>
          {instance.cabinetType.supportedFronts.map((f) => <option key={f.topologyId} value={String(f.rows[0]?.columns ?? 1)}>{f.label}</option>)}
        </select>
      </Field>
      <Field label="Overlay">
        <select value={overlay} disabled={!canEdit} onChange={(e) => { setOverlay(e.target.value === "INSET" ? "INSET" : "OVERLAY"); }}>
          <option value="OVERLAY">Overlay</option>
          <option value="INSET">Inset</option>
        </select>
      </Field>
      <div className="row">
        <Action kind="primary" label="Save" disabled={!canEdit} run={save} />
        <Action kind="danger" label="Remove" disabled={!canEdit} run={onRemove} />
      </div>
      <details>
        <summary>Finish (from the resolved model)</summary>
        <p>Carcass <code>{instance.finish.carcassMaterialId}</code> · Back <code>{instance.finish.backMaterialId}</code> · Front <code>{instance.finish.frontMaterialId}</code> · Finish <code>{instance.finish.frontFinishId}</code></p>
      </details>
      <details>
        <summary>Hardware (rule-derived, not chosen here)</summary>
        <p>{instance.hardware.hinges.length} hinge(s){instance.hardware.hinges[0] === undefined ? "" : `, mounting ${instance.hardware.hinges[0].mounting}`}. See the BOM tab for the full hardware list.</p>
      </details>
    </>
  );
}
