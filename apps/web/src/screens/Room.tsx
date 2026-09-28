/** Screen 3 — the kitchen: a rectangle (width along wall A, depth, height), no openings. */
import { useState } from "react";
import type { ScreenProps } from "../App";
import { api, idempotency, must } from "../api/client";
import { mm } from "../geometry";
import { Action, ErrorBox, Field, Section, useLoad } from "../ui";

export function RoomScreen({ me, sel, setSel, go }: ScreenProps) {
  const projectId = sel.projectId ?? "";
  // The list is a summary; each room's latest survey comes with the room itself.
  const rooms = useLoad(async () => {
    const list = await must(api.GET("/api/v1/projects/{projectId}/rooms", { params: { path: { projectId }, query: { limit: 100 } } }));
    return { items: await Promise.all(list.items.map((r) => must(api.GET("/api/v1/rooms/{roomId}", { params: { path: { roomId: r.id } } })))) };
  }, `rooms:${projectId}`);
  /** Creation friction: wall thickness and survey source both used to start empty, blocking "Create kitchen"
   * until the designer typed something even when the real dimensions (width/depth/height — always required,
   * never defaulted) were the only thing actually being decided. 150mm matches this repo's own reference wall
   * thickness (`docs/PRD` and the rehearsal fixture data); "Manual entry" is a truthful default (that's what it
   * is until edited), not an invented site survey — both stay fully editable for a real production survey. */
  const [f, setF] = useState({ name: "Kitchen", width: "", depth: "", height: "", wall: "150", source: "Manual entry" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); };
  const num = (v: string) => Number(v);
  const valid = [f.width, f.depth, f.height, f.wall].every((v) => v.trim() !== "" && Number.isFinite(num(v)) && num(v) > 0) && f.source.trim() !== "";

  return (
    <>
      <Section title="Kitchens of this project">
        <ErrorBox error={rooms.error} />
        <table>
          <thead><tr><th>Room</th><th>Width (wall A)</th><th>Depth</th><th>Height</th><th>Wall</th><th>Survey</th><th /></tr></thead>
          <tbody>
            {(rooms.data?.items ?? []).map((r) => {
              const s = r.latestRevision;
              return (
                <tr key={r.id} className={sel.roomId === r.id ? "selected" : ""}>
                  <td>{r.name}</td>
                  <td>{s === null ? "—" : mm(s.lengthMm)}</td><td>{s === null ? "—" : mm(s.widthMm)}</td><td>{s === null ? "—" : mm(s.heightMm)}</td><td>{s === null ? "—" : mm(s.wallThicknessMm)}</td>
                  <td>{s === null ? "no survey" : `rev ${String(s.revisionNumber)} · ${s.source}`}</td>
                  <td><button type="button" disabled={s === null} onClick={() => { setSel({ projectId, roomId: r.id }); go("studio"); }}>Open</button></td>
                </tr>
              );
            })}
            {rooms.data?.items.length === 0 && <tr><td colSpan={7}>No room yet.</td></tr>}
          </tbody>
        </table>
      </Section>
      {me.permissions.includes("room.survey.write") && (
        <Section title="New rectangular kitchen (no openings)">
          <p>Inside dimensions in millimetres, as surveyed. Wall A is the wall the base run stands on; walls B, C and D follow clockwise.</p>
          <div className="grid">
            <Field label="Name"><input value={f.name} onChange={set("name")} /></Field>
            <Field label="Width along wall A (mm)"><input inputMode="numeric" value={f.width} onChange={set("width")} /></Field>
            <Field label="Depth (mm)"><input inputMode="numeric" value={f.depth} onChange={set("depth")} /></Field>
            <Field label="Height (mm)"><input inputMode="numeric" value={f.height} onChange={set("height")} /></Field>
            <Field label="Wall thickness (mm)"><input inputMode="numeric" value={f.wall} onChange={set("wall")} /></Field>
            <Field label="Survey source" hint="e.g. Site survey 26-09 by …"><input value={f.source} onChange={set("source")} /></Field>
          </div>
          <Action kind="primary" label="Create kitchen" disabled={!valid} run={async () => {
            const room = await must(api.POST("/api/v1/projects/{projectId}/rooms", {
              params: { path: { projectId }, header: { "Idempotency-Key": idempotency() } },
              body: { name: f.name.trim(), roomType: "KITCHEN", initialSurvey: { lengthMm: num(f.width), widthMm: num(f.depth), heightMm: num(f.height), wallThicknessMm: num(f.wall), source: f.source.trim() } },
            }));
            setSel({ projectId, roomId: room.id });
            rooms.reload();
            // Creation friction: the room's own survey is what canEdit/room.survey.write is for; once it
            // exists, Design Studio is always the next step — go there directly instead of leaving the
            // designer to find and click the room's own "Open" button next.
            go("studio");
          }} />
        </Section>
      )}
    </>
  );
}
