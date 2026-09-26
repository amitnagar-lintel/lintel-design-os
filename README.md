# Lintel Design OS

Design-to-execution platform for interior design and modular manufacturing.
**The intelligent project model is the single source of truth** — BOM, BOQ, price, drawings and
manufacturing data are all derived from the same parametric model.

- Product & technical requirements: [`docs/PRD/LINTEL_DESIGN_OS_MASTER_PRD_v1.md`](docs/PRD/LINTEL_DESIGN_OS_MASTER_PRD_v1.md)
- Engineering rules for Claude Code: [`CLAUDE.md`](CLAUDE.md)
- Architecture decisions: [`docs/architecture/`](docs/architecture/)

## Status — Milestone 1: deterministic parametric cabinet engine

`KIT_BASE_STANDARD` runs end-to-end as pure TypeScript (no UI, no database):

```text
DesignObject ─► parameter resolver ─► formula engine ─► construction rules
     ─► component generator ─► geometry metadata ─► Hettich adapter (hardware)
     ─► validation ─► BOM ─► BOQ            (all stamped with DesignVersion trace)
```

| Package | Responsibility |
|---|---|
| `@lintel/types` | Domain model (PRD §9–§22): products, recipes, standards, design objects, components, hardware contract, BOM, BOQ, validation, trace |
| `@lintel/rules-engine` | Safe formula parser/evaluator (PRD §15), formula sets, data-driven rules, validation aggregation |
| `@lintel/geometry-engine` | Pure panel placement / edge / grain / transform maths (no Three.js) |
| `@lintel/catalog-engine` | Versioned catalog data: `KIT_BASE_STANDARD`, `KITCHEN_BASE_STANDARD_V1`, materials, finishes, edge bands, standards; catalog validation |
| `@lintel/hettich-engine` | First manufacturer adapter: article schema, compatibility engine, calculation rules |
| `@lintel/design-engine` | Pipeline orchestration: `resolveCabinet`, production guard, model fingerprint |
| `@lintel/bom-engine` | Physical bill of materials (quantities only) |
| `@lintel/boq-engine` | Commercial bill of quantities, linked to the BOM |

Other PRD §8 folders (`apps/*`, `services/*`, `database/*`, `packages/{ui,pricing,drawing,manufacturing}-engine`)
exist as documented placeholders.

**Nothing is invented:** Lintel's construction standard and the official Hettich dataset are empty in M1,
so the production configuration reports exactly which values are missing and blocks approval. A clearly
labelled TEST_FIXTURE configuration exercises the full pipeline in tests. See ADR-0004 / ADR-0005 and
[`docs/catalog/KIT_BASE_STANDARD.md`](docs/catalog/KIT_BASE_STANDARD.md).

## Development

```sh
pnpm install
pnpm check   # typecheck + lint + tests
```

See [`docs/development/README.md`](docs/development/README.md).
