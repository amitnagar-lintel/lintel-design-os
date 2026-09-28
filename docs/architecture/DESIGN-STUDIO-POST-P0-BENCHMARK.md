# Design Studio — Post-P0 Benchmark

**Status:** complete. A fresh, honest, browser-only benchmark of the Design Studio on `main` at commit
`07dc962` ("P0 fixes from the real-designer UX audit: wall-aware placement, multi-wall Elevation, resize
reflow, #48"), which followed directly from `docs/architecture/DESIGN-STUDIO-REAL-DESIGNER-UX-AUDIT.md`.
This is an observation exercise, not a remediation: no application code was changed while producing it.

**Session:** LOCAL rehearsal pilot (`pnpm pilot:demo --reset`), driven through the real browser UI with
Playwright/Chromium, signed in as SALES (to create the client/project and add the DESIGNER to it — SALES is
the only rehearsal role with `project.write`) and DESIGNER (room, design, version, and every cabinet edit —
DESIGNER holds `room.survey.write` and `design_version.author`) against the seeded TEST_FIXTURE reference
data. Screenshots referenced below are under `.post-p0-benchmark-screenshots/` at the repo root, numbered
01–55 in the order they were taken.

**Test kitchen, as specified:** 4000×3000×2700mm room, wall A the main wall, wall B the return wall (chosen by
using the `A-B` corner). Main wall: 600 shutter, 900 drawer bank, 600 sink, 300 pull-out, then an L-corner pair
turning onto wall B. Return wall: 600 hob, 600 oven tower, an open/shelf cabinet, an end panel. No substitutions
were needed — every product named in the brief exists in the TEST_FIXTURE catalog at exactly the requested
default width (base cabinets default to 600mm, the pull-out to 300mm; only the drawer bank needed a resize
from its 600mm default up to 900mm, which is itself just an ordinary Properties-panel edit).

---

## 1. The 16-step checklist

| # | Step | Verdict | Evidence |
|---|---|---|---|
| 1 | Add cabinets via wall-aware "Add to wall" | **PASS** | The library's own "Add to wall" selector (Slice/Remediation P0-1) was used for every addition — wall A for the four main-wall cabinets (`12`–`16`), wall B for the four return-wall cabinets after switching the selector (`20`–`24`). No cabinet landed on the wrong wall. |
| 2 | Main run contiguous/ordered | **PARTIAL** | Order was correct immediately (`17`), but the run was **not** contiguous: the corner pair is placed flush against wall A's own far end regardless of what's already on the wall, and the four main-wall cabinets (built end-to-end from x=0) left a **1000mm gap** before the corner leg (`18`, `19`, `26`, `27` — Properties even reports it plainly: "← BC-004: gap 1000 mm"). This was closed by hand, editing each cabinet's "Along wall" field right-to-left (`28`). Ordering was never wrong; contiguity needed manual repair. |
| 3 | Return run contiguous/ordered | **PASS** | Built in order (hob, oven, open, end panel) immediately after the corner's own wall-B leg; every adjacency read "touching (gap 0 mm)" from the first add (`21`–`25`, confirmed again at `29`). The corner-first-vs-run-first placement math worked cleanly here because the corner was added before the return-wall cabinets. |
| 4 | Corner relationship surfaced | **PARTIAL** | The engine genuinely computes it — `GET .../model` returns `{"type":"CORNER","wallIds":["A","B"],"gap":0,"touching":true}` linking BC-005/BC-006 — but the Properties/Run panel never displays a "Corner" line anywhere in the UI (checked on both legs, `18`, `27`); a designer sees only the visual fact that the two legs touch in Plan. Same gap the 6F acceptance and real-designer UX reports both flagged; not one of the three P0 fixes, and it still isn't there. |
| 5 | Plan reads correctly as an L | **PASS** | `29` (and `25` before the gap fix) show a clean, correctly proportioned L with no overlaps; the only visual defect is cosmetic — the 300mm pull-out's "BC-004" label is squeezed against its neighbour, a pre-existing cosmetic issue also noted in the real-designer audit. |
| 6 | Elevation for both walls | **PASS** | This is the headline P0 fix, and it holds up: `30` (wall A) and `31` (wall B) both render full, correct cabinet geometry — fronts, shutters, the drawer bank's 3 drawers, the pull-out's frame lines — left-to-right in the right order and spacing. Wall B was completely broken (floating labels, no geometry) before this fix; it is now indistinguishable in quality from wall A. |
| 7 | 3D view reads as a real L-kitchen | **PASS** | Visible in every screenshot's centre pane (e.g. `29`, `37`); cabinet types are visually distinguishable (carcass vs. drawer front vs. open shelving), the selected cabinet highlights blue, and the L shape is unambiguous once both walls are populated. |
| 8 | Selection sync across views | **PASS** | Cabinet 1 (BC-002, 900mm drawer bank, wall A): clicked in Plan (`32`), confirmed highlighted in Elevation A + 3D + Properties simultaneously (`33`). Cabinet 2 (BC-007, hob, wall B): clicked in Elevation B (`34`), confirmed in Plan + 3D + Properties (`35`). Both directions, both walls, agreed immediately with no manual refresh. |
| 9 | Resize a middle cabinet | **PASS** | BC-007 (hob, wall B, cabinet 2 of 5) resized 600→615mm via the Properties panel (`36`→`37`). A larger delta was deliberately avoided here: wall B's run starts at along=560 (the corner leg's own depth offset eats into the wall), leaving only ~22mm of real slack before the run hits the wall's far end — so this is the largest "ordinary" resize that wall could actually accept without becoming the impossible-resize case in step 11. |
| 10 | Automatic neighbour reflow | **PASS** | BC-008 (oven) and BC-009 (open) shifted +15mm each to stay contiguous with the resized hob, confirmed in Plan (`38`), Elevation B (`39`), the Run panel's own "touching (gap 0mm)" readouts on both sides of BC-007, and the BOM (`40`, generated straight after, run length correctly reads 2433mm). |
| 11 | Impossible resize, error + intact state | **PASS** | Tested **two** distinct impossible cases. (a) Wall-overflow: growing the hob 615→1200mm would push the end panel to 3128mm on a 3000mm wall — rejected with "Shifting BC-009 to 2960–3560mm would put it outside wall B (0–3000mm). Choose a smaller change, or move cabinets out of the way first." (`41`, `42`), and after reselecting, the hob still reads 615mm with neighbours untouched (`43`). (b) Corner-block: **any** resize of a main-wall cabinet in front of a corner leg is refused outright, regardless of direction or size — shrinking BC-002 (900→750mm) was rejected with "BC-005 is part of a corner and can't be shifted automatically — move or resize it directly instead." (`44`, `45`), state confirmed intact at `46`. Both are clear, specific, actionable errors; both left the prior valid state exactly as it was. |
| 12 | Validation panel | **PASS** (mechanism) / see §3 for the noise caveat | `47`: 0 BLOCKER, 94 ERROR, 0 WARNING, `canApprove: true`. Every one of the 94 ERRORs is `STANDARD_UNKNOWN_VARIABLE` — a **rehearsal-fixture data gap** (the shared `REHEARSAL_CONSTRUCTION_STANDARD` declares variables that individual recipes don't all consume), not a Design Studio defect; it was already documented as pre-existing baseline noise in both prior reports (112 ERRORs on an 11-cabinet kitchen there; 94 here on a 10-cabinet one — same cause, same shape). The panel itself works exactly as designed: clicking counts, grouping, and severity are all correct. |
| 13 | BOM generation | **PASS** | `40`: "BOM PRELIMINARY" generated in one click, headline line reads "0 BLOCKER, 0 WARNING", Run panel alongside confirms the actual as-built widths/positions it was generated from. Payload itself is still only a collapsed raw-JSON "Full payload" disclosure, not a formatted cutting list — a pre-existing gap, not new. |
| 14 | Save / autosave | **PASS** | There is no separate "Save design" action anywhere in this app by design — every Properties-panel "Save" click is itself an immediate `PATCH`/`POST` to the API. `48` confirms the hob reads 615mm (the step 9 edit) with nothing pending, immediately before the reload in step 15. |
| 15 | Force a fresh reload | **PASS** | `49`: a genuine full `page.reload()` (not client-side nav) landed back on the bare Login screen (app state — `step`, `sel` — is plain React state, never persisted, by design); re-navigated Project → Room → Design Studio from scratch (`50`) and the same DRAFT version loaded automatically (it's the design's only version). |
| 16 | Full kitchen persists exactly | **PASS** | A field-by-field API comparison of all 10 objects (wall, width, along-wall start/end, product code) between the pre-reload and post-reload model was an **exact match, zero mismatches** — including the step 9–10 resize (hob at 615mm) and its reflow. Visually confirmed too: Plan (`51`), Elevation A (`52`), Elevation B (`53`), and Properties for both test cabinets (`54`: BC-002 still 900mm; `55`: BC-007 still 615mm). Validation state after reload was byte-identical (0/94/0). |

**Tally: 12 PASS, 4 PARTIAL, 0 FAIL** (steps 2, 4, and the noise caveat on 12 are the PARTIALs; step 2 is scored once as PARTIAL even though it required a manual fix, not because anything was actually broken twice).

---

## 2. The 10-dimension evaluation

| Dimension | Verdict | Notes |
|---|---|---|
| **Placement** | PASS | Wall-aware "Add to wall" (the P0-1 fix) worked for every one of the 8 ordinary adds, on both walls, with zero misplacements. This was the single biggest complaint in the prior UX audit and it is simply fixed. |
| **Runs** | PARTIAL | Ordering within a run is always correct and the Run panel's adjacency/gap readout is genuinely good UX (it told us the exact 1000mm gap in plain language, unprompted). But building a run left-to-right *before* adding its corner leaves a gap by construction — nothing currently warns a designer this will happen, or offers to close it automatically. |
| **Corner** | PARTIAL | The corner *solver* itself is excellent — both legs land exactly touching, on the correct walls, for either build order tested. The relationship is correctly computed and even feeds the resize/reflow guard (the corner-block case in step 11). It is simply never surfaced anywhere in the Properties panel. |
| **Multi-wall Elevation** | PASS | The P0-2 fix. Wall B now renders identically well to wall A — real geometry, correct spacing, correct click targets. This was a hard, disqualifying gap in both prior reports; it is gone. |
| **Resize/reflow** | PASS | The P0-3 fix. A successful resize reflows every downstream same-run cabinet automatically and atomically; an impossible one (wall overflow, or a corner leg in the way) is rejected up front with a specific, correct message and writes nothing. The "resize a cabinet that has a corner leg in its own run" case is interesting: it's refused unconditionally rather than reflowing everything *except* the corner leg, which is the conservative, safe choice, but it does mean the four main-wall cabinets in this exact kitchen can never be resized in place — only replaced, removed, or moved by hand — a real, if narrow, remaining limitation worth knowing about. |
| **Selection** | PASS | Plan ⇄ Elevation ⇄ 3D ⇄ Properties agree immediately in both directions, for cabinets on both walls. No regressions, no lag. |
| **Validation** | PASS (mechanism) / noise unaddressed | The panel's own behaviour — counts, click-to-locate, severity buckets — is correct and unchanged from the two prior reports' assessment. The 94-error noise floor is a **fixture/data limitation** (the shared rehearsal construction standard over-declares variables relative to what each recipe consumes), not a product defect — but it is still a real, un-triaged UX cost: a designer reading "94 ERROR" during this whole session had no way to tell, from the badge alone, that all 94 were identical-in-kind and zero were about placement. |
| **BOM** | PASS | Generates in one click, reflects the exact as-built/as-resized kitchen (run length, cabinet count), 0 BLOCKER/0 WARNING. Still only a raw-JSON payload behind a disclosure triangle, not a formatted cutting list — unchanged from both prior reports. |
| **Persistence** | PASS | Exact, field-by-field match across a genuine full-page reload, for every one of 10 objects, including the mid-session resize. No manual save step exists or is needed. |
| **Overall designer usability** | PARTIAL | The three targeted P0 fixes each land cleanly and solve exactly the problem they were meant to solve — this is a materially better tool than the one the real-designer audit tested. What's left is a smaller, more specific set of gaps: the corner-then-run-or-run-then-corner gap math, the missing Corner readout, validation noise, and a still-absent duplicate/bulk-move/type-convert toolset (unchanged from both prior audits — this benchmark didn't re-test those since they weren't in scope of the three P0 fixes, but nothing in this session suggests they've changed). |

