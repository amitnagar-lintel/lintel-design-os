# ADR-0002 — Legacy SQL parametric catalog is frozen; TypeScript engines are authoritative

Status: **Accepted** (2026-09-26)

## Context
The live Supabase database (ops) contains a SQL parametric catalog created by the
`modular_catalog_phase1–4`, `cat01`, `tier01` migrations: `skus`, `sku_components`, `part_templates`,
`catalog_rules`, `boq_module_items`, `panels`, `price_lists`, `sku_prices`, `tier_recipes`, functions
`catalog_eval_formula` / `generate_module_boq`, edge functions `module-configurator`, `panel-labels`.
Its SQL is recorded (documentation only) in `lintel-os-ops/migrations/recovered/`.

## Decision
- The SQL catalog is **legacy / reference only**. No new parametric business logic is added to it.
  It is not deleted or broken.
- The TypeScript engines in this repository are the single source of truth for parametric logic.
- Good concepts are ported, not copied:

| Legacy concept | Ported to |
|---|---|
| `part_templates` formulas over `w,d,h,t` | `ConstructionRecipe.components[]` expressions (`@lintel/catalog-engine`) evaluated by `@lintel/rules-engine` |
| `edge_bands` per side (`front`, `left`, …) | `EdgeSide` per installed orientation + `ConstructionStandard.edgeRuleSets` |
| `material_role` | `MaterialRole` → `ConstructionRecipe.materialRoles` |
| `catalog_rules` (condition + qty formula) | `RuleDefinition` (`when` / `assert`) and manufacturer calculation rules |
| `panels` ← module items | `CabinetComponent` with deterministic ids and `sourceObjectId` |

## Known legacy defects not carried over
- Formula grammar lacked MIN/MAX/ROUND/CEIL/FLOOR/ABS/IF/AND/OR/CLAMP.
- Magic numbers in recipes (`d - 20`, `300`) → named construction variables here.
- Door template used `material_role = carcass` → separate `FRONT` role here.
- Fixed hardware counts (`qty_formula: "2"`) → manufacturer calculation rules here.
- Panels written straight into BOQ lines → separate BOM and BOQ engines here.
