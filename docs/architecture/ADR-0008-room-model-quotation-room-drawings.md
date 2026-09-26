# ADR-0008 — Room model, planning standard, quotation and room drawings (M4)

Status: **Accepted** (2026-09-26, M4)

## Decisions
1. **Room coordinate system.** Rectangular room interior; x along wall A, z into the room, y up; origin at the
   inside floor corner of walls A and D. Each wall has a left → right frame as seen from inside the room, which is
   also the local +X of a cabinet backing onto that wall.
2. **Quarter turns only.** 0/90/180/270° about the vertical axis; anything else (including tilt) is
   `ROTATION_UNSUPPORTED` and the object is not placed. Keeps collision and projection exact.
3. **`resolveRoom`** reuses `resolveCabinet` per object (no duplicated cabinet logic), places every component in
   room coordinates, and is deterministic and input-order independent. Room trace lists every object fingerprint;
   the room fingerprint also covers placement, planning standard and overrides.
4. **Relationships derived from geometry** (against wall, adjacency / touching, same-wall run, corner). Manual
   overrides are explicit, versioned and audited; only INTENTIONAL_GAP has an effect in M4.
5. **PlanningStandard is separate from ConstructionStandard** (positioning vs construction). Lintel draft all NULL;
   TEST_FIXTURE standard for tests. Only values a layout needs are reported as undefined.
6. **Combined BOM / BOQ** keep every object's BOM / BOQ intact; room totals trace to object BOM lines.
7. **Quotation**: per-object M2 price snapshots → line taxable amounts → group by tax rate → tax per configured
   tax policy → configured rounding → totals. Policy (GST rates, tax policy, rounding, discount) is versioned data;
   production all NULL; TEST_FIXTURE uses tax on each rate-group total. Only DiscountPolicy NONE exists.
8. **One projection framework** (`ViewSpec` + `projectBox` + `fitViewport` + dimensioner) for Front Elevation,
   Side Section, Cabinet Internal Elevation (fronts removed) and Wall Internal Elevation. No duplicated geometry.
9. **Room drawings** (Wall Internal Elevation — primary; Room Panel Schedule) carry the room fingerprint, room id and
   object ids; staleness reports exactly which objects changed (shared with quotations via `compareRoomTrace`).
   Same watermark and FOR_PRODUCTION guard as object drawings, applied to the whole room.

## Consequences
Arbitrary angles, openings/columns, appliances, fillers and end panels as real components, and door-swing clearance
are later work. Production output remains blocked until construction, planning, Hettich, edge-banding, pricing and
finance data are approved.
