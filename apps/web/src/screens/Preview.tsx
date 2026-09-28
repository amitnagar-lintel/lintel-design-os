/**
 * Screen 5 — 2D / 3D preview of the API's resolved model (GET /design-versions/{id}/model): room boundary, cabinet
 * positions and dimensions, and the cabinet run. Drawing only: every coordinate comes from the engines.
 */
import type { PointerEvent as ReactPointerEvent } from "react";
import { useState } from "react";
import type { ScreenProps } from "../App";
import type { ModelPreview } from "../api/client";
import { api, must } from "../api/client";
import { clampAlong, fit, footprintBox, mm, nearestWall, placeOnWall, snapToNeighbors } from "../geometry";
import type { QuarterTurn, WallId } from "../geometry";
import { Badge, ErrorBox, Section, useLoad } from "../ui";

type Obj = ModelPreview["objects"][number];

export function PreviewScreen({ sel }: ScreenProps) {
  const versionId = sel.versionId ?? "";
  const model = useLoad(() => must(api.GET("/api/v1/design-versions/{versionId}/model", { params: { path: { versionId } } })), `model:${versionId}`);
  const m = model.data;
  return (
    <>
      <ErrorBox error={model.error} />
      {model.loading && <p>Resolving the model…</p>}
      {m !== null && (
        <>
          <Section title={`Version ${String(m.designVersion.versionNumber)} — ${m.designVersion.status}`} aside={<ValidationBadges m={m} />}>
            <p>Room {mm(m.room.length)} (wall A) × {mm(m.room.width)} × {mm(m.room.height)} high, walls {mm(m.room.wallThickness)}. Model fingerprint <code>{m.modelFingerprint}</code>. Data: {m.dataClassification}.</p>
          </Section>
          <div className="two">
            <Section title="Plan (top view)"><Plan m={m} /></Section>
            <Section title="Wall A elevation"><Elevation m={m} /></Section>
          </div>
          <Section title="3D view (axonometric)"><Axonometric m={m} /></Section>
          <Section title="Cabinets and run">
            <table>
              <thead><tr><th>Cabinet</th><th>Wall</th><th>From</th><th>To</th><th>W × H × D</th><th>Components</th><th>Checks</th></tr></thead>
              <tbody>
                {m.objects.map((o) => (
                  <tr key={o.lineageId}>
                    <td>{o.objectCode}</td><td>{o.placement?.wallId ?? "not placed"}</td>
                    <td>{o.placement === null ? "—" : mm(o.placement.alongWall.start)}</td><td>{o.placement === null ? "—" : mm(o.placement.alongWall.end)}</td>
                    <td>{o.dimensions.width} × {o.dimensions.height} × {o.dimensions.depth} mm</td><td>{o.components.length}</td>
                    <td>{o.validation.counts.BLOCKER > 0 ? <Badge tone="bad">{o.validation.counts.BLOCKER} BLOCKER</Badge> : <Badge tone="ok">no BLOCKER</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {m.runs.map((r) => <p key={r.runId}>Run {r.runId} on wall {r.wallId}: {mm(r.start)} → {mm(r.end)}, length {mm(r.length)}, {r.lineageIds.length} cabinet(s).</p>)}
          </Section>
        </>
      )}
    </>
  );
}

export function ValidationBadges({ m }: { readonly m: ModelPreview }) {
  const c = m.validation.counts;
  return <span>{c.BLOCKER > 0 ? <Badge tone="bad">{c.BLOCKER} BLOCKER</Badge> : <Badge tone="ok">0 BLOCKER</Badge>} <Badge tone={c.ERROR > 0 ? "bad" : "ok"}>{c.ERROR} ERROR</Badge> <Badge tone={c.WARNING > 0 ? "warn" : "ok"}>{c.WARNING} WARNING</Badge></span>;
}

const W = 640;
const H = 460;
/** Room-boundary padding (px): the fixed inner canvas margin the room itself is fitted into (`fit`'s own `pad`)
 * has to leave enough room outside the interior wall face for the wall band itself, the dimension line and its
 * label — see `Plan`'s own `PAD`. */
const PAD = 56;

interface DragState {
  readonly lineageId: string;
  /** Pointer-down position minus the object's own `transform.x/z` at that moment (mm) — kept constant through the
   * drag so the cabinet doesn't jump to the pointer, only follows its movement. */
  readonly grabOffsetXMm: number;
  readonly grabOffsetZMm: number;
  /** The live wall-snapped position (always flush, `distance = 0`), recomputed on every pointer move. */
  readonly x: number;
  readonly z: number;
  readonly rotationY: QuarterTurn;
}

/** A short architectural dimension line — a line between two points with a perpendicular tick at each end (the
 * convention real floor-plan drawings use instead of arrowheads) and a centred label — purely a drawing
 * convention: `mm` is never computed here, only the room/wall length the caller already has. */
function DimensionLine({ axis, atPx, fromPx, toPx, mmValue }: { readonly axis: "x" | "z"; readonly atPx: number; readonly fromPx: number; readonly toPx: number; readonly mmValue: number }) {
  const TICK = 5;
  const mid = (fromPx + toPx) / 2;
  if (axis === "x") {
    return (
      <g className="dimline">
        <line x1={fromPx} y1={atPx} x2={toPx} y2={atPx} />
        <line x1={fromPx} y1={atPx - TICK} x2={fromPx} y2={atPx + TICK} />
        <line x1={toPx} y1={atPx - TICK} x2={toPx} y2={atPx + TICK} />
        <text x={mid} y={atPx - 5} textAnchor="middle">{mm(mmValue)}</text>
      </g>
    );
  }
  return (
    <g className="dimline">
      <line x1={atPx} y1={fromPx} x2={atPx} y2={toPx} />
      <line x1={atPx - TICK} y1={fromPx} x2={atPx + TICK} y2={fromPx} />
      <line x1={atPx - TICK} y1={toPx} x2={atPx + TICK} y2={toPx} />
      <text x={atPx} y={mid} textAnchor="middle" transform={`rotate(-90 ${String(atPx)} ${String(mid)})`}>{mm(mmValue)}</text>
    </g>
  );
}

/**
 * Slice 6A: drag a cabinet to snap it against any of the room's 4 walls. `onMove` is called once, on pointer-up,
 * with the final room-space position/rotation to save (never during the drag itself — every intermediate frame
 * is purely a client-side preview via `footprintBox`, so a drag that's abandoned mid-gesture, e.g. dragged out of
 * the SVG, never reaches the API). Omit `canEdit`/`onMove` for a read-only Plan (Screen 5's own preview).
 */
export function Plan({ m, canEdit = false, selectedId = null, onSelect, onMove }: {
  readonly m: ModelPreview;
  readonly canEdit?: boolean;
  readonly selectedId?: string | null;
  readonly onSelect?: (lineageId: string) => void;
  readonly onMove?: (lineageId: string, next: { xMm: number; yMm: number; zMm: number; rotationY: QuarterTurn }) => void;
}) {
  const { scale: s, ox, oy } = fit(m.room.length, m.room.width, W, H, PAD);
  const X = (x: number) => ox + x * s;
  const Z = (z: number) => oy + z * s;
  const [drag, setDrag] = useState<DragState | null>(null);
  const thicknessOf = (id: WallId): number => m.room.walls.find((w) => w.wallId === id)?.thickness ?? m.room.wallThickness;

  /** Client (pixel) coordinates → room millimetres, via the SVG's own CTM — correct regardless of how the
   * responsive `<svg>` element is currently scaled on screen. */
  const toRoomMm = (svg: SVGSVGElement, clientX: number, clientY: number): { x: number; z: number } => {
    const ctm = svg.getScreenCTM();
    if (ctm === null) return { x: 0, z: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const loc = pt.matrixTransform(ctm.inverse());
    return { x: (loc.x - ox) / s, z: (loc.y - oy) / s };
  };

  /** Slice 6B: after wall-snapping, also snap flush against a neighbouring cabinet already on that same wall
   * (within `snapToNeighbors`'s threshold) — the physical act of building a run by drag. */
  const snappedFrom = (rawX: number, rawZ: number, widthMm: number, excludeLineageId: string): { x: number; z: number; rotationY: QuarterTurn } => {
    const near = nearestWall(rawX, rawZ, m.room.length, m.room.width);
    const wallLength = near.wallId === "A" || near.wallId === "C" ? m.room.length : m.room.width;
    const neighbors = m.objects.filter((n) => n.lineageId !== excludeLineageId && n.placement !== null && n.placement.wallId === near.wallId).map((n) => n.placement?.alongWall).filter((a): a is { start: number; end: number } => a !== undefined);
    const along = clampAlong(snapToNeighbors(near.along, widthMm, neighbors), widthMm, wallLength);
    return placeOnWall(near.wallId, along, 0, m.room.length, m.room.width);
  };

  const onCabPointerDown = (e: ReactPointerEvent<SVGRectElement>, o: Obj): void => {
    if (!canEdit || onMove === undefined) {
      onSelect?.(o.lineageId);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    const svg = e.currentTarget.ownerSVGElement;
    if (svg === null) return;
    const { x: px, z: pz } = toRoomMm(svg, e.clientX, e.clientY);
    setDrag({ lineageId: o.lineageId, grabOffsetXMm: px - o.transform.x, grabOffsetZMm: pz - o.transform.z, x: o.transform.x, z: o.transform.z, rotationY: (o.transform.rotationY as QuarterTurn) });
    onSelect?.(o.lineageId);
  };

  const onCabPointerMove = (e: ReactPointerEvent<SVGRectElement>, o: Obj): void => {
    if (drag === null || drag.lineageId !== o.lineageId) return;
    const svg = e.currentTarget.ownerSVGElement;
    if (svg === null) return;
    const { x: px, z: pz } = toRoomMm(svg, e.clientX, e.clientY);
    const snapped = snappedFrom(px - drag.grabOffsetXMm, pz - drag.grabOffsetZMm, o.dimensions.width, o.lineageId);
    setDrag({ ...drag, ...snapped });
  };

  const onCabPointerUp = (e: ReactPointerEvent<SVGRectElement>, o: Obj): void => {
    if (drag === null || drag.lineageId !== o.lineageId) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const moved = drag.x !== o.transform.x || drag.z !== o.transform.z || drag.rotationY !== o.transform.rotationY;
    if (moved) onMove?.(o.lineageId, { xMm: drag.x, yMm: o.transform.y, zMm: drag.z, rotationY: drag.rotationY });
    setDrag(null);
  };

  // A real floor-plan reads as: a filled floor, thick wall bands drawn at each wall's own real thickness (never
  // a thin outline standing in for a wall), a faint scale grid, and dimension lines with tick marks outside the
  // walls — all of it drawn straight from the resolved model's own `room.walls[].thickness`/`length`, nothing
  // invented here.
  const tA = thicknessOf("A");
  const tB = thicknessOf("B");
  const tC = thicknessOf("C");
  const tD = thicknessOf("D");
  const GRID_MM = 500;
  const gridXs: number[] = [];
  for (let gx = GRID_MM; gx < m.room.length; gx += GRID_MM) gridXs.push(gx);
  const gridZs: number[] = [];
  for (let gz = GRID_MM; gz < m.room.width; gz += GRID_MM) gridZs.push(gz);

  return (
    <svg viewBox={`0 0 ${String(W)} ${String(H)}`} role="img" aria-label="Plan view">
      <rect x={X(0)} y={Z(0)} width={m.room.length * s} height={m.room.width * s} className="room plan-floor" />
      {gridXs.map((gx) => <line key={`gx${String(gx)}`} className="grid" x1={X(gx)} y1={Z(0)} x2={X(gx)} y2={Z(m.room.width)} />)}
      {gridZs.map((gz) => <line key={`gz${String(gz)}`} className="grid" x1={X(0)} y1={Z(gz)} x2={X(m.room.length)} y2={Z(gz)} />)}
      {/* Wall bands: each wall's own real thickness, extending outward from the room's interior face (where
          cabinets sit flush) — not a placeholder outline. */}
      <rect className="wall" x={X(0)} y={Z(-tA)} width={m.room.length * s} height={tA * s} />
      <rect className="wall" x={X(0)} y={Z(m.room.width)} width={m.room.length * s} height={tC * s} />
      <rect className="wall" x={X(-tD)} y={Z(0)} width={tD * s} height={m.room.width * s} />
      <rect className="wall" x={X(m.room.length)} y={Z(0)} width={tB * s} height={m.room.width * s} />
      {m.room.walls.map((w) => <text key={w.wallId} className="wall-label" x={X((w.start.x + w.end.x) / 2)} y={Z((w.start.z + w.end.z) / 2)} dy={w.wallId === "A" ? -tA * s - 4 : w.wallId === "C" ? tC * s + 12 : 4} dx={w.wallId === "B" ? tB * s + 10 : w.wallId === "D" ? -tD * s - 14 : 0}>{w.wallId}</text>)}
      <DimensionLine axis="x" atPx={Z(-tA) - 14} fromPx={X(0)} toPx={X(m.room.length)} mmValue={m.room.length} />
      <DimensionLine axis="x" atPx={Z(m.room.width + tC) + 14} fromPx={X(0)} toPx={X(m.room.length)} mmValue={m.room.length} />
      <DimensionLine axis="z" atPx={X(-tD) - 14} fromPx={Z(0)} toPx={Z(m.room.width)} mmValue={m.room.width} />
      <DimensionLine axis="z" atPx={X(m.room.length + tB) + 14} fromPx={Z(0)} toPx={Z(m.room.width)} mmValue={m.room.width} />
      {m.objects.map((o) => {
        if (o.placement === null) return null;
        const dragging = drag !== null && drag.lineageId === o.lineageId;
        const box = dragging ? footprintBox(drag.x, drag.z, drag.rotationY, o.dimensions.width, o.dimensions.depth) : { minX: o.placement.envelope.min.x, minZ: o.placement.envelope.min.z, sizeX: o.placement.envelope.size.x, sizeZ: o.placement.envelope.size.z };
        const cx = box.minX + box.sizeX / 2;
        const cz = box.minZ + box.sizeZ / 2;
        return (
          <g key={o.lineageId}>
            <rect
              className={[o.validation.counts.BLOCKER > 0 ? "cab bad" : "cab", o.lineageId === selectedId ? "selected" : "", dragging ? "dragging" : "", canEdit && onMove !== undefined ? "draggable" : ""].filter(Boolean).join(" ")}
              x={X(box.minX)} y={Z(box.minZ)} width={box.sizeX * s} height={box.sizeZ * s}
              onPointerDown={(e) => { onCabPointerDown(e, o); }}
              onPointerMove={(e) => { onCabPointerMove(e, o); }}
              onPointerUp={(e) => { onCabPointerUp(e, o); }}
            />
            <text className="cab-label" x={X(cx)} y={Z(cz)} textAnchor="middle">{o.objectCode}</text>
            <text className="dim" x={X(cx)} y={Z(box.minZ + box.sizeZ) + 12} textAnchor="middle">{o.dimensions.width}</text>
            {!dragging && o.cutouts.map((cut) => {
              const cutX = cx + cut.position.xMm;
              const cutZ = cz + cut.position.zMm;
              return <rect key={cut.cutoutId} className="cutout" x={X(cutX - cut.widthMm / 2)} y={Z(cutZ - cut.depthMm / 2)} width={cut.widthMm * s} height={cut.depthMm * s} />;
            })}
          </g>
        );
      })}
      {/* Slice 6B: one run indicator per wall (was wall A only), just outside that wall's own band — the offset
          scales with the wall's real thickness (drawn above) so the indicator is never hidden under it. */}
      {m.runs.map((r) => {
        const wall = m.room.walls.find((w) => w.wallId === r.wallId);
        if (wall === undefined || wall.length <= 0) return null;
        const along = (t: number) => ({ x: wall.start.x + (t / wall.length) * (wall.end.x - wall.start.x), z: wall.start.z + (t / wall.length) * (wall.end.z - wall.start.z) });
        const p1 = along(r.start);
        const p2 = along(r.end);
        const OUTWARD_UNIT: Record<"A" | "B" | "C" | "D", readonly [number, number]> = { A: [0, -1], B: [1, 0], C: [0, 1], D: [-1, 0] };
        const [ux, uz] = OUTWARD_UNIT[r.wallId];
        const offsetPx = thicknessOf(r.wallId) * s + 4;
        const dx = ux * offsetPx;
        const dz = uz * offsetPx;
        return <line key={r.runId} className="run" x1={X(p1.x) + dx} y1={Z(p1.z) + dz} x2={X(p2.x) + dx} y2={Z(p2.z) + dz} />;
      })}
    </svg>
  );
}

export function Elevation({ m, wallId = "A", selectedId = null, onSelect, selectedComponentId, onSelectComponent }: {
  readonly m: ModelPreview;
  /** Remediation P1 (Slice 6F follow-up): which of the room's 4 walls this elevation draws. Every wall derives
   * from the exact same resolved model as every other view (`m.objects[].placement.wallId`/`alongWall`, already
   * wall-relative regardless of which wall an object is on) — this is a display selector only, never a
   * separate per-wall kitchen model. Defaults to "A" so every existing call site keeps its old behaviour. */
  readonly wallId?: WallId;
  /** Slice 6D: the whole-object selection every view shares (the same `lineageId` Plan/3D use) — not a
   * separate elevation-only selection model. */
  readonly selectedId?: string | null;
  /** Slice 6D: fired when a cabinet's front is clicked anywhere on it (not just a DRAWER_FRONT). */
  readonly onSelect?: (lineageId: string) => void;
  /** Slice 2.1: which component (e.g. one drawer front) is highlighted, if any. */
  readonly selectedComponentId?: string | null;
  /** Slice 2.1: fired when a DRAWER_FRONT rect is clicked. */
  readonly onSelectComponent?: (lineageId: string, componentId: string, componentType: string) => void;
}) {
  // Walls A/C run the room's length; B/D run its width — read the wall's own real length from the model rather
  // than assuming, so this generalises to any rectangular room.
  const wallLength = m.room.walls.find((w) => w.wallId === wallId)?.length ?? m.room.length;
  const { scale: s, ox, oy } = fit(wallLength, m.room.height, W, H, 36);
  const X = (x: number) => ox + x * s;
  const Y = (y: number) => oy + (m.room.height - y) * s;
  const onWall = m.objects.filter((o) => o.placement?.wallId === wallId);
  return (
    <svg viewBox={`0 0 ${String(W)} ${String(H)}`} role="img" aria-label={`Wall ${wallId} elevation`}>
      <rect x={X(0)} y={Y(m.room.height)} width={wallLength * s} height={m.room.height * s} className="room" />
      {/* Slice 6D: one whole-cabinet click target per object, behind its own components, so every cabinet
          (shutter, open, corner leg, filler/end panel — not just a drawer bank) is selectable as a whole by
          clicking anywhere on its front, using the same persistent lineageId Plan/3D already select by. This is
          a hit-target only (no visible stroke) — the selection outline itself is drawn on top of every
          component further below, so it's never hidden behind an opaque shutter/panel fill. */}
      {onWall.map((o) => o.placement === null ? null : (
        <rect
          key={`${o.lineageId}-whole`}
          className={`cab-whole${onSelect !== undefined ? " clickable" : ""}`}
          x={X(o.placement.alongWall.start)} y={Y(o.dimensions.height)} width={(o.placement.alongWall.end - o.placement.alongWall.start) * s} height={o.dimensions.height * s}
          onClick={onSelect !== undefined ? () => { onSelect(o.lineageId); } : undefined}
        />
      ))}
      {onWall.flatMap((o) => o.components.flatMap((c) => {
        // Multi-wall Elevation (hardening): a component's horizontal position comes from its own `alongWall`
        // (the same wallFrame/relativeToWall conversion the object's own placement.alongWall already uses),
        // never `box.min.x`/`box.size.x` directly — those are room-global and only happen to equal the
        // along-wall coordinate for walls A/C (for B/D, along-wall is `box.z`). `alongWall` is null only when
        // the object itself has no placement, which can't be true here (this object is already in `onWall`).
        if (c.alongWall === null) return [];
        const componentClickable = c.componentType === "DRAWER_FRONT" && onSelectComponent !== undefined;
        const clickable = componentClickable || onSelect !== undefined;
        const selected = c.componentId === selectedComponentId;
        const className = `${c.componentType === "SHUTTER" ? "shutter" : "panel"}${selected ? " selected" : ""}${clickable ? " clickable" : ""}`;
        return [(
          <rect
            key={`${o.lineageId}-${c.componentId}`} className={className}
            x={X(c.alongWall.start)} y={Y(c.box.min.y + c.box.size.y)} width={(c.alongWall.end - c.alongWall.start) * s} height={c.box.size.y * s}
            onClick={componentClickable ? () => { onSelectComponent(o.lineageId, c.componentId, c.componentType); onSelect?.(o.lineageId); } : onSelect !== undefined ? () => { onSelect(o.lineageId); } : undefined}
          />
        )];
      }))}
      {/* Slice 6D: the whole-cabinet selection outline, drawn on top of every component so it's always
          visible regardless of what opaque fronts sit underneath. */}
      {onWall.map((o) => o.placement === null || o.lineageId !== selectedId ? null : (
        <rect
          key={`${o.lineageId}-outline`} className="cab-whole-outline"
          x={X(o.placement.alongWall.start)} y={Y(o.dimensions.height)} width={(o.placement.alongWall.end - o.placement.alongWall.start) * s} height={o.dimensions.height * s}
        />
      ))}
      {onWall.map((o) => o.placement === null ? null : (
        <g key={o.lineageId}>
          <text className="dim" x={X((o.placement.alongWall.start + o.placement.alongWall.end) / 2)} y={Y(0) + 14} textAnchor="middle">{o.dimensions.width}</text>
          <text className="cab-label" x={X((o.placement.alongWall.start + o.placement.alongWall.end) / 2)} y={Y(o.dimensions.height) - 6} textAnchor="middle">{o.objectCode}</text>
        </g>
      ))}
      <text className="dim" x={X(wallLength / 2)} y={Y(m.room.height) - 8} textAnchor="middle">Wall {wallId} · {mm(wallLength)} · height {mm(m.room.height)}</text>
    </svg>
  );
}

/** Axonometric view of every component box (x along wall A, z into the room, y up), painted back to front. */
function Axonometric({ m }: { readonly m: ModelPreview }) {
  const c30 = Math.cos(Math.PI / 6);
  const s30 = 0.5;
  const P = (x: number, y: number, z: number) => [(x - z) * c30, (x + z) * s30 - y] as const;
  const corners = [P(0, 0, 0), P(m.room.length, 0, 0), P(0, 0, m.room.width), P(m.room.length, 0, m.room.width), P(0, m.room.height, 0), P(m.room.length, m.room.height, 0)];
  const minX = Math.min(...corners.map((p) => p[0]));
  const maxX = Math.max(...corners.map((p) => p[0]));
  const minY = Math.min(...corners.map((p) => p[1]));
  const maxY = Math.max(...corners.map((p) => p[1]));
  const { scale: s, ox, oy } = fit(maxX - minX, maxY - minY, 900, 420, 20);
  const pt = (x: number, y: number, z: number) => { const [a, b] = P(x, y, z); return `${String(ox + (a - minX) * s)},${String(oy + (b - minY) * s)}`; };
  const boxes = m.objects.flatMap((o: Obj) => o.components.map((c) => ({ key: `${o.lineageId}-${c.componentId}`, type: c.componentType, b: c.box })))
    .sort((p, q) => (p.b.min.x + p.b.min.z + p.b.min.y) - (q.b.min.x + q.b.min.z + q.b.min.y));
  const L = m.room.length;
  const D = m.room.width;
  const Hh = m.room.height;
  return (
    <svg viewBox="0 0 900 420" role="img" aria-label="Axonometric view">
      <polygon className="floor" points={[pt(0, 0, 0), pt(L, 0, 0), pt(L, 0, D), pt(0, 0, D)].join(" ")} />
      <polygon className="wallface" points={[pt(0, 0, 0), pt(L, 0, 0), pt(L, Hh, 0), pt(0, Hh, 0)].join(" ")} />
      <polygon className="wallface" points={[pt(0, 0, 0), pt(0, 0, D), pt(0, Hh, D), pt(0, Hh, 0)].join(" ")} />
      {boxes.map(({ key, type, b }) => {
        const [x0, y0, z0] = [b.min.x, b.min.y, b.min.z];
        const [x1, y1, z1] = [x0 + b.size.x, y0 + b.size.y, z0 + b.size.z];
        const cls = type === "SHUTTER" ? "shutter" : "panel";
        return (
          <g key={key} className={cls}>
            <polygon points={[pt(x0, y1, z0), pt(x1, y1, z0), pt(x1, y1, z1), pt(x0, y1, z1)].join(" ")} />
            <polygon points={[pt(x0, y0, z1), pt(x1, y0, z1), pt(x1, y1, z1), pt(x0, y1, z1)].join(" ")} />
            <polygon points={[pt(x1, y0, z0), pt(x1, y0, z1), pt(x1, y1, z1), pt(x1, y1, z0)].join(" ")} />
          </g>
        );
      })}
    </svg>
  );
}
