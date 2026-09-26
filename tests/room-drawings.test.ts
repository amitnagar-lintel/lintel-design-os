/** M4 commit 4 — Wall Internal Elevation (primary), Cabinet Internal Elevation (detail), Room Panel Schedule. */
import { describe, expect, it } from "vitest";
import type { ResolvedRoom, RoomDrawing } from "@lintel/types";
import { checkRoomDrawingStaleness, createCabinetInternalElevation, createWallInternalElevation, renderPdf, renderSvg, verifyRoomDrawing } from "@lintel/drawing-engine";
import { DESIGN_VERSION, fixtureSlice } from "./support/scenario.js";
import { created, METADATA } from "./support/drawing.js";
import { cabinet, fixtureRoom, lLayout, productionRoom } from "./support/room.js";
import { createdRoom, roomSchedule, wallElevation } from "./support/room-drawing.js";

const texts = (d: RoomDrawing | ReturnType<typeof created>, sheet = 0): string[] => (d.sheets[sheet]?.primitives ?? []).flatMap((p) => (p.kind === "text" ? [p.text] : []));

describe("Wall Internal Elevation (primary room drawing)", () => {
  const room = fixtureRoom();
  const a = createdRoom(wallElevation(room, "A"));
  it("shows every object on the wall with the along-wall dimension chain and wall length", () => {
    expect(a.objectIds).toEqual(["obj_001", "obj_002", "obj_003"]);
    expect(texts(a)).toEqual(expect.arrayContaining(["OBJ-KIT-001", "OBJ-KIT-002", "OBJ-KIT-003", "600", "750", "2250", "4200", "3000", "720", "WALL A INTERNAL ELEVATION  KITCHEN  SCALE 1:25"]));
  });
  it("annotates corners and relationships", () => {
    expect(texts(a)).toContain("CORNER A/D: OBJ-KIT-004 + OBJ-KIT-001 (gap 21)");
    expect(a.notes.join(" ")).toMatch(/RUN:A:1: OBJ-KIT-001, OBJ-KIT-002, OBJ-KIT-003 \(length 1950\)/);
    expect(a.notes.join(" ")).toMatch(/OBJ-KIT-001\/OBJ-KIT-002 touching/);
  });
  it("uses the wall's own left-to-right frame (wall D: gap 2000, object 600, corner gap 600)", () => {
    const d = createdRoom(wallElevation(room, "D"));
    expect(d.objectIds).toEqual(["obj_004"]);
    expect(texts(d)).toEqual(expect.arrayContaining(["2000", "600", "3200", "CORNER D/A: OBJ-KIT-004 + OBJ-KIT-001 (gap 21)"]));
  });
  it("shows gaps between objects and override provenance", () => {
    const gap = fixtureRoom([cabinet("OBJ-KIT-001", 600, { x: 0 }), cabinet("OBJ-KIT-002", 600, { x: 640 })], {
      overrides: [{ overrideId: "OV-1", version: 1, type: "INTENTIONAL_GAP", objectIds: ["obj_001", "obj_002"], reason: "Dishwasher", author: "t", createdAt: "2026-09-26" }],
    });
    const d = createdRoom(wallElevation(gap, "A"));
    expect(texts(d)).toContain("40");
    expect(d.notes.join(" ")).toMatch(/gap 40 \(override OV-1\)/);
  });
  it("draws an empty wall with its outline and a note", () => {
    expect(texts(createdRoom(wallElevation(room, "C")))).toContain("NO OBJECTS ON THIS WALL");
  });
  it("traces the room: room fingerprint in the title block, room id and objects in the SVG", () => {
    expect(a.titleBlock.modelFingerprint).toBe(room.roomFingerprint);
    const svg = renderSvg(a);
    expect(svg).toContain('data-room-id="room_001"');
    expect(svg).toContain('data-objects="obj_001,obj_002,obj_003"');
    expect(a.drawingId).toBe("DRW:dv_001:room_001:WALL_INTERNAL_ELEVATION:A:KIT-WE-A:RA");
  });
});