---

## 3. Genuine product defects vs. fixture/data limitations

It matters which of these two buckets a finding belongs to, so they are kept separate rather than blended into one severity list.

**Genuine product/UX defects** (real, in the application, worth fixing):

1. Building a run before its corner (or a corner before its run, depending on order) can leave a designer-invisible-until-selected gap between the run and the corner leg — nothing in the "+ Add" flow warns about this or offers to close it.
2. No UI surface anywhere shows the corner relationship the engine already computes correctly.
3. Any resize of a cabinet whose own run has a corner leg downstream is refused outright (even a shrink, which would only ever need to *open* space, never close it into the corner) — a safe but blunt guard that removes in-place resizing for an entire class of common cabinets (anything before an L-corner).
4. The Validation panel's badge count doesn't distinguish placement-relevant issues from schema/reference-data noise, so "94 ERROR" reads as equally alarming whether it's 94 real problems or 94 identical warnings about the same missing standard variable.
5. BOM remains a raw-JSON payload, not a human-readable cutting list.

**Fixture/data limitations** (not application defects — artifacts of the TEST_FIXTURE rehearsal catalog, would not appear against a complete real construction standard):

1. The 94 `STANDARD_UNKNOWN_VARIABLE` ERRORs: `REHEARSAL_CONSTRUCTION_STANDARD` declares variables (e.g. `DRAWER_BOX_FRONT_SETBACK`, `PULLOUT_FRAME_HEIGHT`, `OVEN_BAY_BOTTOM_OFFSET`) that individual recipes don't all consume — a data-completeness gap in the synthetic rehearsal standard, already called out identically in both prior reports at a different but comparable count (112 on an 11-object kitchen there, 94 on a 10-object one here). This is not something the Design Studio application is doing wrong.

