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
import type { CornerId } from "@lintel/cabinet-engine";
import { CABINET_LIBRARY, compileCreate, compileUpdate, cornerPairPlacement, decodeCabinetInstance, findAvailableCabinetType } from "@lintel/cabinet-engine";
import type { ScreenProps } from "../App";
import type { ModelPreview, Schemas } from "../api/client";
import { api, idempotency, must, versionWithEtag } from "../api/client";
import { isFarEndAnchored, nearestWall, nextFreeAlong, placeOnWall } from "../geometry";
import type { WallId } from "../geometry";
import { packAgainstCorner, shiftedChainOverlaps } from "../cornerAttach";
import type { CornerAttachItem } from "../cornerAttach";
import { snapshotOf, SnapshotView } from "./Outputs";
import { usablePins } from "./Layout";
import type { Param, Pins } from "./Layout";
import { Elevation, Plan, ValidationBadges } from "./Preview";
import { planReflow } from "../reflow";
import type { ReflowObject } from "../reflow";
import { Action, Badge, ErrorBox, ErrorBoundary, Field, Section, useLoad } from "../ui";
import type { DimensionLimit } from "../validation";
import { dimensionError } from "../validation";
import { classifyValidationCode } from "../validationGroups";
import { Viewport3D } from "./Viewport3D";

const ELEVATION_WALLS = ["A", "B", "C", "D"] as const;

type Obj = ModelPreview["objects"][number];

/** Slice 6B: the selected cabinet's run membership, derived (never stored) from the resolved model's own
 * `runs`/`relationships`. `position` is 1-based (this cabinet is the Nth of `count` in the run). */
interface RunInfo {
  readonly runId: string;
  readonly wallId: string;
  readonly count: number;
  readonly length: number;
  readonly position: number;
  readonly adjacents: readonly { readonly code: string; readonly gap: number; readonly touching: boolean; readonly side: "left" | "right" }[];
}

/** P1-2 (expose corner relationship): plain-language projection of the engine's own derived `CORNER`
 * relationship for the selected cabinet — never a new fact, just `m.relationships` read and worded for a
 * designer instead of an engineer (no relationship ids, no "DERIVED"/"CORNER" type strings). `cornerLabel`
 * matches `relationships[].wallIds` exactly as `packages/design-engine/src/room.ts`'s own `CORNERS` list orders
 * them (e.g. "AB" for the A→B corner) — the same short, wall-letter naming already used for wall selectors
 * throughout this screen, not a new vocabulary. */
interface CornerInfo {
  readonly cornerLabel: string;
  readonly wallId: string;
  readonly otherWallId: string;
  readonly otherCode: string;
  readonly gapMm: number;
  readonly touching: boolean;
}

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

/** Remediation P0: a pinned product's own declared min/max for one dimension key, or `{min:null,max:null}` (no
 * limit declared) when the key isn't found — never invented, always read off the exact catalog data the recipe
 * itself resolves against (see `apps/db-tools/src/pilot/rehearsal-dataset.ts`'s `withLimits`). */
function limitOf(params: readonly Param[], key: string): DimensionLimit {
  const p = params.find((x) => x.key === key);
  return { min: p?.min ?? null, max: p?.max ?? null };
}

/** Hardening (P1-1/P1-2/P1-3): the lineage ids of every object that's one leg of a CORNER relationship — the
 * engine's own derived fact (`packages/design-engine/src/room.ts`'s `CORNERS` loop), read the same way in all
 * three places that need it: corner-aware placement, the Properties panel's "Corner" readout, and resize/reflow's
 * fixed-boundary check. Never a separate "is this a corner leg" flag on the object itself. */
function cornerLineageIdsOf(m: ModelPreview): Set<string> {
  return new Set(m.relationships.filter((r) => r.type === "CORNER").flatMap((r) => r.lineageIds));
}

/** Remediation P2: every reference-data entity of `type` that has at least one usable (pinnable) version,
 * by its exact catalog code — never invented, always the live TEST_FIXTURE/reference catalog. */