describe("Cabinet Internal Elevation (detail drawing)", () => {
  const d = created(createCabinetInternalElevation({ resolved: fixtureSlice().resolved, designVersion: DESIGN_VERSION, metadata: { ...METADATA, drawingNumber: "KIT-CI-001" } }));
  it("removes the fronts and documents the internal construction", () => {
    expect(texts(d)).toEqual(expect.arrayContaining(["SHF-01", "562 x 518 x 18", "BCK", "580 x 710 x 6", "CABINET INTERNAL ELEVATION (FRONTS REMOVED)  OBJ-KIT-001  SCALE 1:5"]));
    expect(texts(d)).not.toContain("SHT-L");
    expect(d.type).toBe("CABINET_INTERNAL_ELEVATION");
  });
});

describe("Room Panel Schedule", () => {
  const room = fixtureRoom();
  const s = createdRoom(roomSchedule(room));
  it("groups every panel by object with continuous numbering and placement", () => {
    const all = s.sheets.flatMap((_, i) => texts(s, i));
    expect(all).toEqual(expect.arrayContaining(["OBJ-KIT-001", "WALL A @ 0", "OBJ-KIT-004", "WALL D @ 2000", "OBJ-KIT-004-SHT-R", "36"]));
    expect(s.sheets).toHaveLength(2);
    expect(all).toContain("SHEET 2 OF 2");
  });
});

describe("room drawing guard, watermark, staleness, integrity", () => {
  const room = fixtureRoom();
  it("watermarks TEST_FIXTURE and blocked rooms", () => {
    expect(createdRoom(wallElevation(room, "A")).watermark).toBe("TEST FIXTURE DATA - NOT FOR PRODUCTION");
    expect(createdRoom(wallElevation(productionRoom(), "A")).watermark).toMatch(/^BLOCKED DATA - NOT FOR PRODUCTION \(\d+ BLOCKERS\)$/);
  });
  it("refuses FOR_PRODUCTION unless the room is approved, clean and PRODUCTION", () => {
    for (const r of [wallElevation(room, "A", "FOR_PRODUCTION"), roomSchedule(productionRoom(), "FOR_PRODUCTION")]) {
      expect(r.status).toBe("REFUSED");
      if (r.status === "REFUSED") expect(r.blockers.map((b) => b.code)).toContain("DRAWING_PRODUCTION_GUARD");
    }
  });
  it("is granted for a clean, approved, PRODUCTION room (test double)", () => {
    const approved: ResolvedRoom = {
      ...room,
      trace: { ...room.trace, designVersionStatus: "APPROVED", dataClassification: "PRODUCTION", testFixtureSources: [] },
      validation: { messages: [], counts: { BLOCKER: 0, ERROR: 0, WARNING: 0, INFO: 0 }, canApprove: true },
    };
    const r = createWallInternalElevation({ room: approved, wallId: "A", designVersion: { ...DESIGN_VERSION, status: "APPROVED" }, metadata: METADATA, requestedStatus: "FOR_PRODUCTION" });
    expect(r.status).toBe("CREATED");
    if (r.status === "CREATED") expect([r.drawing.status, r.drawing.watermark]).toEqual(["FOR_PRODUCTION", null]);
    expect(wallElevation(approved, "A", "FOR_PRODUCTION").status).toBe("REFUSED"); // DRAFT design version is still refused
  });
  it("reports exactly which object made a room drawing stale", () => {
    const d = createdRoom(wallElevation(room, "A"));
    expect(checkRoomDrawingStaleness(d, room).stale).toBe(false);
    const changed = fixtureRoom(lLayout().map((o) => (o.objectCode === "OBJ-KIT-002" ? cabinet("OBJ-KIT-002", 750, { x: 600 }, { shutterCount: 1 }) : o)));
    expect(checkRoomDrawingStaleness(d, changed)).toMatchObject({ stale: true, changedObjectIds: ["obj_002"] });
  });
  it("is sealed, frozen and deterministic", () => {
    const d = createdRoom(wallElevation(room, "A"));
    expect(verifyRoomDrawing(d)).toBe(true);
    expect(Object.isFrozen(d.sheets)).toBe(true);
    expect(renderSvg(createdRoom(wallElevation(fixtureRoom([...lLayout()].reverse()), "A")))).toBe(renderSvg(d));
    const pdf = renderPdf([d, createdRoom(roomSchedule(room))]);
    expect(/\/Count 3/.test(pdf)).toBe(true);
  });
});
