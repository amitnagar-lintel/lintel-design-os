# Lintel Design OS — Claude Code Instructions

This repository implements Lintel Design OS.

## Primary source of truth

Read:

`/docs/PRD/LINTEL_DESIGN_OS_MASTER_PRD_v1.md`

before making architectural or product-level changes.

## Engineering principles

- Keep domain logic independent from React and rendering.
- Treat the intelligent design model as the single source of truth.
- Keep formulas and construction rules data-driven and versioned.
- Keep BOQ and BOM separate.
- Keep manufacturer integrations behind adapters/data models.
- Do not invent Hettich technical specifications when official/authorized data exists.
- Do not hard-code pricing inside geometry logic.
- Never generate production output from a non-approved design version.
- Preserve source traceability for all derived artifacts.
- Use strict TypeScript.
- Prefer pure functions for calculations.
- Add tests for every deterministic calculation.
- Do not change unrelated code.
- Do not perform broad refactors while implementing a scoped task.

## Repository behavior

Before implementing a task:

1. Inspect repository structure.
2. Read relevant existing modules.
3. Identify reusable code.
4. State the implementation approach briefly.
5. Implement the smallest coherent change.
6. Run typecheck.
7. Run lint.
8. Run tests.
9. Report changed files and test results.

## Do not

- Do not invent construction dimensions.
- Do not use AI-generated dimensions as authoritative manufacturing data.
- Do not silently alter database migrations.
- Do not delete existing tests without explaining why.
- Do not duplicate domain models in UI packages.
- Do not couple Three.js directly to business calculations.
- Do not embed licensed manufacturer CAD assets without confirming permitted use.

## Current development milestone

Build the first complete vertical slice:

`Project → Room → Parametric Base Cabinet → Hettich Resolution → BOM → BOQ → Price → Execution Elevation`

## First product

`KIT_BASE_STANDARD`

Reference dimensions:

- Width: 600 mm
- Height: 720 mm
- Depth: 560 mm
- Carcass: 18 mm
- Back: 6 mm
- Shelves: 1
- Shutters: 2

Use configurable construction rules. Do not assume the reference cabinet's final manufacturing details where the recipe/catalog has not yet defined them.

## Required completion report

At the end of each task report:

- Summary
- Files created
- Files modified
- Tests run
- Typecheck result
- Lint result
- Assumptions
- Remaining issues
