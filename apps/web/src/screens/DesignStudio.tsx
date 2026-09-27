/**
 * Design Studio (Phase D6): the primary cabinet-design experience, replacing the old "4 Base cabinets" /
 * "5 Preview" screens as the primary editing surface. Three panes plus a bottom bar: a Cabinet Library (left), a
 * live 3D viewport with a plan / elevation / BOM bottom bar (centre), and a Properties panel (right). Every shape
 * shown comes from the API's already-resolved model (`GET .../model`); this screen computes no geometry, price or
 * quantity itself — it only maps a `CabinetInstance` (`@lintel/cabinet-engine`) to and from the API's existing
 * object endpoints (`compile.ts` / `decode.ts`), the same endpoints "4 Base cabinets" always used.
 *
 * Slice 1 (`BASE_SHUTTER`), Slice 2 (`BASE_DRAWER_BANK`) and Slice 3 (`BASE_OPEN`) share this one screen: the
 * Properties panel shows a "Front" (shutter count) control, a "Drawer count" control, or a "Shelf count"
 * control (with no front control at all — an open cabinet has no door), dispatched by `recipe.productCode` —
 * never by guessing from whatever front happens to be decoded.
 */
import { useEffect, useState } from "react";
import type { CabinetFront, CabinetInstance, CabinetType, Drawer, DrawerBank, OverlayMode, PullOut, Shelf, Shutter } from "@lintel/cabinet-engine";
import { CABINET_LIBRARY, compileCreate, compileUpdate, cornerPairPlacementDA, decodeCabinetInstance, findAvailableCabinetType } from "@lintel/cabinet-engine";
import type { ScreenProps } from "../App";
import type { ModelPreview, Schemas } from "../api/client";
import { api, idempotency, must, versionWithEtag } from "../api/client";
import { nextFreeX, placeOnWall } from "../geometry";
import type { WallId } from "../geometry";
import { snapshotOf, SnapshotView } from "./Outputs";
import { usablePins } from "./Layout";
import type { Param, Pins } from "./Layout";
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

/** A placeholder drawer bank shaped correctly for `compileCreate`/`compileUpdate`: only `drawers.length`,
 * `overlay` and (Slice 2.1) each non-last drawer's `heightMm` reach the wire (`compile.ts`'s `drawerParametersOf`
 * sends `drawerHeight1..N-1` from `drawers[0..N-2]`, in top-to-bottom order); the engine recomputes every
 * drawer's real size and position, including the last (bottom) drawer's remainder height. `explicitHeightsMm`,
 * when given, overrides the even split for drawers `0..drawerCount-2` (its own last entry, if any, is ignored —
 * the bottom drawer never takes an explicit height). `componentId`/`boxHeightMm`/`gapBelowMm` are decode-only
 * facts with no meaning before a save round-trip, so a freshly-built front only carries placeholders for them. */
function drawerBankFront(drawerCount: 2 | 3 | 4, overlay: OverlayMode, widthMm: number, heightMm: number, explicitHeightsMm?: readonly number[]): CabinetFront {
  const evenHeight = heightMm / drawerCount;
  const drawers: Drawer[] = Array.from({ length: drawerCount }, (_, i) => ({
    kind: "DRAWER",
    widthMm,
    heightMm: explicitHeightsMm?.[i] ?? evenHeight,
    frontThicknessMm: 18,
    index: i,
    runner: null,
    componentId: `PENDING-${String(i)}`,
    boxHeightMm: null,
    gapBelowMm: null,
  }));
  const bank: DrawerBank = { kind: "DRAWER_BANK", widthMm, overlay, drawers };
  return { rows: [{ rowId: "R0", heightMm, columns: [{ columnId: "C0", widthMm, element: bank }] }] };
}

/** An open cabinet has no front at all: zero rows, never a row of zero-width columns. */
const OPEN_FRONT: CabinetFront = { rows: [] };

/** A placeholder shelf list shaped correctly for `compileCreate`/`compileUpdate`: only `.length` reaches the
 * wire (see `compile.ts`); the engine recomputes every shelf's real position from the recipe's even-spacing formula. */
