# 08 — Planning standards (room positioning)

Data set: `LINTEL_PLANNING_STANDARD` (`packages/catalog-engine/src/data/planning.ts`) — v0.1.0, `DRAFT`,
every value `null`. Separate from the construction standard:

- **ConstructionStandard** answers: *how is the cabinet physically constructed?*
- **PlanningStandard** answers: *how is the cabinet allowed to be positioned in the room?*

Any placement check that needs a NULL value reports `PLANNING_VALUE_UNDEFINED` (BLOCKER), only for values the
layout actually uses. The **meaning** column is the engine's current definition; Lintel must confirm or
correct it when supplying the value.

| # | Field | Unit | Meaning (to be confirmed) | Check that uses it | Value | Status | Provided by | Approved by / date |
|---|---|---|---|---|---|---|---|---|
| P1 | MIN_WALL_CLEARANCE | mm | Minimum distance between the end of a run and the perpendicular wall it runs towards | `WALL_CLEARANCE_BELOW_MINIMUM` (each run end) | NULL | NULL / UNVERIFIED | — | — |
| P2 | MIN_CABINET_GAP | mm | Smallest non-zero gap permitted between adjacent objects (touching is always allowed) | `GAP_BELOW_MINIMUM` | NULL | NULL / UNVERIFIED | — | — |
| P3 | MAX_GAP_WITHOUT_FILLER | mm | Largest gap between adjacent objects permitted without a filler | `FILLER_REQUIRED` | NULL | NULL / UNVERIFIED | — | — |
| P4 | FILLER_THRESHOLD | mm | Narrowest filler that can be manufactured / fitted; a gap needing a filler but narrower than this is unfillable | `GAP_UNFILLABLE` | NULL | NULL / UNVERIFIED | — | — |
| P5 | MAX_RUN_LENGTH | mm | Maximum length of one same-wall run | `RUN_TOO_LONG` | NULL | NULL / UNVERIFIED | — | — |
| P6 | SERVICE_VOID_REAR | mm | Required service clearance: minimum distance between an object's back and the wall it faces | `SERVICE_VOID_BELOW_MINIMUM` | NULL | NULL / UNVERIFIED | — | — |

Other service clearances (e.g. to appliances, windows, sockets) are not modelled in M4; they would be added here
as further planning fields when the room model includes openings and appliances.

Geometry checks that need no planning data (always active): `OBJECT_COLLISION` (exact, component level; touching
allowed), `OBJECT_THROUGH_WALL`, `OBJECT_BELOW_FLOOR`, `OBJECT_ABOVE_CEILING`, `ROTATION_UNSUPPORTED`
(only 0°/90°/180°/270°), `DUPLICATE_OBJECT_ID`, `DUPLICATE_OBJECT_CODE`, `OBJECT_ROOM_MISMATCH`.

## Relationship overrides
Relationships (against wall, adjacency / touching, same-wall run, corner) are derived from geometry; normal
cabinets need no manual entry. Explicit overrides are versioned and audited (id, version, author, date, reason):

| Override | M4 effect |
|---|---|
| INTENTIONAL_GAP | Applied: suppresses gap / filler checks for that adjacent pair; relationship marked `OVERRIDE` |
| FILLER, END_PANEL, SHARED_SIDE, SPECIAL_CORNER | Recorded for audit (`OVERRIDE_NOT_YET_SUPPORTED` warning); effect not modelled yet |
