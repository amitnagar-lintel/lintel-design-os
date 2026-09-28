# Design Studio — Real-Designer UX Audit

**Auditor stance:** a senior kitchen/interior designer sitting down with Lintel Design OS for the first time, judging it purely on speed, discoverability, clarity, and whether it behaves the way design software should — not on code quality, architecture, or how hard any of this was to build.

**Session:** LOCAL rehearsal pilot (`pnpm pilot:demo --reset`), driven through the real browser UI with Playwright/Chromium, signed in as SALES / SITE_ENGINEER / DESIGNER against the seeded TEST_FIXTURE reference data. Test kitchen: 4000×3000×2700mm room, wall thickness 120mm, main-wall run (600 shutter, 900 drawer, 600 sink, 300 pull-out, plus a 1000mm open/shelf cabinet), an A-B L-corner, and a return-wall run (600 hob, 600 oven tower, an end panel). Screenshots referenced below are under `.ux-audit-screenshots/`.

---

## 1. Executive conclusion

Lintel's Design Studio gets the fundamentals of a parametric kitchen tool right — a real 3-pane layout, a legible cabinet catalogue, synchronized Plan/3D/Properties selection, an actual corner-solver that auto-splits an L-corner across two walls, and a validation engine that understands genuine construction rules (gap thresholds, filler requirements, maximum run length). But it is not yet a tool a working designer could use unsupervised: new cabinets always spawn on the end of wall A regardless of the wall you actually want, resizing one cabinet in a run silently overlaps its neighbours instead of pushing them, there is no way to duplicate a cabinet or move a run as a unit, converting a shutter front to a drawer bank isn't possible at all, and the Elevation view is simply broken for every wall except A (cabinet fronts don't draw and click-to-select silently fails). On top of that, the validation panel drowns real, actionable geometry problems in dozens of "STANDARD_UNKNOWN_VARIABLE" schema-mismatch errors that have nothing to do with anything the designer did — which is exactly the kind of noise that trains a designer to stop reading the panel altogether.

## 2. Workflow results

| Workflow | Verdict | Observed friction |
|---|---|---|
| **Start** | PARTIAL | Nav (1 Login → 7 Issue) reads plainly, and Project/Room forms are simple, labeled, one-screen affairs (`03a-room-screen-cold.png`). But Design Studio opens to a bare "Create design" button with no orientation (`04a-design-studio-cold.png`); "version," "pinned to approved data," and per-item "Slice 6" badges in the library are internal/engineering vocabulary a non-technical designer has no way to parse. |
| **Build** | PARTIAL | Wall-A run built fast (five `+ Add` clicks, correct default widths for 4 of 5 types). The L-corner tool genuinely works — pick a corner, `+ Add pair`, both legs land correctly on their respective walls. But every cabinet meant for the *return* wall spawned on wall A instead (see §4) and had to be manually dragged over field-by-field; one oven tower landed entirely outside the room and became literally unselectable in Plan. |
| **Edit** | PARTIAL | Width/Height/Depth/Front/Shelf-or-Drawer-count/Material/Finish/Position are all plainly labeled, live-validated fields (`10a`, `10b`, `11-bc002-finish-material-fields.png`). "Overlay/Inset" is unexplained jargon. Resizing a cabinet mid-run does not reflow neighbours — it silently creates an overlap. |
| **Select/Navigate** | PARTIAL | Plan ⇄ 3D ⇄ Properties selection is genuinely well synchronized for wall A (`49a-select-BC002-in-plan.png`: same cabinet highlighted orange in Plan, blue in 3D, named in Properties). Elevation for wall A is a beautiful, correct rendering of fronts, drawers and shelves (`47a`). Elevation for every *other* wall is broken — labels float in empty space with no cabinet geometry, and clicking them does not reliably select (`47b`, `50a`–`50c`). |
| **Speed** | PARTIAL/FAIL | See task table in §3 — adding to the default run is fast; almost everything else (resize-mid-run, type conversion, duplication, run-level move) is slow, manual, or unsupported outright. |
| **Realism** | FAIL (as-is) | I completed the spec kitchen, but only after several rounds of manual arithmetic to un-overlap a run I had legitimately resized once, and after discovering — by trial and error — that "+Add" ignores the wall you actually want. |
| **Outputs** | PARTIAL | Plan/Elevation(A)/3D/Validation/BOM all end up reflecting the real design once it's fixed. BOM generation is not blocked by outstanding BLOCKER-severity issues (no safety gate). The BOM tab shows only a technical snapshot header plus a raw-JSON "Full payload" disclosure (`51-bom-full-payload-expanded.png`) — not a human-readable cutting list. |

## 3. Task analysis

| Task | Approx. interactions | Friction notes |
|---|---|---|
| **Add cabinet next to an existing one (on wall A)** | 1 click (`+ Add`) | Genuinely fast: the library auto-appends the new cabinet at the end of the existing run (`nextFreeX`), and for shutter/sink/pull-out the seeded default width already matched the spec. |
| **Modify dimensions (900→750mm)** | select (1) + edit Width (1) + Save (1) = 3 | The field itself is trivial. The *hidden* cost: if the cabinet has neighbours to its right, they now overlap it and nothing auto-adjusts (see next row). |
| **Change front (shutter→drawer)** | **Not supported** | "Cabinet type" is a permanently disabled/read-only field. The only path is Remove + add the other type from the library + manually reposition + manually re-set material/finish — you lose everything about the original placement. |
| **Add/change a drawer count** | select (1) + choose drawer-count dropdown (1) + Save (1) = 3 | Works cleanly and is well-labeled ("Drawer count", "2/3/4 drawers"). |
| **Build a run** | 1 click per cabinet, if all going on wall A | Excellent when the whole run lives on the room's "wall A". Breaks down the moment any cabinet in the run belongs on B/C/D (see Corner/Move rows). |
| **Corner** | select corner id (1) + `+ Add pair` (1) = 2 | The one unambiguously *good* piece of automation in the whole session: both legs are placed correctly, on the correct walls, meeting without overlap, no math required. |
| **Move (a cabinet meant for another wall)** | select (1) + Wall dropdown (1) + Along field (1) + Distance field (1) + Save (1) = 5, **per cabinet** | Every "+Add" places the new cabinet on wall A at the end of the existing sequence, regardless of intent. Getting a hob and an oven tower onto the return wall took 2×5 = 10 manual field edits, done blind (no visual drag target on the correct wall until you've already set `Wall=B`). |
| **Move an entire run as one operation** | **Not supported** | No "arrange run" / bulk-move exists in Design Studio. (Notably, an older, simpler screen in this same codebase — `Layout.tsx` — *does* have an "Arrange run (edge to edge)" button; that convenience did not carry forward into the current 3-pane Studio.) |
| **Change a finish** | select (1) + Finish dropdown (1) + Save (1) = 3 | Mechanically fine — but the seeded catalogue has exactly one finish (`LAMINATE_WHITE`), so switching *between* finishes could not be exercised end-to-end this session. Finishes/materials are presented as raw codes (`BOARD_BWP_18`, `LAMINATE_WHITE`), not swatches or human names. |
| **Validation: create → see → fix** | Emerged naturally from the 750mm/900mm resize task | Growing BC-002 from 600→900 immediately overlapped its neighbour: Validation flipped to `1 BLOCKER … OBJECT_COLLISION`, and the 3D view rendered visible z-fighting/geometry tearing where the two cabinets intersected (`11-bc002-finish-material-fields.png`) — a dramatic, if accidental, "something is very wrong" signal. Fixing it required recomputing every downstream cabinet's `Along` value by hand; my first attempt overshot and traded the overlap for a new BLOCKER (`FILLER_REQUIRED`, a >10mm gap). |
| **Outputs (BOM/Validation/Plan/Elevation/3D)** | BOM: 1 click (`Generate BOM`) | Generates even with BLOCKER-severity errors outstanding (no export gate). Output is a snapshot header + hash + a collapsed raw-JSON payload, not a formatted cutting list. |

## 4. Major UX problems, ranked by practical impact

**P0 — prevents real design work**

- **New cabinets ignore the wall you want them on.** `+Add` always appends to the end of whatever is on "wall A," even when you're adding a hob or oven tower meant for the return wall. One oven tower, added this way, landed with its footprint entirely past the room boundary and could not be selected by clicking in Plan at all — the only way back was the Validation panel's click-to-select. A first-time designer has no way to know this will happen and no visible cue when it does (the Plan view briefly renders with nothing in it at all — see `12b-after-add-oven.png`, `13b-after-corner-pair.png` — before it settles).
- **Elevation is broken for every wall except A.** Wall B (and, by the same code path, presumably C/D) draws only floating object-code text with no cabinet geometry underneath (`47b-elevation-wallB-clean-final.png` — compare to the correct `47a` for wall A), and clicking where a cabinet should be does not reliably select it (confirmed by direct testing: clicking the second whole-cabinet hit-target on wall B's elevation left the *previous* wall-A selection in place). For a kitchen with any return wall — i.e. almost any real kitchen — this makes Elevation useless for exactly the wall a designer would need to check appliance/joinery heights on.
- **Resizing a cabinet does not reflow its run.** Growing BC-002 from 600→900mm left it overlapping BC-003 with no warning at the moment of editing — only a small "→ BC-003: gap −300 mm" line in the Run panel, easy to miss, and a 3D view that renders the overlap as visual noise rather than a clear callout.

**P1 — significantly slower or error-prone**

- **No duplicate/copy, anywhere.** Building 3 identical shutter cabinets is 3× (add, wait for default width to (maybe) match, adjust if not, position). There is no "repeat last cabinet" and no multi-select.
- **No run-level move.** An entire run can only be relocated one cabinet at a time, each requiring Wall+Along+Distance to be set correctly by hand. A dropped/legacy screen in this same app (`Layout.tsx`) once had exactly this ("Arrange run (edge to edge)") — the flagship Studio doesn't have it.
- **No cabinet-type conversion.** Shutter → drawer bank (or any cross-type change) requires delete-and-recreate, losing position/material/finish state.
- **Validation signal-to-noise.** In this session, a correctly-placed 5-cabinet run reported **39 errors** before a single mistake was made — all `STANDARD_UNKNOWN_VARIABLE` (a construction-recipe/standard schema mismatch, not a placement problem). A real blocker (`OBJECT_COLLISION`, `FILLER_REQUIRED`) is indistinguishable at a glance from this background noise; the panel does group by severity (BLOCKER/ERROR/WARNING) but the *count* badge in the tab title and the top summary bar don't discriminate placement-relevant from data-schema noise.
- **BOM is not a designer-readable artifact.** "Full payload (as stored)" is raw JSON. There's no visible cutting list, quantities table, or per-cabinet line items surfaced in the Studio itself.

**P2 — useful but not blocking**

- "Slice 6," "Slice 4," "Slice 2" badges on not-yet-available library items are internal roadmap vocabulary leaking into a production-feeling UI; "Coming soon" (or simply hiding them) would read better to a non-technical designer.
- "Overlay" / "Inset" front-mounting terms are unexplained; a one-line tooltip would help.
- Materials/finishes are shown as raw catalogue codes (`BOARD_BWP_18`, `LAMINATE_WHITE`) rather than human labels or swatches.
- A narrow cabinet's Plan-view label can be visually clipped/overlapped by a neighbour's box (`BC-004`'s label reads as "BC-00" behind BC-005 in several screenshots) — cosmetic, but it undermines "which cabinet is this" confidence exactly where a designer is trying to check.
- The one legitimate blocker left in the final, fully-fixed kitchen (`RUN_TOO_LONG — 4000mm run, maximum 3600mm`) is a genuinely good, real construction-rule catch — worth calling out as something the tool gets *right*.

## 5. Missing productivity features

Ranked by how directly the current workflow needs them:

1. **Duplicate / copy-paste a cabinet (and a run).** The single highest-leverage addition. Every one of the "build 4 shutter cabinets" / "repeat this hob on the other wall" moments in this session would have collapsed from 5+ manual field edits to 2 (duplicate, drag-or-set-position).
2. **Run-level move.** Select a run, drag or nudge it as one unit. Directly needed the moment a run has to shift because an adjacent appliance or corner changed.
3. **"Add to wall X" from the library (or an explicit wall-aware default).** Removes the single biggest, most confusing piece of friction observed this session — new cabinets landing somewhere the designer didn't ask for, sometimes off the room entirely.
4. **Auto-reflow (or an explicit "push neighbours" toggle) on resize.** Would turn the B-task resize from "silently creates a BLOCKER" into "cabinets to the right shift automatically, exactly like dragging in Plan already does for placement."
5. **Cabinet-type replace/convert**, keeping position, dimensions where valid, and finish. Even a simple "Replace with…" that pre-fills the new type's fields from the old instance would remove the single largest data-loss risk in editing.
6. **Multi-select.** Needed for run-level move, batch material/finish changes, and batch delete — none of which exist today.
7. **A validation filter/toggle for "placement issues" vs. "reference-data issues."** Even just splitting `STANDARD_UNKNOWN_VARIABLE`-class messages into a separate, collapsed bucket would make the badge count trustworthy again.
8. **A readable BOM/cutting-list view**, not just a raw-JSON payload behind a disclosure triangle.

## 6. Competitive observations

*(General pattern-based comparison against how parametric cabinet tools in this category — Infurnia, Coohom, Blum Cabinet Configurator, imos iX, PolyBoard — typically behave; not a fresh hands-on study of those specific products.)*

| Dimension | Lintel today |
|---|---|
| Cabinet insertion | Usable but slow — catalogue click-to-add works, but placement/wall-targeting is not what professional tools typically do (drag-to-place or an explicit target-wall picker). |
| Property editing | Already good — clear labeled fields, live limit-checking. |
| Front configuration | Missing (type conversion) / Already good (count, per-type). |
| Drawer configuration | Already good. |
| Snapping | Already good — Plan-view drag-to-wall/neighbour snapping exists and works for placement; **missing** for resize-triggered reflow. |
| Run building | Usable but slow — auto-append is a nice start; no run-level tools beyond that. |
| Corner handling | Already good — a genuine, dedicated corner-solver, which is often one of the harder things to get right in this category. A real differentiator worth keeping. |
| Materials/finishes | Incorrect/confusing — functional dropdown, but raw codes instead of swatches, and this session's catalogue offered no real choice to evaluate against. |
| Multi-view interaction | Usable but slow for wall A; **incorrect/confusing** for every other wall (Elevation rendering bug). |
| Validation | Usable but slow — real, specific messages (good) buried in schema noise (bad). |
| Drawing/output access | Usable but slow — outputs exist and are reachable in one or two clicks, but the BOM itself isn't a finished, readable artifact yet. |

## 7. Recommended next 5 improvements

Based only on what was actually observed this session:

1. **Fix Elevation rendering/selection for walls B/C/D.** This is a hard blocker for reviewing or working on any return wall — i.e. most real kitchens.
2. **Make "+Add" wall-aware** (or otherwise stop new cabinets from landing off the intended wall — including entirely outside the room, unselectably, as happened with the oven tower here).
3. **Add duplicate/copy for a cabinet and for a run.** Single highest-leverage speed fix available.
4. **Add auto-reflow (or a "push neighbours" affordance) when a cabinet's width changes inside a run**, so a resize can't silently create an overlap.
5. **Split validation's `STANDARD_UNKNOWN_VARIABLE`-class (reference-data/schema) messages from placement/geometry messages**, so the error count a designer sees actually tracks the state of their design.

## 8. Screenshots

All paths relative to `.ux-audit-screenshots/`.

- Cold start / nav: `00-cold-app-load.png`, `01-login-people.png`, `02-project-created.png`, `03a-room-screen-cold.png`, `03b-room-created.png`, `04a-design-studio-cold.png`
- Cabinet library: `05-cabinet-library.png`
- Cabinet placement (wall-A run building): `06a-after-add-shutter.png` → `06e-after-add-open.png`, `07-plan-after-wallA-adds.png`
- Editing a property (width resize + drawer count + material/finish fields): `10a-selected-bc002-drawer-before-edit.png`, `10b-bc002-resized-900.png`, `11-bc002-finish-material-fields.png`
- Corner tool: `13a-corner-AB-selected.png`, `13b-after-corner-pair.png`
- Wall-blind auto-placement problem (hob/oven landing on wall A / off-room): `12a-after-add-hob.png`, `12b-after-add-oven.png`, `14-plan-after-corner-and-return-additions.png`
- Validation, noisy-but-clean state (0 BLOCKER, 39 schema-noise errors): `09-validation-tab-with-issues.png`
- Validation, deliberate error state (resize-caused overlap, BLOCKER + 3D glitch): `11-bc002-finish-material-fields.png`
- Finished main run + finished kitchen: `46-plan-clean-final.png`
- Final Elevation, wall A (good) vs wall B (broken): `47a-elevation-wallA-clean-final.png`, `47b-elevation-wallB-clean-final.png`
- Final Validation (one legitimate blocker only): `45-validation-clean-final.png`
- BOM: `48-bom-clean-final.png`, `51-bom-full-payload-expanded.png`
- Selection sync (Plan ⇄ 3D ⇄ Properties, and the Elevation-B selection bug): `49a-select-BC002-in-plan.png`, `49b-BC002-still-selected-in-elevation.png`, `50a-elevationB-before-select-BC006.png`, `50b-selected-in-elevationB.png`, `50c-plan-shows-same-selection.png`

## 9. The 12 questions

1. Can I understand the application without engineering knowledge? — **PARTIAL** (plain nav and forms, but "version/pin," "Slice N," raw material codes, and schema-error codes are not designer vocabulary).
2. Can I create a cabinet quickly? — **PASS** on wall A / **FAIL** on any other wall.
3. Can I modify a cabinet quickly? — **PASS** in isolation / **FAIL** mid-run (cascading overlap).
4. Can I build a run quickly? — **PARTIAL** (great on wall A, no tools once it isn't).
5. Can I work around a corner naturally? — **PASS**.
6. Can I change shutters/drawers naturally? — **PARTIAL** (count: yes; type: not supported).
7. Can I change finishes naturally? — **PARTIAL** (mechanism fine; only one finish existed to test with, and no swatches).
8. Can I understand what I have selected? — **PASS** on Plan/3D/wall-A-Elevation / **FAIL** on other-wall Elevation.
9. Can I understand why validation failed? — **PARTIAL** (messages are specific and good; volume of unrelated noise undermines trust).
10. Can I move between Plan/Elevation/3D naturally? — **PARTIAL** (same split as Q8).
11. Can I recover from mistakes easily? — **PARTIAL** (Remove + Validation click-to-select both work; no undo; no easy fix for a cascading overlap).
12. Can I complete a kitchen without thinking about the software? — **FAIL** (wall-targeting, run math, and validation-noise triage all demanded active engineering-style attention throughout).

**PASS: 2 · PARTIAL: 8 · FAIL: 2**

## Final question

**Could a Lintel interior designer use this today to design a real kitchen? NOT YET.**

The core mechanics — catalogue-driven insertion, a real corner-solver, synchronized selection, a construction-rule-aware validator — are genuinely there and, on wall A, feel close to professional-grade. But three things stand between this and a designer working unsupervised: cabinets landing on the wrong wall (sometimes literally outside the room) with no visible cue, a broken Elevation view for every wall except the first, and no way to duplicate, bulk-move, or convert a cabinet without manual rework. Any one of these would slow a real project down; together, on a kitchen with more than one wall (i.e., nearly all of them), they would push a designer back to whatever they used before this tool existed.