---

## 4. Top remaining productivity problems, ranked

1. **The corner/run gap.** Of everything observed this session, this is the one that actually produced wrong output that had to be manually corrected — a 1000mm gap in a run a designer would reasonably expect to be flush. It's subtle (only visible by noticing white space in Plan, or reading the Run panel's "gap Nmm" text) and it will recur for any kitchen built main-run-first.
2. **No corner-relationship readout.** A designer relying on the corner solver has no in-UI confirmation it worked correctly beyond "the two boxes touch in Plan" — a one-line "Corner: touching wall B" in the Properties panel (the engine already has this data) would close a real confidence gap cheaply.
3. **Resize is all-or-nothing near a corner.** Refusing to shift a corner leg is the right default, but refusing to resize the cabinet *before* it at all — even to shrink it — is stricter than necessary and forecloses a common editing pattern (narrowing a run to make room) for exactly the cabinets next to the tool's own signature corner feature.
4. **Validation signal-to-noise**, unchanged from both prior reports: real, correctly-detected problems (had there been any this session) would sit in the same bucket as 94 identical pieces of fixture-data noise, with no visual distinction beyond severity colour.
5. **BOM is still not a designer-readable artifact** — correct and complete, but a collapsed JSON blob rather than a cutting list.

---

## 5. Overall verdict

The three targeted P0 fixes each do exactly what they were built to do, and do it well: cabinets now land where the designer actually points them, Elevation is now a complete, trustworthy drawing for every wall of an L-shaped kitchen (not just the first one), and resizing a cabinet mid-run now either reflows its neighbours correctly and atomically or refuses cleanly with a specific reason — never a silent overlap. Selection sync, persistence, and the corner solver itself all held up under a genuinely fresh, unscripted build exactly as the prior two reports found them: already solid. What's left is smaller and more specific than before: a run built before its corner can end up with an invisible gap that has to be closed by hand, the corner relationship the engine computes is still never shown to the designer, resizing is now *safe* everywhere but *available* nowhere in front of a corner, and the validation panel's honest 0-BLOCKER result is still buried under fixture-data noise a first-time reader can't distinguish from a real problem. None of this is a regression, and none of it is severe enough to call the P0 work incomplete — it is the next, narrower layer of the same "last mile of the designer-facing surface" both prior reports already identified.