function shelves(shelfCount: number): readonly Shelf[] {
  return Array.from({ length: shelfCount }, (_, i) => ({ shelfId: `SHF${String(i)}`, fixed: true, heightFromBottomMm: null }));
}

/** A placeholder pull-out list shaped correctly for `compileCreate`/`compileUpdate` (Slice 5 step 1): only
 * `.length` reaches the wire (see `compile.ts`'s `pulloutParametersOf`); the engine recomputes every frame's
 * real position from the recipe's own even-spacing formula, exactly like `shelves` above. */
function pullouts(pulloutCount: number): readonly PullOut[] {
  return Array.from({ length: pulloutCount }, (_, i) => ({ pullOutId: `PLO${String(i)}`, kind: "TRAY" }));
}

/** `BASE_SINK`'s own optional internal (Slice 5 step 4): at most one `PullOut { kind: "WASTE_BIN" }` — presence,
 * not count, reaches the wire (see `compile.ts`'s `sinkHasWasteBin`). */
function wasteBinInternals(present: boolean): readonly PullOut[] {
  return present ? [{ pullOutId: "WB0", kind: "WASTE_BIN" }] : [];
}

function paramNumber(params: readonly Param[], key: string): number | undefined {
  const value = params.find((p) => p.key === key)?.default;
  return typeof value === "number" ? value : undefined;
}

function paramString(params: readonly Param[], key: string): string {
  const value = params.find((p) => p.key === key)?.default;
  return typeof value === "string" ? value : "";
}

/** Same lookup Layout.tsx's `pinnedProduct` does, generalised to any product code (Layout.tsx's own version stays
 * hardcoded to KIT_BASE_STANDARD, since it is frozen project-workflow infrastructure the Design Studio does not edit). */
