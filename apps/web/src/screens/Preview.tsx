/**
 * Screen 5 — 2D / 3D preview of the API's resolved model (GET /design-versions/{id}/model): room boundary, cabinet
 * positions and dimensions, and the cabinet run. Drawing only: every coordinate comes from the engines.
 */
import type { ScreenProps } from "../App";
import type { ModelPreview } from "../api/client";
import { api, must } from "../api/client";
import { fit, mm } from "../geometry";
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

const W = 520;
const H = 380;

export function Plan({ m }: { readonly m: ModelPreview }) {
  const { scale: s, ox, oy } = fit(m.room.length, m.room.width, W, H, 36);
  const X = (x: number) => ox + x * s;
  const Z = (z: number) => oy + z * s;
  return (
    <svg viewBox={`0 0 ${String(W)} ${String(H)}`} role="img" aria-label="Plan view">
      <rect x={X(0)} y={Z(0)} width={m.room.length * s} height={m.room.width * s} className="room" />
      {m.room.walls.map((w) => <text key={w.wallId} className="wall-label" x={X((w.start.x + w.end.x) / 2)} y={Z((w.start.z + w.end.z) / 2)} dy={w.wallId === "A" ? -8 : w.wallId === "C" ? 16 : 4} dx={w.wallId === "B" ? 10 : w.wallId === "D" ? -18 : 0}>{w.wallId}</text>)}
      <text className="dim" x={X(m.room.length / 2)} y={Z(0) - 20} textAnchor="middle">{mm(m.room.length)}</text>
      <text className="dim" x={X(0) - 24} y={Z(m.room.width / 2)} textAnchor="middle" transform={`rotate(-90 ${String(X(0) - 24)} ${String(Z(m.room.width / 2))})`}>{mm(m.room.width)}</text>
      {m.objects.map((o) => o.placement === null ? null : (
        <g key={o.lineageId}>
          <rect className={o.validation.counts.BLOCKER > 0 ? "cab bad" : "cab"} x={X(o.placement.envelope.min.x)} y={Z(o.placement.envelope.min.z)} width={o.placement.envelope.size.x * s} height={o.placement.envelope.size.z * s} />
          <text className="cab-label" x={X(o.placement.envelope.min.x + o.placement.envelope.size.x / 2)} y={Z(o.placement.envelope.min.z + o.placement.envelope.size.z / 2)} textAnchor="middle">{o.objectCode}</text>
          <text className="dim" x={X(o.placement.envelope.min.x + o.placement.envelope.size.x / 2)} y={Z(o.placement.envelope.min.z + o.placement.envelope.size.z) + 12} textAnchor="middle">{o.dimensions.width}</text>
        </g>
      ))}
      {m.runs.map((r) => r.wallId !== "A" ? null : <line key={r.runId} className="run" x1={X(r.start)} x2={X(r.end)} y1={Z(0) - 6} y2={Z(0) - 6} />)}
    </svg>
  );
}

export function Elevation({ m }: { readonly m: ModelPreview }) {
  const { scale: s, ox, oy } = fit(m.room.length, m.room.height, W, H, 36);
  const X = (x: number) => ox + x * s;
  const Y = (y: number) => oy + (m.room.height - y) * s;
  const onA = m.objects.filter((o) => o.placement?.wallId === "A");
  return (
    <svg viewBox={`0 0 ${String(W)} ${String(H)}`} role="img" aria-label="Wall A elevation">
      <rect x={X(0)} y={Y(m.room.height)} width={m.room.length * s} height={m.room.height * s} className="room" />
      {onA.flatMap((o) => o.components.map((c) => (
        <rect key={`${o.lineageId}-${c.componentId}`} className={c.componentType === "SHUTTER" ? "shutter" : "panel"} x={X(c.box.min.x)} y={Y(c.box.min.y + c.box.size.y)} width={c.box.size.x * s} height={c.box.size.y * s} />
      )))}
      {onA.map((o) => o.placement === null ? null : (
        <g key={o.lineageId}>
          <text className="dim" x={X((o.placement.alongWall.start + o.placement.alongWall.end) / 2)} y={Y(0) + 14} textAnchor="middle">{o.dimensions.width}</text>
          <text className="cab-label" x={X((o.placement.alongWall.start + o.placement.alongWall.end) / 2)} y={Y(o.dimensions.height) - 6} textAnchor="middle">{o.objectCode}</text>
        </g>
      ))}
      <text className="dim" x={X(m.room.length / 2)} y={Y(m.room.height) - 8} textAnchor="middle">Wall A · {mm(m.room.length)} · height {mm(m.room.height)}</text>
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
