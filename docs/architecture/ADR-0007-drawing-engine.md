# ADR-0007 — Drawing engine: resolved model → drawing model → SVG / PDF

Status: **Accepted** (2026-09-26, M3)

## Decision
- `@lintel/drawing-engine` derives drawings only from a `ResolvedCabinet` (DesignVersion + resolved model,
  PRD §33). There is no separately maintained 2D copy and no UI / rendering-library dependency.
- Pipeline: resolved model → **drawing model** (`Drawing`: sheets of pure line/text primitives in sheet
  millimetres) → **SVG** (canonical, one file per sheet) and **PDF** (dependency-free PDF 1.4 writer, standard
  Helvetica, vector lines). Both renderers are deterministic: no clock, fixed metadata, fixed number formatting.
- V1 drawings: **Front Elevation** (orthographic front view; exact hidden-line removal for axis-aligned panels —
  hidden edges dashed; automatic standard scale 1:1…1:100; dimensions read from the model) and **Panel Schedule**
  (one row per component incl. components that could not be generated; paginated).
- Every drawing carries the PRD §34 title block (project, room, number, title, revision, date, designer, checker,
  scale, approval status, source DesignVersion) plus the **model fingerprint** and **data classification**, and is
  deep-frozen and hash-sealed (`verifyDrawing`). SVG files carry the same trace as data attributes.
- **Staleness:** `checkDrawingStaleness(drawing, currentModel)` compares design version and model fingerprint.
- **Watermark:** any TEST_FIXTURE input, or any outstanding BLOCKER, puts a "NOT FOR PRODUCTION" watermark and
  banner on every sheet.
- **Production guard:** `FOR_PRODUCTION` is granted only if the design version is APPROVED/LOCKED
  (`assertProductionEligible`), the model was resolved from that approved version, the model has zero blockers and
  its data classification is PRODUCTION. Otherwise the request is refused with reasons. PRELIMINARY / FOR_REVIEW
  drawings remain available (watermarked).
- Drawing text is ASCII-only so SVG and PDF render identically with standard fonts.

## Consequences
Side Section and Internal Elevation (PRD §33) reuse the same projection with a different view axis (M4+).
Drawings of production data become FOR_PRODUCTION-eligible automatically once Lintel data is approved.
