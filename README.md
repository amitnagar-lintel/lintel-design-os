# Lintel Design OS

Design-to-execution platform for interior design and modular manufacturing.
**The intelligent project model is the single source of truth** — BOM, BOQ, price, drawings and
manufacturing data are all derived from the same parametric model.

- Product & technical requirements: [`docs/PRD/LINTEL_DESIGN_OS_MASTER_PRD_v1.md`](docs/PRD/LINTEL_DESIGN_OS_MASTER_PRD_v1.md)
- Engineering rules for Claude Code: [`CLAUDE.md`](CLAUDE.md)
- Architecture decisions: [`docs/architecture/`](docs/architecture/)

## Status — M1 (parametric cabinet engine) + M2 (pricing engine)

`KIT_BASE_STANDARD` runs end-to-end as pure TypeScript (no UI, no database):

```text
DesignObject ─► parameter resolver ─► formula engine ─► construction rules
     ─► component generator ─► geometry metadata ─► Hettich adapter (hardware)
     ─► validation ─► BOM ─► BOQ ─► pricing ─► immutable PriceSnapshot
                                        (all stamped with DesignVersion trace)
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
| `@lintel/pricing-engine` | Exact (paise) pricing from versioned rate cards and rules → immutable, hash-sealed `PriceSnapshot` |

Other PRD §8 folders (`apps/*`, `services/*`, `database/*`, `packages/{ui,drawing-engine,manufacturing-engine}`)
exist as documented placeholders.

**Nothing is invented:** Lintel's construction standard, the PRODUCTION Hettich dataset and the production
rate card / pricing rules are all empty (`NULL / UNVERIFIED`). The production configuration reports exactly
which values are missing, blocks approval and returns production pricing as `UNAVAILABLE`. A clearly
labelled TEST_FIXTURE configuration exercises the full pipeline in tests and can never reach production
(ADR-0004, ADR-0005, ADR-0006).

- What Lintel must supply: [`docs/catalog/KIT_BASE_STANDARD_DATA_REQUIRED.md`](docs/catalog/KIT_BASE_STANDARD_DATA_REQUIRED.md)
- Intake templates: [`docs/catalog/production-data/`](docs/catalog/production-data/)

## Development

```sh
pnpm install
pnpm check   # typecheck + lint + tests
```

See [`docs/development/README.md`](docs/development/README.md).
