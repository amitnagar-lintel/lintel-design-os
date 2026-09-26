# ADR-0005 — Hardware resolution through manufacturer adapters; only authoritative data is approvable

Status: **Accepted** (2026-09-26)

## Decision
- `@lintel/types` defines the manufacturer-agnostic contract: `FittingSituation`, `HardwareRequirement`,
  `HardwareResolution`, `ManufacturerAdapter`. `@lintel/design-engine` builds fitting situations from
  construction context (PRD §26) and routes requirements to **injected** adapters; it never imports a
  manufacturer package.
- `@lintel/hettich-engine` is the first adapter: article schema (PRD §25), compatibility engine,
  quantity from data-driven calculation rules (no hinge-count tables in code, PRD §27).
- `HETTICH_OFFICIAL_DATASET` is **empty** in M1: no article numbers or specs are typed from memory.
  Hinges therefore resolve as `UNRESOLVED` (BLOCKER) and appear in the BOM as unresolved lines.
- `HETTICH_TEST_FIXTURE_DATASET` uses obviously fake `FIXTURE-*` article numbers and is
  `authoritative: false`, which always yields a `HARDWARE_DATA_NOT_AUTHORITATIVE` BLOCKER.
- Door weight is computed only when the catalog defines board density; otherwise it is `null` and any
  weight-based rule reports unresolved rather than guessing.

## Consequences
Adding Blum/Grass/Hafele is a new adapter package; no change to the design engine.