async function pinnedProductByCode(productCatalogVersionId: string, productCode: string): Promise<{ productVersionId: string; params: Param[] } | null> {
  const entities = await must(api.GET("/api/v1/reference-data/{type}/entities", { params: { path: { type: "product" }, query: { code: productCode } } }));
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Slice 2.1: which component (e.g. one drawer front) within the selected object is highlighted, if any. Cleared
   * whenever a different object becomes selected — a component selection never survives across cabinets. */
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);
  const selectObject = (lineageId: string | null) => { setSelectedId(lineageId); setSelectedComponentId(null); };
  const selectComponent = (lineageId: string, componentId: string) => { setSelectedId(lineageId); setSelectedComponentId(componentId); };
  const [bottomTab, setBottomTab] = useState<"PLAN" | "ELEVATION" | "BOM">("PLAN");
  const [bom, setBom] = useState<Schemas["Snapshot"] | null>(null);
  const m = model.data;
  const objects = m?.objects ?? [];
  const selected: Obj | undefined = objects.find((o) => o.lineageId === selectedId) ?? objects[0];
  const cabinetType: CabinetType | undefined = selected === undefined ? undefined : findAvailableCabinetType(selected.productCode);
  const refresh = () => { setN((x) => x + 1); model.reload(); };

  const nextObjectCode = (offset = 0) => {
    const n2 = objects.reduce((mx, o) => Math.max(mx, Number(/(\d+)$/.exec(o.objectCode)?.[1] ?? 0)), 0) + 1 + offset;
    return `BC-${String(n2).padStart(3, "0")}`;
  };

  /** One `CabinetInstance` of `type`, at an explicit position/rotation — shared by a lone cabinet (Slice 1-3) and
   * each leg of a corner pair (Slice 4, `addCornerPair`). `overlay` defaults to "OVERLAY" (Slice 1's own
   * default); a corner leg uses "INSET" instead, since an overlay front sits proud of the carcass by
   * `SHUTTER_BACK_GAP` — enough to collide with the perpendicular leg placed flush at its exact depth
   * (`cornerPairPlacementDA`), whatever that construction-standard value turns out to be. An inset front never
   * projects past the carcass depth, so the two legs stay exactly touching regardless. */
  const buildInstance = (
    type: CabinetType, p: { readonly productVersionId: string; readonly params: Param[] }, objectCode: string,
    position: { readonly xMm: number; readonly yMm: number; readonly zMm: number }, rotationY: 0 | 90 | 180 | 270,
    overlay: OverlayMode = "OVERLAY",
  ): CabinetInstance => {
    const width = paramNumber(p.params, "width");
    const height = paramNumber(p.params, "height");
    const depth = paramNumber(p.params, "depth");
    if (width === undefined || height === undefined || depth === undefined) throw new Error("The pinned product does not define default width/height/depth.");
    const isDrawer = type.productCode === "KIT_BASE_DRAWER";
    const isOpen = type.productCode === "KIT_BASE_OPEN";
    const isPullout = type.productCode === "KIT_BASE_PULLOUT";
    const isOvenTower = type.productCode === "KIT_TALL_OVEN";
    const noFront = isOpen || isOvenTower;
    const defaultShelfCount = paramNumber(p.params, isOvenTower ? "shelfCountAbove" : "shelfCount") ?? 2;
    const defaultShutterCount = (paramNumber(p.params, "shutterCount") ?? 2) === 1 ? 1 : 2;
    const defaultPulloutCount = paramNumber(p.params, "pulloutCount") ?? 3;
    return {
      instanceId: "",
      objectCode,
      lineageId: null,
      cabinetType: type,
      recipe: { recipeId: type.recipeId, productCode: type.productCode, productVersionId: p.productVersionId, frontComponentTypes: noFront ? [] : isDrawer ? ["DRAWER_FRONT"] : ["SHUTTER"] },
      position,
      rotationY,
      dimensions: { widthMm: width, heightMm: height, depthMm: depth },
      front: noFront ? OPEN_FRONT : isDrawer ? drawerBankFront(3, overlay, width, height) : shutterFront(defaultShutterCount, overlay, width, height),
      internals: noFront ? shelves(defaultShelfCount) : isPullout ? pullouts(defaultPulloutCount) : [],
      corner: null,
      finish: {
        carcassMaterialId: paramString(p.params, "material"),
        backMaterialId: paramString(p.params, "backMaterial"),
        frontMaterialId: paramString(p.params, noFront ? "material" : isDrawer ? "frontMaterial" : "shutterMaterial"),
        frontFinishId: noFront ? "" : paramString(p.params, "finish"),
      },
      hardware: { hinges: [], runners: [], handle: null },
    };
  };

  const createObject = async (instance: CabinetInstance) => {
    const { etag } = await versionWithEtag(versionId);
    const body = compileCreate(instance);
    return must(api.POST("/api/v1/design-versions/{versionId}/objects", { params: { path: { versionId }, header: { "If-Match": etag } }, body }));
  };

  const addCabinet = async (type: CabinetType) => {
    const p = await pinnedProductByCode(version.pins.productCatalogVersionId, type.productCode);
    if (p === null) throw new Error(`The pinned product catalog does not define ${type.productCode}.`);
    const position = { xMm: nextFreeX(objects.map((o) => ({ id: o.objectId, x: o.transform.x, width: o.dimensions.width }))), yMm: 0, zMm: 0 };
    const instance = buildInstance(type, p, nextObjectCode(), position, 0);
    const created = await createObject(instance);
    selectObject(created.object.lineageId);
    refresh();
  };

  /** Slice 4: an L-corner cabinet is two ordinary `type` instances, positioned by `cornerPairPlacementDA` so
   * their footprints meet exactly at the room's D-A corner without overlap (`corner.ts`). Two sequential
   * creates, re-reading the version's ETag between them (the first create advances it). */
  const addCornerPair = async (type: CabinetType) => {
    const p = await pinnedProductByCode(version.pins.productCatalogVersionId, type.productCode);
    if (p === null) throw new Error(`The pinned product catalog does not define ${type.productCode}.`);
    const width = paramNumber(p.params, "width");
    const depth = paramNumber(p.params, "depth");
    if (width === undefined || depth === undefined) throw new Error("The pinned product does not define default width/depth.");
    const { returnLeg, frontLeg } = cornerPairPlacementDA({ widthMm: width, depthMm: depth });
    const returnInstance = buildInstance(type, p, nextObjectCode(), returnLeg.position, returnLeg.rotationY, "INSET");
    await createObject(returnInstance);
    const frontInstance = buildInstance(type, p, nextObjectCode(1), frontLeg.position, frontLeg.rotationY, "INSET");
    const frontCreated = await createObject(frontInstance);
    selectObject(frontCreated.object.lineageId);
    refresh();
  };

  const saveCabinet = async (objectId: string, next: CabinetInstance) => {
    const { etag } = await versionWithEtag(versionId);
    const body = compileUpdate(next);
    await must(api.PATCH("/api/v1/design-objects/{objectId}", { params: { path: { objectId }, header: { "If-Match": etag } }, body }));
    refresh();
  };

  /** Slice 6A: drag-to-wall-snap in the Plan view. A pure position/rotation move — never touches front/internals/
   * finish, so it skips `compileUpdate`'s full instance round-trip entirely. */
  const moveCabinet = async (objectId: string, position: { xMm: number; yMm: number; zMm: number }, rotationY: 0 | 90 | 180 | 270) => {
    const { etag } = await versionWithEtag(versionId);
    await must(api.PATCH("/api/v1/design-objects/{objectId}", { params: { path: { objectId }, header: { "If-Match": etag } }, body: { position, rotationY } }));
    refresh();
  };

  const removeCabinet = async (objectId: string) => {
    const { etag } = await versionWithEtag(versionId);
    await must(api.DELETE("/api/v1/design-objects/{objectId}", { params: { path: { objectId }, header: { "If-Match": etag } } }));
    selectObject(null);
    refresh();
  };

  return (
    <Section title={`Design Studio — version ${String(version.versionNumber)}`} aside={m === null ? undefined : <ValidationBadges m={m} />}>
      <ErrorBox error={model.error} />
      {!canEdit && <p>This version is {version.status}: it can no longer be edited. Create a new DRAFT version above to change the design.</p>}
      <div className="studio">
        <aside className="studio-library">
          <CabinetLibraryPanel canEdit={canEdit} onAdd={addCabinet} onAddCornerPair={addCornerPair} />
        </aside>
        <div className="studio-center">
          <Viewport3D
            model={m} selectedId={selected?.lineageId ?? null} onSelect={selectObject}
            selectedComponentId={selectedComponentId} onSelectComponent={selectComponent}
          />
          <div className="studio-bottom">
            <nav className="studio-tabs">
              <button type="button" className={bottomTab === "PLAN" ? "current" : ""} onClick={() => { setBottomTab("PLAN"); }}>Plan</button>
              <button type="button" className={bottomTab === "ELEVATION" ? "current" : ""} onClick={() => { setBottomTab("ELEVATION"); }}>Elevation</button>
              <button type="button" className={bottomTab === "BOM" ? "current" : ""} onClick={() => { setBottomTab("BOM"); }}>BOM</button>
              <button type="button" onClick={() => { setSelVersion(); go("outputs"); }}>All outputs →</button>
            </nav>
            {m !== null && bottomTab === "PLAN" && (
              <Plan
                m={m} canEdit={canEdit} selectedId={selected?.lineageId ?? null} onSelect={selectObject}
                onMove={(lineageId, next) => {
                  const o = objects.find((x) => x.lineageId === lineageId);
                  if (o !== undefined) void moveCabinet(o.objectId, { xMm: next.xMm, yMm: next.yMm, zMm: next.zMm }, next.rotationY);
                }}
              />
            )}
            {m !== null && bottomTab === "ELEVATION" && (
              <Elevation m={m} selectedComponentId={selectedComponentId} onSelectComponent={selectComponent} />
            )}
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
              selectedComponentId={selectedComponentId}
              onSelectComponentId={(componentId) => { setSelectedComponentId(componentId); }}
              applianceId={typeof selected.parameters.oven === "string" ? selected.parameters.oven : typeof selected.parameters.hob === "string" ? selected.parameters.hob : null}
              placement={selected.placement}
              room={m === null ? null : { length: m.room.length, width: m.room.width }}
            />
          ) : <p>Select a cabinet, or add one from the library.</p>}
        </aside>
      </div>
    </Section>
  );
}