async function usableCodes(type: "material" | "finish"): Promise<string[]> {
  const r = await must(api.GET("/api/v1/reference-data/{type}/entities", { params: { path: { type }, query: { limit: 200 } } }));
  return r.items.filter((e) => e.usableVersions.length > 0).map((e) => e.code).sort();
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

  /** Takes an explicit `forDesignId` rather than reading the outer `designId` closure — needed right after
   * creating a brand-new design (below), where that outer `designId` is still stale (computed at the start of
   * this render, before the design existed). */
  const createVersionFor = async (forDesignId: string, basedOn?: Schemas["VersionResponse"]): Promise<void> => {
    const { pins, missing } = await usablePins();
    if (missing.length > 0) throw new Error(`No APPROVED reference data for: ${missing.join(", ")}`);
    const v = await must(api.POST("/api/v1/designs/{designId}/versions", {
      params: { path: { designId: forDesignId }, header: { "Idempotency-Key": idempotency() } },
      body: { pins: pins as Pins, changeReason: basedOn === undefined ? "Design Studio" : `Changes after version ${String(basedOn.versionNumber)}`, ...(basedOn === undefined ? {} : { basedOnVersionId: basedOn.id }) },
    }));
    setSel({ ...sel, designId: forDesignId, versionId: v.id });
    versions.reload();
  };
  const createVersion = (basedOn?: Schemas["VersionResponse"]): Promise<void> => (designId === undefined ? Promise.resolve() : createVersionFor(designId, basedOn));

  return (
    <>
      <Section title="Design and version">
        <ErrorBox error={designs.error ?? versions.error} />
        {designs.data?.items.length === 0 ? (
          <div className="row">
            <Field label="Design name"><input value={designName} onChange={(e) => { setDesignName(e.target.value); }} /></Field>
            {/* Creation friction: a brand-new design's first version is created in this same click whenever
                reference data is already usable — previously this always needed a second, separate "Create
                version" click even though nothing new was being decided between the two. Re-versioning an
                EXISTING design (a deliberate "changes after vN" decision) stays its own explicit action below. */}
            <Action kind="primary" label="Create design" run={async () => {
              const d = await must(api.POST("/api/v1/rooms/{roomId}/designs", { params: { path: { roomId }, header: { "Idempotency-Key": idempotency() } }, body: { name: designName.trim() } }));
              setSel({ ...sel, designId: d.id, versionId: undefined });
              designs.reload();
              const { missing } = await usablePins();
              if (missing.length === 0) await createVersionFor(d.id);
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
  const [bottomTab, setBottomTab] = useState<"PLAN" | "ELEVATION" | "BOM" | "VALIDATION">("PLAN");
  /** Slice 6E: clicking a validation issue selects its object (highlighted in every synchronized view — Slice
   * 6D's shared `selectedId`) and switches to Plan, the most generally useful view for the spatial checks (overlap,
   * wall penetration, room boundary, corner placement, near-miss gap) this slice implements. */
  const goToValidationIssue = (lineageId: string | null): void => {
    selectObject(lineageId);
    if (lineageId !== null) setBottomTab("PLAN");
  };
  const [bom, setBom] = useState<Schemas["Snapshot"] | null>(null);
  /** Remediation P1: which of the room's 4 walls the Elevation tab currently draws — a view choice only, never
   * a separate per-wall model (Elevation still derives every cabinet from this same resolved `m`). */
  const [elevationWall, setElevationWall] = useState<WallId>("A");
  const m = model.data;
  const objects = m?.objects ?? [];
  const selected: Obj | undefined = objects.find((o) => o.lineageId === selectedId) ?? objects[0];
  const cabinetType: CabinetType | undefined = selected === undefined ? undefined : findAvailableCabinetType(selected.productCode);
  const refresh = () => { setN((x) => x + 1); model.reload(); };

  /** Remediation P0: the selected cabinet's own pinned product limits (width/height/depth min/max), fetched once
   * per product code — the same source `pinnedProductByCode` already reads for a brand-new cabinet's defaults,
   * reused here so an *edit* is checked against the identical real catalog limits. */
  const limits = useLoad(
    () => (selected === undefined ? Promise.resolve(null) : pinnedProductByCode(version.pins.productCatalogVersionId, selected.productCode)),
    `slimits:${selected?.productCode ?? ""}:${version.pins.productCatalogVersionId}`,
  );
  const dimensionLimits = limits.data === null ? undefined : {
    width: limitOf(limits.data.params, "width"),
    height: limitOf(limits.data.params, "height"),
    depth: limitOf(limits.data.params, "depth"),
  };

  /** Remediation P2: the live catalog's own usable materials/finishes, fetched once (not per cabinet) — the
   * Properties panel offers exactly these, never an invented value. */
  const materials = useLoad(() => usableCodes("material"), "smaterials");
  const finishes = useLoad(() => usableCodes("finish"), "sfinishes");

  /** Remediation P0: `decodeCabinetInstance` throws when a persisted value (e.g. an out-of-range width saved
   * before this fix existed) leaves the recipe unable to generate the components it needs to decode — see
   * `packages/cabinet-engine/src/decode.ts`'s `requireComponent`. Catching it here means that ONE cabinet's bad
   * data degrades only the Properties panel, with a clear, visible message and a way back (deselect), instead of
   * throwing during render and blanking the whole screen. The `ErrorBoundary` further down is the secondary net
   * for anything else unexpected. A discriminated union (rather than two loose nullable variables) keeps
   * `selected` and its successfully decoded `instance` tied together, so the render below never needs to assert
   * past `undefined`. */
  type PropertiesState = { readonly kind: "none" } | { readonly kind: "error"; readonly message: string } | { readonly kind: "ok"; readonly selected: Obj; readonly instance: CabinetInstance };
  const propertiesState: PropertiesState = (() => {
    if (selected === undefined || cabinetType === undefined) return { kind: "none" };
    try {
      return { kind: "ok", selected, instance: decodeCabinetInstance(selected, cabinetType) };
    } catch (e) {
      return { kind: "error", message: e instanceof Error ? e.message : String(e) };
    }
  })();

  /** Slice 6B: the selected cabinet's run membership and adjacency, straight from the engine's own derived
   * `runs`/`relationships` (see packages/design-engine/src/room.ts) — a run is emergent from geometry, not a
   * separate entity, so there is nothing new to compute here, only to surface. */
  const runInfo: RunInfo | null = (() => {
    if (m === null || selected === undefined) return null;
    const run = m.runs.find((r) => r.lineageIds.includes(selected.lineageId));
    if (run === undefined) return null;
    const position = run.lineageIds.indexOf(selected.lineageId) + 1;
    const adjacents = m.relationships
      .filter((rel) => rel.type === "ADJACENT" && rel.lineageIds.includes(selected.lineageId))
      .map((rel) => {
        const otherId = rel.lineageIds.find((id) => id !== selected.lineageId);
        const other = objects.find((o) => o.lineageId === otherId);
        const side: "left" | "right" = run.lineageIds.indexOf(otherId ?? "") < position - 1 ? "left" : "right";
        return { code: other?.objectCode ?? "?", gap: rel.gap ?? 0, touching: rel.touching ?? false, side };
      });
    return { runId: run.runId, wallId: run.wallId, count: run.lineageIds.length, length: run.length, position, adjacents };
  })();

  /** P1-2: same idea as `runInfo` just above, for the engine's derived `CORNER` relationship instead of
   * `SAME_WALL_RUN`/`ADJACENT` — nothing computed, only read and worded for a designer. */
  const cornerInfo: CornerInfo | null = (() => {
    if (m === null || selected === undefined) return null;
    const rel = m.relationships.find((r) => r.type === "CORNER" && r.lineageIds.includes(selected.lineageId));
    if (rel === undefined) return null;
    const otherId = rel.lineageIds.find((id) => id !== selected.lineageId);
    const other = objects.find((o) => o.lineageId === otherId);
    const wallId = selected.placement?.wallId ?? rel.wallIds[0] ?? "?";
    const otherWallId = rel.wallIds.find((w) => w !== wallId) ?? rel.wallIds[rel.wallIds.length - 1] ?? "?";
    return { cornerLabel: rel.wallIds.join(""), wallId, otherWallId, otherCode: other?.objectCode ?? "?", gapMm: rel.gap ?? 0, touching: rel.touching ?? false };
  })();

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
    /** Slice 6C: a filler/end panel is one finished panel — no front, no internals, no hardware at all (the
     * strictest `noFront` case: unlike KIT_BASE_OPEN/KIT_TALL_OVEN, its `finish` really is applied, never
     * vestigial). */
    const isPanel = type.productCode === "KIT_FILLER" || type.productCode === "KIT_END_PANEL";
    const noFront = isOpen || isOvenTower || isPanel;
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
      internals: isPanel ? [] : noFront ? shelves(defaultShelfCount) : isPullout ? pullouts(defaultPulloutCount) : [],
      corner: null,
      finish: {
        carcassMaterialId: paramString(p.params, "material"),
        backMaterialId: paramString(p.params, "backMaterial"),
        frontMaterialId: paramString(p.params, noFront ? "material" : isDrawer ? "frontMaterial" : "shutterMaterial"),
        frontFinishId: isPanel ? paramString(p.params, "finish") : noFront ? "" : paramString(p.params, "finish"),
      },
      hardware: { hinges: [], runners: [], handle: null },
    };
  };

  const createObject = async (instance: CabinetInstance) => {
    const { etag } = await versionWithEtag(versionId);
    const body = compileCreate(instance);
    return must(api.POST("/api/v1/design-versions/{versionId}/objects", { params: { path: { versionId }, header: { "If-Match": etag } }, body }));
  };

  /** Hardening (real-designer UX audit P0-1, generalised in P1-1): placed on the wall the designer actually
   * chose in the library panel, never hardcoded to wall A — the next free position is computed in THAT wall's
   * own along-wall coordinates (from the objects already resolved onto it), then converted to a room
   * position/rotation by the same `placeOnWall` the Properties panel's Wall/Along/Distance fields and Plan's
   * drag-to-snap already use. There is no separate "add-time" placement model: this is the one room-wall model
   * every view derives from.
   *
   * P1-1 (run + corner continuity): if this wall already carries a corner leg flush against its FAR end (a
   * "return leg" — see `geometry.ts`'s `isFarEndAnchored`), the new cabinet packs against it instead of being
   * appended past it (`nextFreeAlong`) — the same anchor `addCornerPair` below packs an existing run against
   * when the corner is added second, so the two build orders converge on the identical layout. */
  const addCabinet = async (type: CabinetType, wallId: WallId) => {
    const p = await pinnedProductByCode(version.pins.productCatalogVersionId, type.productCode);
    if (p === null) throw new Error(`The pinned product catalog does not define ${type.productCode}.`);
    if (m === null) throw new Error("The room's model has not loaded yet.");
    const width = paramNumber(p.params, "width");
    if (width === undefined) throw new Error("The pinned product does not define a default width.");
    const onWall = objects.filter((o): o is Obj & { placement: NonNullable<Obj["placement"]> } => o.placement !== null && o.placement.wallId === wallId);
    const cornerIds = cornerLineageIdsOf(m);
    const wallLength = m.room.walls.find((w) => w.wallId === wallId)?.length ?? (wallId === "A" || wallId === "C" ? m.room.length : m.room.width);
    const farEndLeg = onWall.find((o) => cornerIds.has(o.lineageId) && isFarEndAnchored(o.placement.alongWall.end, wallLength));
    const others = farEndLeg === undefined ? onWall : onWall.filter((o) => o.lineageId !== farEndLeg.lineageId);
    const alongMm = nextFreeAlong(
      others.map((o) => ({ id: o.objectId, x: o.placement.alongWall.start, width: o.dimensions.width })),
      width,
      farEndLeg?.placement.alongWall.start,
    );
    const moved = placeOnWall(wallId, alongMm, 0, m.room.length, m.room.width);
    const position = { xMm: moved.x, yMm: 0, zMm: moved.z };
    const instance = buildInstance(type, p, nextObjectCode(), position, moved.rotationY);
    const created = await createObject(instance);
    selectObject(created.object.lineageId);
    refresh();
  };

  /** Slice 4 (D-A corner only), generalised to all 4 room corners in Slice 6C: an L-corner cabinet is two
   * ordinary `type` instances, positioned by `cornerPairPlacement` so their footprints meet exactly at the
   * chosen room corner without overlap (`corner.ts`). Two sequential creates, re-reading the version's ETag
   * between them (the first create advances it).
   *
   * P1-1 (run + corner continuity): `cornerPairPlacement`'s two legs are always flush against the room's own
   * physical corner — never negotiable. What a build-order can leave wrong is either wall's *pre-existing* run:
   * built before the corner (Order A), it doesn't yet know to stop short of the leg (an accidental gap); it
   * could equally already occupy the space the leg now needs (an overlap). Both are closed by packing that
   * whole existing chain, as one rigid group, flush against the new leg (`packAgainstCorner` — same helper,
   * both walls), BEFORE either object is created: if it can't fit, nothing is written and the designer sees why
   * (never a silent overlap). This is what makes "run then corner" and "corner then run" converge on the exact
   * same resolved layout — `addCabinet` above packs the other direction, against an already-placed leg. */
  const addCornerPair = async (type: CabinetType, corner: CornerId) => {
    if (m === null) throw new Error("The room's model has not loaded yet.");
    const p = await pinnedProductByCode(version.pins.productCatalogVersionId, type.productCode);
    if (p === null) throw new Error(`The pinned product catalog does not define ${type.productCode}.`);
    const width = paramNumber(p.params, "width");
    const depth = paramNumber(p.params, "depth");
    if (width === undefined || depth === undefined) throw new Error("The pinned product does not define default width/depth.");
    const { returnLeg, frontLeg } = cornerPairPlacement(corner, { widthMm: width, depthMm: depth }, { lengthMm: m.room.length, widthMm: m.room.width });

    const cornerIds = cornerLineageIdsOf(m);
    const wallLenOf = (wallId: WallId): number => m.room.walls.find((w) => w.wallId === wallId)?.length ?? (wallId === "A" || wallId === "C" ? m.room.length : m.room.width);
    const chainOn = (wallId: WallId): readonly (Obj & { placement: NonNullable<Obj["placement"]> })[] =>
      objects.filter((o): o is Obj & { placement: NonNullable<Obj["placement"]> } =>
        o.placement !== null && o.placement.wallId === wallId && o.placement.distanceToWall <= 1 && !cornerIds.has(o.lineageId));
    const asItems = (chain: readonly (Obj & { placement: NonNullable<Obj["placement"]> })[]): readonly CornerAttachItem[] =>
      chain.map((o) => ({ id: o.objectId, start: o.placement.alongWall.start, end: o.placement.alongWall.end }));

    const w1 = nearestWall(returnLeg.position.xMm, returnLeg.position.zMm, m.room.length, m.room.width);
    const w2 = nearestWall(frontLeg.position.xMm, frontLeg.position.zMm, m.room.length, m.room.width);
    const chain1 = chainOn(w1.wallId);
    const chain2 = chainOn(w2.wallId);
    const plan1 = packAgainstCorner(asItems(chain1), { start: w1.along, end: w1.along + width, endAnchored: true }, wallLenOf(w1.wallId));
    const plan2 = packAgainstCorner(asItems(chain2), { start: w2.along, end: w2.along + width, endAnchored: false }, wallLenOf(w2.wallId));
    for (const [wallId, plan, chain] of [[w1.wallId, plan1, chain1], [w2.wallId, plan2, chain2]] as const) {
      if (plan.kind === "blocked") throw new Error(`Wall ${wallId}: ${plan.message}`);
      if (plan.kind === "shift") {
        const others = objects
          .filter((o): o is Obj & { placement: NonNullable<Obj["placement"]> } => o.placement !== null && o.placement.wallId === wallId && !chain.some((c) => c.objectId === o.objectId))
          .map((o) => ({ id: o.objectId, start: o.placement.alongWall.start, end: o.placement.alongWall.end }));
        if (shiftedChainOverlaps(asItems(chain), plan.deltaMm, others)) throw new Error(`Wall ${wallId}: closing the gap to the corner would overlap another cabinet on this wall. Move it out of the way first.`);
      }
    }

    const returnInstance = buildInstance(type, p, nextObjectCode(), returnLeg.position, returnLeg.rotationY, "INSET");
    await createObject(returnInstance);
    const frontInstance = buildInstance(type, p, nextObjectCode(1), frontLeg.position, frontLeg.rotationY, "INSET");
    const frontCreated = await createObject(frontInstance);
    for (const [wallId, plan] of [[w1.wallId, plan1], [w2.wallId, plan2]] as const) {
      if (plan.kind !== "shift") continue;
      for (const s of plan.shifts) {
        const obj = objects.find((o) => o.objectId === s.id);
        const moved = placeOnWall(wallId, s.start, obj?.placement?.distanceToWall ?? 0, m.room.length, m.room.width);
        await patchObject(s.id, { position: { xMm: moved.x, yMm: obj?.transform.y ?? 0, zMm: moved.z }, rotationY: moved.rotationY });
      }
    }
    selectObject(frontCreated.object.lineageId);
    refresh();
  };

  const patchObject = async (objectId: string, body: object) => {
    const { etag } = await versionWithEtag(versionId);
    await must(api.PATCH("/api/v1/design-objects/{objectId}", { params: { path: { objectId }, header: { "If-Match": etag } }, body }));
  };

  /** Hardening (real-designer UX audit P0-3): a width change that would otherwise leave a run cabinet overlapping
   * its right-hand neighbour instead shifts every following same-run cabinet by the same amount, keeping the run
   * contiguous — computed by `planReflow` from the model's own run/relationship data, never a separate placement
   * model. When the shift is impossible (would push a cabinet off the wall, or would need to move a corner leg),
   * NOTHING is written — not even the resize itself — so the previous valid state is exactly preserved and the
   * designer sees a clear reason why, instead of a silent overlap. */
  const saveCabinet = async (current: Obj, next: CabinetInstance) => {
    const deltaMm = next.dimensions.widthMm - current.dimensions.width;
    const run = m === null || current.placement === null ? undefined : m.runs.find((r) => r.lineageIds.includes(current.lineageId));
    const runWallId = run === undefined ? null : run.wallId;
    const plan = run === undefined || runWallId === null || m === null
      ? { kind: "none" as const }
      : planReflow(
        {
          runLineageIds: run.lineageIds,
          wallId: runWallId,
          wallLength: m.room.walls.find((w) => w.wallId === run.wallId)?.length ?? run.length,
          cornerLineageIds: new Set(m.relationships.filter((r) => r.type === "CORNER").flatMap((r) => r.lineageIds)),
          objectsByLineageId: new Map(objects.flatMap((o): [string, ReflowObject][] => (o.placement === null ? [] : [[o.lineageId, {
            objectId: o.objectId, objectCode: o.objectCode, alongWall: o.placement.alongWall, distanceToWall: o.placement.distanceToWall, yMm: o.transform.y,
          }]]))),
        },
        current.lineageId,
        deltaMm,
      );
    if (plan.kind === "blocked") throw new Error(plan.message);
    await patchObject(current.objectId, compileUpdate(next));
    if (plan.kind === "shift" && m !== null && runWallId !== null) {
      for (const s of plan.shifts) {
        const moved = placeOnWall(runWallId, s.along, s.distanceToWall, m.room.length, m.room.width);
        await patchObject(s.objectId, { position: { xMm: moved.x, yMm: s.yMm, zMm: moved.z }, rotationY: moved.rotationY });
      }
    }
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
      <ErrorBoundary resetKey={`${versionId}:${String(n)}`} onReset={refresh}>
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
                <button type="button" className={bottomTab === "VALIDATION" ? "current" : ""} onClick={() => { setBottomTab("VALIDATION"); }}>
                  Validation{m !== null && (m.validation.counts.BLOCKER + m.validation.counts.ERROR) > 0 ? ` (${String(m.validation.counts.BLOCKER + m.validation.counts.ERROR)})` : ""}
                </button>
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
                <>
                  {/* Remediation P1: a wall selector, not another hardcoded wall — every one of the room's 4
                      walls is always selectable, since a rectangular room always has all 4. */}
                  <nav className="studio-tabs elevation-walls">
                    {ELEVATION_WALLS.map((w) => (
                      <button key={w} type="button" className={elevationWall === w ? "current" : ""} onClick={() => { setElevationWall(w); }}>Wall {w}</button>
                    ))}
                  </nav>
                  <Elevation
                    m={m} wallId={elevationWall} selectedId={selected?.lineageId ?? null} onSelect={selectObject}
                    selectedComponentId={selectedComponentId} onSelectComponent={selectComponent}
                  />
                </>
              )}
              {bottomTab === "BOM" && (
                <div className="studio-bom">
                  <Action kind="primary" label="Generate BOM (PRELIMINARY)" run={async () => {
                    const created = await must(api.POST("/api/v1/design-versions/{versionId}/bom-snapshots", { params: { path: { versionId }, header: { "Idempotency-Key": idempotency() } }, body: { purpose: "PRELIMINARY" } }));
                    setBom(await snapshotOf("BOM", created.snapshot.id));
                  }} />
                  {bom !== null && <SnapshotView s={bom} objects={objects.map((o) => ({ lineageId: o.lineageId, objectCode: o.objectCode }))} />}
                </div>
              )}
              {m !== null && bottomTab === "VALIDATION" && <ValidationPanel m={m} onGoTo={goToValidationIssue} />}
              {m !== null && objects.length === 0 && <p>Add a cabinet from the library to begin.</p>}
            </div>
          </div>
          <aside className="studio-properties">
            {propertiesState.kind === "error" ? (
              <div className="error" role="alert">
                <p><strong>This cabinet&apos;s data could not be resolved:</strong> {propertiesState.message}</p>
                <p>This usually means a saved value (e.g. a width) is outside what the current product recipe can
                  build. The rest of the design is unaffected. Check the Validation tab, then fix or remove this
                  cabinet.</p>
                <button type="button" onClick={() => { selectObject(null); }}>Deselect this cabinet</button>
              </div>
            ) : propertiesState.kind === "ok" ? (
              <PropertiesPanel
                instance={propertiesState.instance}
                canEdit={canEdit}
                onSave={(next) => saveCabinet(propertiesState.selected, next)}
                onRemove={() => removeCabinet(propertiesState.selected.objectId)}
                selectedComponentId={selectedComponentId}
                onSelectComponentId={(componentId) => { setSelectedComponentId(componentId); }}
                applianceId={typeof propertiesState.selected.parameters.oven === "string" ? propertiesState.selected.parameters.oven : typeof propertiesState.selected.parameters.hob === "string" ? propertiesState.selected.parameters.hob : null}
                placement={propertiesState.selected.placement}
                room={m === null ? null : { length: m.room.length, width: m.room.width }}
                runInfo={runInfo}
                cornerInfo={cornerInfo}
                dimensionLimits={dimensionLimits}
                materials={materials.data ?? []}
                finishes={finishes.data ?? []}
              />
            ) : <p>Select a cabinet, or add one from the library.</p>}
          </aside>
        </div>
      </ErrorBoundary>
    </Section>
  );
}

/**
 * Slice 6E: the Design Studio's own validation panel — part of the workspace (a bottom-bar tab alongside Plan /
 * Elevation / BOM), not a separate screen. Reads only `m.validation`/`m.objects[].messages`, the same resolved
 * model every other view reads; it computes nothing (no collision/containment/gap logic lives here — see
 * `packages/design-engine/src/room.ts` and `resolve-cabinet.ts`). BLOCKER and ERROR are bucketed together as
 * "Errors" for this display only; the underlying BLOCKER/ERROR distinction (which gates `canApprove`) is
 * untouched. Clicking an issue selects its object — highlighted, via Slice 6D's shared `selectedId`, in Plan,
 * Elevation and the 3D viewport alike — and switches to the most useful view for it.
 */
/** P1-4 (validation signal cleanup): one design/reference-data message list, rendered identically in both of
 * `ValidationPanel`'s sections below — same click-to-locate behaviour as before this split, just filtered. */
function ValidationIssueList({ items, codeOf, onGoTo }: { readonly items: readonly ModelPreview["validation"]["messages"][number][]; readonly codeOf: ReadonlyMap<string, string>; readonly onGoTo: (lineageId: string | null) => void }) {
  return (
    <ul className="validation-list">
      {items.map((x, i) => (
        <li key={i}>
          <button
            type="button"
            className="validation-issue"
            disabled={x.lineageId === null}
            title={x.lineageId === null ? "Room-level check — no single cabinet to select" : "Select and locate this cabinet"}
            onClick={() => { onGoTo(x.lineageId); }}
          >
            <Badge tone={x.severity === "WARNING" ? "warn" : "bad"}>{x.severity}</Badge> <code>{x.code}</code> — {x.lineageId === null ? "Room" : codeOf.get(x.lineageId) ?? "Object"}: {x.message}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** P1-4 (validation signal cleanup): the same underlying `m.validation.messages` as before — no severity, code
 * or count is removed or weakened (`STANDARD_UNKNOWN_VARIABLE` included) — split into "Design issues" (what a
 * designer can fix by moving, resizing or replacing a cabinet: collision, wall/room boundary, corner/run
 * continuity, clearances, appliance conflicts) and "Reference/data health" (gaps in the construction
 * standard/catalog/recipe data itself, e.g. an undeclared variable) via `classifyValidationCode`. The post-P0
 * benchmark's finding this addresses: a designer reading "94 ERROR" during a whole session had no way to tell,
 * from the badge alone, that all 94 were reference-data noise and zero were about placement. */
function ValidationPanel({ m, onGoTo }: { readonly m: ModelPreview; readonly onGoTo: (lineageId: string | null) => void }) {
  const codeOf = new Map(m.objects.map((o) => [o.lineageId, o.objectCode]));
  const design = m.validation.messages.filter((x) => classifyValidationCode(x.code) === "DESIGN");
  const referenceData = m.validation.messages.filter((x) => classifyValidationCode(x.code) === "REFERENCE_DATA");
  const blockersOf = (list: typeof design) => list.filter((x) => x.severity === "BLOCKER" || x.severity === "ERROR");
  const warningsOf = (list: typeof design) => list.filter((x) => x.severity === "WARNING");
  const designBlockers = blockersOf(design);
  const designWarnings = warningsOf(design);
  const refBlockers = blockersOf(referenceData);
  const refWarnings = warningsOf(referenceData);
  const passedCount = m.objects.filter((o) => o.messages.length === 0).length + (m.validation.messages.some((x) => x.lineageId === null) ? 0 : 1);

  return (
    <div className="studio-validation">
      <section className="validation-group">
        <h3>Design issues</h3>
        <p>
          <Badge tone={designBlockers.length > 0 ? "bad" : "ok"}>{designBlockers.length > 0 ? "❌" : "✓"} {designBlockers.length} Design Blocker{designBlockers.length === 1 ? "" : "s"}</Badge>{" "}
          <Badge tone={designWarnings.length > 0 ? "warn" : "ok"}>⚠ {designWarnings.length} Design Warning{designWarnings.length === 1 ? "" : "s"}</Badge>{" "}
          <Badge tone="ok">✓ {passedCount} Passed</Badge>
        </p>
        <small>Collision, wall/room boundary, corner and run continuity, clearances, appliance conflicts — problems with how this design is actually placed and sized.</small>
        {design.length === 0
          ? <p>No design issues — every placement, sizing, corner and run check on the current design passed. A designer can trust this design to be manufacturable as placed.</p>
          : <ValidationIssueList items={design} codeOf={codeOf} onGoTo={onGoTo} />}
      </section>
      <section className="validation-group">
        <h3>Reference/data health</h3>
        <p>
          <Badge tone="info">{refBlockers.length} Reference issue{refBlockers.length === 1 ? "" : "s"}</Badge>{" "}
          <Badge tone="info">{refWarnings.length} Reference warning{refWarnings.length === 1 ? "" : "s"}</Badge>
        </p>
        <small>Gaps in the underlying construction standard, catalog or recipe data itself (e.g. an unresolved reference-data variable, code <code>STANDARD_UNKNOWN_VARIABLE</code>) — not something a designer can fix by moving or resizing a cabinet.</small>
        {referenceData.length === 0
          ? <p>No reference/data-health issues.</p>
          : <ValidationIssueList items={referenceData} codeOf={codeOf} onGoTo={onGoTo} />}
      </section>
    </div>
  );
}

const CORNERS: readonly { readonly id: CornerId; readonly label: string }[] = [
  { id: "DA", label: "D-A" },
  { id: "AB", label: "A-B" },
  { id: "BC", label: "B-C" },
  { id: "CD", label: "C-D" },
];

const WALLS: readonly { readonly id: WallId; readonly label: string }[] = [
  { id: "A", label: "A" },
  { id: "B", label: "B" },
  { id: "C", label: "C" },
  { id: "D", label: "D" },
];

function CabinetLibraryPanel({ canEdit, onAdd, onAddCornerPair }: { readonly canEdit: boolean; readonly onAdd: (type: CabinetType, wall: WallId) => Promise<void>; readonly onAddCornerPair: (type: CabinetType, corner: CornerId) => Promise<void> }) {
  const categories = ["BASE", "WALL", "TALL", "CORNER", "FILLER"] as const;
  /** Hardening (real-designer UX audit P0-1): which wall the next plain "+ Add" places against — every ordinary
   * cabinet used to always land on wall A regardless of intent; this is now an explicit designer choice, exactly
   * like the existing Corner selector already is for "+ Add pair". */
  const [wall, setWall] = useState<WallId>("A");
  /** Slice 6C: which of the room's 4 corners the next "+ Add pair" click places at (was D-A only). */
  const [corner, setCorner] = useState<CornerId>("DA");
  return (
    <>
      <h3>Cabinet library</h3>
      <Field label="Add to wall" hint="Where a plain “+ Add” places the next cabinet.">
        <select value={wall} disabled={!canEdit} onChange={(e) => { setWall(e.target.value as WallId); }}>
          {WALLS.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
      </Field>
      {categories.map((category) => (
        <div key={category} className="cabinet-lib-group">
          <h4>{category}</h4>
          {category === "CORNER" && (
            <Field label="Corner">
              <select value={corner} disabled={!canEdit} onChange={(e) => { setCorner(e.target.value as CornerId); }}>
                {CORNERS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </Field>
          )}
          {CABINET_LIBRARY.filter((e) => e.category === category).map((entry) => {
            const availability = entry.availability;
            return (
              <div key={entry.cabinetTypeId} className={`cabinet-lib-item ${availability.kind === "PLANNED" ? "planned" : ""}`}>
                <div>
                  <strong>{entry.label}</strong>
                  <p>{entry.description}</p>
                </div>
                {availability.kind === "AVAILABLE" && <Action label="+ Add" disabled={!canEdit} run={() => onAdd(availability.cabinetType, wall)} />}
                {availability.kind === "AVAILABLE_CORNER_PAIR" && <Action label="+ Add pair" disabled={!canEdit} run={() => onAddCornerPair(availability.cabinetType, corner)} />}
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

function PropertiesPanel({ instance, canEdit, onSave, onRemove, selectedComponentId, onSelectComponentId, applianceId, placement, room, runInfo, cornerInfo, dimensionLimits, materials, finishes }: {
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
  /** Slice 6B: this cabinet's run membership (null only when it isn't placed at all), read-only — a run is
   * derived from geometry, never edited directly; a cabinet with no neighbour is simply a run of one. */
  readonly runInfo: RunInfo | null;
  /** P1-2: this cabinet's corner membership (null when it isn't one leg of a corner pair), read-only, worded for
   * a designer — "the AB corner", never the relationship's own id or type string. */
  readonly cornerInfo: CornerInfo | null;
  /** Remediation P0: the pinned product's own width/height/depth limits, checked before Save so an out-of-range
   * value is rejected here instead of being persisted (undefined limits, e.g. while still loading, mean "not
   * checked yet" — never treated as "anything goes"; the server's own validation still applies regardless). */
  readonly dimensionLimits?: { readonly width: DimensionLimit; readonly height: DimensionLimit; readonly depth: DimensionLimit } | undefined;
  /** Remediation P2: the live catalog's own usable material/finish codes — never invented, always exactly what
   * `reference-data/material` and `reference-data/finish` currently list as usable. */
  readonly materials: readonly string[];
  readonly finishes: readonly string[];
}) {
  const isDrawer = instance.recipe.productCode === "KIT_BASE_DRAWER";
  const isOpen = instance.recipe.productCode === "KIT_BASE_OPEN";
  const isPullout = instance.recipe.productCode === "KIT_BASE_PULLOUT";
  const isOvenTower = instance.recipe.productCode === "KIT_TALL_OVEN";
  const isSink = instance.recipe.productCode === "KIT_BASE_SINK";
  const isHob = instance.recipe.productCode === "KIT_BASE_HOB";
  /** Slice 6C: a filler/end panel has no front, no internals, no hardware — the strictest `noFront` case. */
  const isPanel = instance.recipe.productCode === "KIT_FILLER" || instance.recipe.productCode === "KIT_END_PANEL";
  const noFront = isOpen || isOvenTower || isPanel;
  const element = instance.front.rows[0]?.columns[0]?.element;
  const currentShutterCount = !isDrawer && !noFront && instance.front.rows[0]?.columns.length === 2 ? 2 : 1;
  const currentDrawerCount = element?.kind === "DRAWER_BANK" && (DRAWER_COUNTS as readonly number[]).includes(element.drawers.length) ? (element.drawers.length as 2 | 3 | 4) : 3;
  const currentOverlay: OverlayMode = element?.kind === "SHUTTER" || element?.kind === "DRAWER_BANK" ? element.overlay : "OVERLAY";
  const currentShelfCount = noFront && !isPanel ? instance.internals.length : 0;
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
  /** Remediation P2: editable material/finish, initialised from the resolved model and resynced whenever a
   * different cabinet is selected, exactly like every other field above. */
  const [carcassMaterialId, setCarcassMaterialId] = useState(instance.finish.carcassMaterialId);
  const [frontMaterialId, setFrontMaterialId] = useState(instance.finish.frontMaterialId);
  const [frontFinishId, setFrontFinishId] = useState(instance.finish.frontFinishId);

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
    setCarcassMaterialId(instance.finish.carcassMaterialId);
    setFrontMaterialId(instance.finish.frontMaterialId);
    setFrontFinishId(instance.finish.frontFinishId);
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

  /** Remediation P0: checked against the pinned product's own real limits (never invented — see
   * `apps/db-tools/src/pilot/rehearsal-dataset.ts`'s `withLimits`). `dimensionLimits` undefined (still loading)
   * means "not checked yet", not "anything goes" — Save stays disabled until the limits are in. */
  const widthError = dimensionLimits === undefined ? "Checking width limits…" : dimensionError("Width", Number(width), dimensionLimits.width);
  const heightError = dimensionLimits === undefined ? "Checking height limits…" : dimensionError("Height", Number(height), dimensionLimits.height);
  const depthError = dimensionLimits === undefined ? "Checking depth limits…" : dimensionError("Depth", Number(depth), dimensionLimits.depth);
  const canSave = canEdit && widthError === null && heightError === null && depthError === null;

  const save = async (): Promise<void> => {
    if (!canSave) return;
    const widthMm = Number(width);
    const heightMm = Number(height);
    const depthMm = Number(depth);
    const moved = room === null ? null : placeOnWall(wallId, Number(alongMm), Number(distanceMm), room.length, room.width);
    await onSave({
      ...instance,
      ...(moved === null ? {} : { position: { xMm: moved.x, yMm: instance.position.yMm, zMm: moved.z }, rotationY: moved.rotationY }),
      dimensions: { widthMm, heightMm, depthMm },
      front: noFront ? OPEN_FRONT : isDrawer ? drawerBankFront(drawerCount, overlay, widthMm, heightMm, drawerHeights.map(Number)) : shutterFront(shutterCount, overlay, widthMm, heightMm),
      internals: isPanel ? [] : noFront ? shelves(Math.max(0, Math.trunc(Number(shelfCount)))) : isPullout ? pullouts(Math.max(0, Math.trunc(Number(pulloutCount)))) : isSink ? wasteBinInternals(wasteBin) : instance.internals,
      finish: { ...instance.finish, carcassMaterialId, frontMaterialId, frontFinishId },
    });
  };

  return (
    <>
      <h3>Properties — {instance.objectCode}</h3>
      <Field label="Cabinet type"><input value={instance.cabinetType.label} disabled /></Field>
      <Field label="Width (mm)">
        <input className="num" value={width} disabled={!canEdit} onChange={(e) => { setWidth(e.target.value); }} />
        {widthError !== null && <small className="field-error">{widthError}</small>}
      </Field>
      <Field label="Height (mm)">
        <input className="num" value={height} disabled={!canEdit} onChange={(e) => { setHeight(e.target.value); }} />
        {heightError !== null && <small className="field-error">{heightError}</small>}
      </Field>
      <Field label="Depth (mm)">
        <input className="num" value={depth} disabled={!canEdit} onChange={(e) => { setDepth(e.target.value); }} />
        {depthError !== null && <small className="field-error">{depthError}</small>}
      </Field>
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
      {runInfo !== null && (
        <>
          <h3>Run</h3>
          <p>Wall {runInfo.wallId}: cabinet {runInfo.position} of {runInfo.count}, run length {runInfo.length} mm.</p>
          {runInfo.adjacents.length === 0
            ? <p>No adjacent cabinet in this run.</p>
            : runInfo.adjacents.map((a) => (
              <p key={a.code}>{a.side === "left" ? "←" : "→"} {a.code}: {a.touching ? "touching (gap 0 mm)" : `gap ${String(a.gap)} mm`}</p>
            ))}
        </>
      )}
      {cornerInfo !== null && (
        <>
          <h3>Corner</h3>
          <p>This cabinet is connected to the {cornerInfo.cornerLabel} corner, joining wall {cornerInfo.wallId} to wall {cornerInfo.otherWallId} via {cornerInfo.otherCode}.</p>
          <p>{cornerInfo.touching ? "Touching — exactly connected, no gap." : `Gap ${String(cornerInfo.gapMm)} mm — not fully connected.`}</p>
        </>
      )}
      {isPanel ? null : noFront ? (
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
              <Field label="Finish"><input value={frontFinishId} disabled /></Field>
              <Field label="Hardware"><input value={selectedDrawer.runner === null ? "Runner pair (resolved in BOM)" : `${String(selectedDrawer.runner.systemHeightMm)} mm runner`} disabled /></Field>
            </>
          )}
        </>
      )}
      <div className="row">
        <Action kind="primary" label="Save" disabled={!canSave} title={canSave ? undefined : "Fix the highlighted field(s) first"} run={save} />
        <Action kind="danger" label="Remove" disabled={!canEdit} run={onRemove} />
      </div>
      <h3>Finish</h3>
      <Field label={isPanel ? "Panel material" : "Carcass material"}>
        <select value={carcassMaterialId} disabled={!canEdit} onChange={(e) => { setCarcassMaterialId(e.target.value); }}>
          {materials.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </Field>
      {!noFront && (
        <Field label="Front material">
          <select value={frontMaterialId} disabled={!canEdit} onChange={(e) => { setFrontMaterialId(e.target.value); }}>
            {materials.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </Field>
      )}
      {(!isOpen && !isOvenTower) && (
        <Field label="Finish">
          <select value={frontFinishId} disabled={!canEdit} onChange={(e) => { setFrontFinishId(e.target.value); }}>
            {finishes.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </Field>
      )}
      <Field label="Back material"><input value={instance.finish.backMaterialId} disabled /></Field>
      <small>Edge band material/finish is resolved automatically by construction rules and is not yet chosen per cabinet.</small>
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