function CabinetLibraryPanel({ canEdit, onAdd, onAddCornerPair }: { readonly canEdit: boolean; readonly onAdd: (type: CabinetType) => Promise<void>; readonly onAddCornerPair: (type: CabinetType) => Promise<void> }) {
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
                {availability.kind === "AVAILABLE" && <Action label="+ Add" disabled={!canEdit} run={() => onAdd(availability.cabinetType)} />}
                {availability.kind === "AVAILABLE_CORNER_PAIR" && <Action label="+ Add pair" disabled={!canEdit} run={() => onAddCornerPair(availability.cabinetType)} />}
                {availability.kind === "PLANNED" && <Badge tone="info">Slice {availability.slice}</Badge>}
              </div>
            );
          })}
        </div>
      ))}
    </>
  );
}

const DRAWER_COUNTS = [2, 3, 4] as const;

function PropertiesPanel({ instance, canEdit, onSave, onRemove, selectedComponentId, onSelectComponentId, applianceId, placement, room }: {
  readonly instance: CabinetInstance; readonly canEdit: boolean; readonly onSave: (next: CabinetInstance) => Promise<void>; readonly onRemove: () => Promise<void>;
  /** Slice 2.1: which drawer front (by resolved `componentId`), if any, is selected in the 3D view or elevation. */
  readonly selectedComponentId: string | null;
  readonly onSelectComponentId: (componentId: string | null) => void;
  /** Slice 5 step 3: the resolved model's `oven` parameter value (`KIT_TALL_OVEN` only), read-only — this
   * slice has no UI control for choosing a different appliance. */
  readonly applianceId: string | null;
  /** Slice 6A: the resolved model's own placement (null when the object couldn't be placed at all — see its
   * messages), and the room's length/width, needed to convert a chosen wall/along/distance back into a
   * `transform.x/z/rotationY` via `placeOnWall`. Precise position editing alongside Plan-view drag-to-snap. */
  readonly placement: Obj["placement"];
  readonly room: { readonly length: number; readonly width: number } | null;
}) {
  const isDrawer = instance.recipe.productCode === "KIT_BASE_DRAWER";
  const isOpen = instance.recipe.productCode === "KIT_BASE_OPEN";
  const isPullout = instance.recipe.productCode === "KIT_BASE_PULLOUT";
  const isOvenTower = instance.recipe.productCode === "KIT_TALL_OVEN";
  const isSink = instance.recipe.productCode === "KIT_BASE_SINK";
  const isHob = instance.recipe.productCode === "KIT_BASE_HOB";
  const noFront = isOpen || isOvenTower;
  const element = instance.front.rows[0]?.columns[0]?.element;
  const currentShutterCount = !isDrawer && !noFront && instance.front.rows[0]?.columns.length === 2 ? 2 : 1;
  const currentDrawerCount = element?.kind === "DRAWER_BANK" && (DRAWER_COUNTS as readonly number[]).includes(element.drawers.length) ? (element.drawers.length as 2 | 3 | 4) : 3;
  const currentOverlay: OverlayMode = element?.kind === "SHUTTER" || element?.kind === "DRAWER_BANK" ? element.overlay : "OVERLAY";
  const currentShelfCount = noFront ? instance.internals.length : 0;
  const currentPulloutCount = isPullout ? instance.internals.length : 0;
  const currentWasteBin = isSink && instance.internals.length > 0;
  const currentDrawerHeights = element?.kind === "DRAWER_BANK" ? element.drawers.map((d) => String(d.heightMm)) : [];
  const [width, setWidth] = useState(String(instance.dimensions.widthMm));
  const [height, setHeight] = useState(String(instance.dimensions.heightMm));
  const [depth, setDepth] = useState(String(instance.dimensions.depthMm));
  const [shutterCount, setShutterCount] = useState<1 | 2>(currentShutterCount);
  const [drawerCount, setDrawerCount] = useState<2 | 3 | 4>(currentDrawerCount);
  const [overlay, setOverlay] = useState<OverlayMode>(currentOverlay);
  const [shelfCount, setShelfCount] = useState(String(currentShelfCount));
  const [pulloutCount, setPulloutCount] = useState(String(currentPulloutCount));
  const [wasteBin, setWasteBin] = useState(currentWasteBin);
  /** Slice 2.1: one front height per drawer (top to bottom), kept in sync with the resolved model until edited;
   * the bank's last (bottom) entry is display-only — `save()` never sends it (see `drawerBankFront`). */
  const [drawerHeights, setDrawerHeights] = useState<string[]>(currentDrawerHeights);
  /** Slice 6A: precise position editing, alongside Plan-view drag-to-snap. Always flush against the chosen wall
   * (`distanceMm` defaults to the resolved model's own `distanceToWall`, editable for e.g. a filler gap) — the
   * same `placeOnWall` inverse the Plan view's drag uses, so a saved value here resolves to the identical
   * `transform` the engine would derive from picking that wall by dragging. */
  const [wallId, setWallId] = useState<WallId>(placement?.wallId ?? "A");
  const [alongMm, setAlongMm] = useState(String(placement?.alongWall.start ?? 0));
  const [distanceMm, setDistanceMm] = useState(String(placement?.distanceToWall ?? 0));

  useEffect(() => {
    setWidth(String(instance.dimensions.widthMm));
    setHeight(String(instance.dimensions.heightMm));
    setDepth(String(instance.dimensions.depthMm));
    setShutterCount(currentShutterCount);
    setDrawerCount(currentDrawerCount);
    setOverlay(currentOverlay);
    setShelfCount(String(currentShelfCount));
    setPulloutCount(String(currentPulloutCount));
    setWasteBin(currentWasteBin);
    setDrawerHeights(currentDrawerHeights);
    // Resync the editable fields whenever a different cabinet becomes selected.
  }, [instance.instanceId]);

  useEffect(() => {
    setWallId(placement?.wallId ?? "A");
    setAlongMm(String(placement?.alongWall.start ?? 0));
    setDistanceMm(String(placement?.distanceToWall ?? 0));
    // Also resync after an external move (e.g. a Plan-view drag), which changes the placement without changing
    // instance.instanceId.
  }, [instance.instanceId, placement?.wallId, placement?.alongWall.start, placement?.distanceToWall]);

  const selectedDrawerIndex = element?.kind === "DRAWER_BANK" ? element.drawers.findIndex((d) => d.componentId === selectedComponentId) : -1;
  const selectedDrawer = selectedDrawerIndex >= 0 && element?.kind === "DRAWER_BANK" ? element.drawers[selectedDrawerIndex] : undefined;

  const setDrawerCountAndReset = (nextCount: 2 | 3 | 4): void => {
    setDrawerCount(nextCount);
    // A count change re-splits evenly (Slice 2's own default); explicit per-drawer heights from before the
    // change no longer correspond to a real slot, so they are not carried across a count change.
    const evenHeight = Number(height) / nextCount;
    setDrawerHeights(Array.from({ length: nextCount }, () => String(evenHeight)));
    onSelectComponentId(null);
  };

  const setDrawerHeightAt = (index: number, value: string): void => {
    setDrawerHeights((prev) => prev.map((h, i) => (i === index ? value : h)));
  };

  const save = async (): Promise<void> => {
    const widthMm = Number(width);
    const heightMm = Number(height);
    const depthMm = Number(depth);
    const moved = room === null ? null : placeOnWall(wallId, Number(alongMm), Number(distanceMm), room.length, room.width);
    await onSave({
      ...instance,
      ...(moved === null ? {} : { position: { xMm: moved.x, yMm: instance.position.yMm, zMm: moved.z }, rotationY: moved.rotationY }),
      dimensions: { widthMm, heightMm, depthMm },
      front: noFront ? OPEN_FRONT : isDrawer ? drawerBankFront(drawerCount, overlay, widthMm, heightMm, drawerHeights.map(Number)) : shutterFront(shutterCount, overlay, widthMm, heightMm),
      internals: noFront ? shelves(Math.max(0, Math.trunc(Number(shelfCount)))) : isPullout ? pullouts(Math.max(0, Math.trunc(Number(pulloutCount)))) : isSink ? wasteBinInternals(wasteBin) : instance.internals,
    });
  };

  return (
    <>
      <h3>Properties — {instance.objectCode}</h3>
      <Field label="Cabinet type"><input value={instance.cabinetType.label} disabled /></Field>
      <Field label="Width (mm)"><input className="num" value={width} disabled={!canEdit} onChange={(e) => { setWidth(e.target.value); }} /></Field>
      <Field label="Height (mm)"><input className="num" value={height} disabled={!canEdit} onChange={(e) => { setHeight(e.target.value); }} /></Field>
      <Field label="Depth (mm)"><input className="num" value={depth} disabled={!canEdit} onChange={(e) => { setDepth(e.target.value); }} /></Field>
      {room === null ? null : (
        <>
          <h3>Position</h3>
          <Field label="Wall">
            <select value={wallId} disabled={!canEdit} onChange={(e) => { setWallId(e.target.value as WallId); }}>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
              <option value="D">D</option>
            </select>
          </Field>
          <Field label="Along wall, from left (mm)"><input className="num" value={alongMm} disabled={!canEdit} onChange={(e) => { setAlongMm(e.target.value); }} /></Field>
          <Field label="Distance from wall (mm)"><input className="num" value={distanceMm} disabled={!canEdit} onChange={(e) => { setDistanceMm(e.target.value); }} /></Field>
          {placement === null && <small>Not currently placed in the room — see the version&apos;s validation messages.</small>}
        </>
      )}
      {noFront ? (
        <Field label={isOvenTower ? "Shelf count (above oven)" : "Shelf count"}><input className="num" value={shelfCount} disabled={!canEdit} onChange={(e) => { setShelfCount(e.target.value); }} /></Field>
      ) : isDrawer ? (
        <Field label="Drawer count">
          <select value={String(drawerCount)} disabled={!canEdit} onChange={(e) => { setDrawerCountAndReset(Number(e.target.value) as 2 | 3 | 4); }}>
            {DRAWER_COUNTS.map((n) => <option key={n} value={String(n)}>{n} drawers</option>)}
          </select>
        </Field>
      ) : (
        <Field label="Front">
          <select value={String(shutterCount)} disabled={!canEdit} onChange={(e) => { setShutterCount(e.target.value === "2" ? 2 : 1); }}>
            {instance.cabinetType.supportedFronts.map((f) => <option key={f.topologyId} value={String(f.rows[0]?.columns ?? 1)}>{f.label}</option>)}
          </select>
        </Field>
      )}
      {!noFront && (
        <Field label="Overlay">
          <select value={overlay} disabled={!canEdit} onChange={(e) => { setOverlay(e.target.value === "INSET" ? "INSET" : "OVERLAY"); }}>
            <option value="OVERLAY">Overlay</option>
            <option value="INSET">Inset</option>
          </select>
        </Field>
      )}
      {isPullout && (
        <Field label="Pull-out count"><input className="num" value={pulloutCount} disabled={!canEdit} onChange={(e) => { setPulloutCount(e.target.value); }} /></Field>
      )}
      {(isOvenTower || isHob) && (
        <Field label="Appliance"><input value={applianceId ?? "—"} disabled /></Field>
      )}
      {isSink && (
        <Field label="Internal">
          <select value={wasteBin ? "WASTE_BIN" : "OPEN"} disabled={!canEdit} onChange={(e) => { setWasteBin(e.target.value === "WASTE_BIN"); }}>
            <option value="OPEN">Open (no internal)</option>
            <option value="WASTE_BIN">Waste-bin tray</option>
          </select>
        </Field>
      )}
      {isDrawer && element?.kind === "DRAWER_BANK" && (
        <>
          <h3>Selected drawer</h3>
          <Field label="Drawer">
            <select
              value={selectedDrawerIndex >= 0 ? String(selectedDrawerIndex) : ""}
              onChange={(e) => {
                const i = e.target.value === "" ? -1 : Number(e.target.value);
                onSelectComponentId(i >= 0 ? (element.drawers[i]?.componentId ?? null) : null);
              }}
            >
              <option value="">— click a drawer in the 3D view or elevation —</option>
              {element.drawers.map((d, i) => <option key={d.componentId} value={String(i)}>Drawer {i + 1}{i === element.drawers.length - 1 ? " (bottom, auto height)" : ""}</option>)}
            </select>
          </Field>
          {selectedDrawer !== undefined && (
            <>
              <Field label="Drawer index"><input value={String(selectedDrawerIndex + 1)} disabled /></Field>
              <Field label="Front height (mm)">
                <input
                  className="num"
                  value={drawerHeights[selectedDrawerIndex] ?? String(selectedDrawer.heightMm)}
                  disabled={!canEdit || selectedDrawerIndex === element.drawers.length - 1}
                  onChange={(e) => { setDrawerHeightAt(selectedDrawerIndex, e.target.value); }}
                />
                {selectedDrawerIndex === element.drawers.length - 1 && <small>The bottom drawer always absorbs the remaining opening height.</small>}
              </Field>
              <Field label="Drawer box height (mm)"><input value={selectedDrawer.boxHeightMm === null ? "—" : String(selectedDrawer.boxHeightMm)} disabled /></Field>
              <Field label="Front thickness (mm)"><input value={String(selectedDrawer.frontThicknessMm)} disabled /></Field>
              <Field label="Gap to drawer below (mm)"><input value={selectedDrawer.gapBelowMm === null ? "—" : String(selectedDrawer.gapBelowMm)} disabled /></Field>
              <Field label="Finish"><input value={instance.finish.frontFinishId} disabled /></Field>
              <Field label="Hardware"><input value={selectedDrawer.runner === null ? "Runner pair (resolved in BOM)" : `${String(selectedDrawer.runner.systemHeightMm)} mm runner`} disabled /></Field>
            </>
          )}
        </>
      )}
      <div className="row">
        <Action kind="primary" label="Save" disabled={!canEdit} run={save} />
        <Action kind="danger" label="Remove" disabled={!canEdit} run={onRemove} />
      </div>
      <details>
        <summary>Finish (from the resolved model)</summary>
        {noFront
          ? <p>Carcass <code>{instance.finish.carcassMaterialId}</code> · Back <code>{instance.finish.backMaterialId}</code> (no front{isOvenTower ? " this slice" : ": open cabinet"})</p>
          : <p>Carcass <code>{instance.finish.carcassMaterialId}</code> · Back <code>{instance.finish.backMaterialId}</code> · Front <code>{instance.finish.frontMaterialId}</code> · Finish <code>{instance.finish.frontFinishId}</code></p>}
      </details>
      {!noFront && (
        <details>
          <summary>Hardware (rule-derived, not chosen here)</summary>
          {isDrawer ? (
            <p>One runner pair per drawer ({element?.kind === "DRAWER_BANK" ? element.drawers.length : 0} drawer(s)). See the BOM tab for the resolved articles.</p>
          ) : isPullout ? (
            <p>{instance.hardware.hinges.length} hinge(s), one runner pair per pull-out frame ({instance.internals.length} frame(s)). See the BOM tab for the resolved articles.</p>
          ) : isSink ? (
            <p>{instance.hardware.hinges.length} hinge(s){instance.internals.length > 0 ? ", one runner pair for the waste-bin tray" : ""}. See the BOM tab for the resolved articles.</p>
          ) : (
            <p>{instance.hardware.hinges.length} hinge(s){instance.hardware.hinges[0] === undefined ? "" : `, mounting ${instance.hardware.hinges[0].mounting}`}. See the BOM tab for the full hardware list.</p>
          )}
        </details>
      )}
    </>
  );
}
