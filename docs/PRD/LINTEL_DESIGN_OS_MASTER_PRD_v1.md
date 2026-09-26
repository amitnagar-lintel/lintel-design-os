# LINTEL DESIGN OS
## Master Product & Technical Requirements Document
### Version 1.0

**Owner:** Lintel Space Atelier  
**Product:** Lintel Design OS  
**Primary use:** Source-of-truth specification for Claude / Claude Code / VS Code implementation  
**Initial milestone:** Parametric Kitchen Cabinet Vertical Slice  
**Internal unit:** millimetres (mm)  
**Currency:** INR  

---

# 1. Product Vision

Lintel Design OS is a design-to-execution platform for interior design and modular manufacturing.

The core principle is:

> The intelligent project model is the single source of truth.

A designer should not separately create a 3D model, BOQ, BOM, price, execution drawing and manufacturing list. Those outputs must be derived from the same parametric model.

```text
Project
  ↓
Site / Room
  ↓
2D + 3D Intelligent Model
  ↓
Parametric Construction Rules
  ↓
┌──────────────┬─────────────┬──────────────┐
│              │             │              │
BOQ            BOM          Pricing       Drawings
│              │             │              │
└──────────────┴─────────────┴──────────────┘
                    ↓
              Manufacturing
                    ↓
                  Site
                    ↓
                Handover
```

---

# 2. Product Scope

Lintel Design OS will ultimately cover:

1. CRM / Leads
2. Project management
3. Site measurement
4. 2D floor planning
5. 3D interior design
6. Parametric furniture
7. Manufacturer / hardware intelligence
8. BOQ / BOM
9. Pricing / quotation
10. Execution drawings
11. Procurement
12. Manufacturing / MES
13. Site execution
14. Snagging / QC
15. Client approvals
16. Handover / warranty
17. AI assistants

The first build must NOT attempt all of these at once.

---

# 3. V1 Objective

Build one complete, production-oriented vertical slice:

```text
CREATE PROJECT
      ↓
CREATE ROOM
      ↓
DEFINE ROOM DIMENSIONS
      ↓
PLACE PARAMETRIC BASE CABINET
      ↓
EDIT CABINET PARAMETERS
      ↓
GENERATE 3D GEOMETRY
      ↓
RESOLVE HETTICH HARDWARE
      ↓
GENERATE COMPONENTS
      ↓
GENERATE BOM
      ↓
GENERATE BOQ
      ↓
CALCULATE PRICE
      ↓
GENERATE EXECUTION ELEVATION
      ↓
EXPORT PDF
```

The first product family is:

`KIT_BASE_STANDARD`

Do not build the whole interior CAD application before this vertical slice works.

---

# 4. Product Architecture

```text
                         LINTEL DESIGN OS
                                │
       ┌────────────────────────┼─────────────────────────┐
       │                        │                         │
   DESIGN STUDIO          PRODUCT INTELLIGENCE       PROJECT OS
       │                        │                         │
 ┌─────┼─────┐           ┌──────┼──────┐          ┌──────┼──────┐
 │     │     │           │      │      │          │      │      │
 2D    3D   BIM       Materials Hardware Hettich  CRM   Tasks  Site
 │     │     │           │      │      │          │      │      │
 └─────┼─────┘           └──────┼──────┘          └──────┼──────┘
       │                        │                         │
       └────────────────────────┼─────────────────────────┘
                                │
                        INTELLIGENT MODEL
                                │
                  ┌─────────────┼─────────────┐
                  │             │             │
                 BOQ           BOM          PRICE
                  │             │             │
                  └─────────────┼─────────────┘
                                │
                         DRAWING ENGINE
                                │
                       MANUFACTURING ENGINE
                                │
                            SITE ENGINE
```

---

# 5. Source-of-Truth Hierarchy

The system must follow this hierarchy:

```text
Product Definition
      ↓
Construction Recipe
      ↓
Rules + Formulas
      ↓
Design Object
      ↓
Resolved Components
      ↓
BOM / BOQ
      ↓
Price / Drawings / Manufacturing
```

Derived artifacts must never become independent sources of truth.

---

# 6. Core Design Principles

1. Deterministic calculations.
2. Parametric objects, not dumb meshes.
3. Business rules separate from UI.
4. Geometry engine separate from React.
5. Manufacturer data separate from product construction logic.
6. BOQ and BOM remain distinct.
7. Approved versions are immutable.
8. Catalogs and rules are versioned.
9. Every derived artifact is traceable to a DesignVersion.
10. No hidden magic numbers in UI code.
11. No production output from unapproved design versions.
12. AI may suggest; deterministic engines decide construction truth.

---

# 7. Recommended Technology Stack

## Frontend

- Next.js
- React
- TypeScript
- Tailwind CSS
- Three.js

## Backend

- Node.js
- TypeScript
- NestJS or equivalent modular TypeScript API

## Database

- PostgreSQL
- JSONB for flexible parameter payloads where appropriate

## Background Jobs

- Redis
- BullMQ or equivalent

## File Storage

- S3-compatible object storage

## Geometry

Initial:

- Custom parametric geometry engine
- Three.js visualization

Future / where required:

- Open CASCADE / equivalent CAD kernel

## Testing

- Unit tests
- Integration tests
- End-to-end tests
- Golden fixtures
- Visual regression where appropriate

---

# 8. Repository Structure

Use a monorepo:

```text
lintel-design-os/
│
├── apps/
│   ├── web/
│   ├── admin/
│   ├── mobile/
│   └── client-portal/
│
├── packages/
│   ├── ui/
│   ├── types/
│   ├── geometry-engine/
│   ├── design-engine/
│   ├── catalog-engine/
│   ├── rules-engine/
│   ├── hettich-engine/
│   ├── boq-engine/
│   ├── bom-engine/
│   ├── pricing-engine/
│   ├── drawing-engine/
│   └── manufacturing-engine/
│
├── services/
│   ├── api/
│   ├── drawing-worker/
│   ├── rendering-worker/
│   ├── optimization-worker/
│   └── cnc-worker/
│
├── database/
│   ├── schema/
│   ├── migrations/
│   └── seed/
│
├── docs/
│   ├── PRD/
│   ├── architecture/
│   ├── catalog/
│   ├── rules/
│   └── development/
│
└── infrastructure/
```

Claude must preserve this separation unless there is a documented architecture change.

---

# 9. Core Domain Entities

Minimum core entities:

```text
Organization
User
Role
Permission

Client
Lead
Property
Project
Room

Design
DesignVersion
DesignObject

Product
ProductCategory
ProductVariant
ConstructionRecipe
Formula
Rule

Material
Finish
Hardware

BOQ
BOQItem
BOM
BOMItem
PricingRule
PriceSnapshot

Drawing
DrawingView
DrawingRevision

Vendor
PurchaseRequest
PurchaseOrder
GoodsReceipt

WorkOrder
Panel
CutList
BoardLayout

SiteTask
Inspection
Snag
Approval
Document
AuditLog
Job
```

---

# 10. Project Model

```json
{
  "id": "project_001",
  "projectCode": "LSA-BLR-2026-0001",
  "name": "Demo Residence",
  "clientId": "client_001",
  "propertyId": "property_001",
  "status": "DESIGN",
  "unitSystem": "MM",
  "currency": "INR"
}
```

---

# 11. Room Model

```json
{
  "id": "room_001",
  "projectId": "project_001",
  "name": "Kitchen",
  "type": "KITCHEN",
  "length": 4200,
  "width": 3200,
  "height": 3000,
  "wallThickness": 150
}
```

All internal geometry is in millimetres.

---

# 12. Intelligent Design Object

Every intelligent product is an object, not a mesh.

Example:

```json
{
  "objectId": "obj_001",
  "projectId": "project_001",
  "roomId": "room_001",
  "objectType": "BASE_CABINET",
  "productId": "KIT_BASE_STANDARD",

  "transform": {
    "x": 1200,
    "y": 0,
    "z": 0,
    "rotationX": 0,
    "rotationY": 0,
    "rotationZ": 0
  },

  "dimensions": {
    "width": 600,
    "height": 720,
    "depth": 560
  },

  "parameters": {
    "carcassThickness": 18,
    "backThickness": 6,
    "shelfCount": 1,
    "shutterCount": 2,
    "frontType": "OVERLAY",
    "material": "BOARD_BWP_18",
    "finish": "LAMINATE_WHITE"
  },

  "status": "DRAFT"
}
```

---

# 13. Parametric Product Architecture

A product consists of:

```text
Product Definition
├── Metadata
├── Defaults
├── Constraints
├── Parameters
├── Construction Recipe
├── Formulas
├── Rules
├── Components
├── Hardware Rules
├── BOM Recipe
├── BOQ Recipe
├── Drawing Templates
└── Manufacturing Rules
```

---

# 14. Construction Recipe

Example:

```json
{
  "recipeId": "KITCHEN_BASE_STANDARD_V1",
  "productType": "KITCHEN_BASE",

  "components": [
    "SIDE_LEFT",
    "SIDE_RIGHT",
    "BOTTOM",
    "TOP_SUPPORT_FRONT",
    "TOP_SUPPORT_BACK",
    "BACK",
    "SHELF",
    "SHUTTER"
  ],

  "frontRules": "FRONT_STANDARD",
  "hardwareRules": "HINGE_STANDARD",
  "edgeRules": "CARCASS_STANDARD"
}
```

---

# 15. Formula Engine

Must support:

- +
- -
- *
- /
- MIN
- MAX
- ROUND
- CEIL
- FLOOR
- ABS
- IF
- AND
- OR
- CLAMP

Formulas must be data-driven.

Example:

```json
{
  "formulaId": "INTERNAL_WIDTH",
  "expression": "W - (2*T)",
  "variables": ["W", "T"],
  "unit": "MM"
}
```

Never place business formulas as magic-number arithmetic inside React components.

---

# 16. Component Model

Initial component types:

```text
SIDE_LEFT
SIDE_RIGHT
TOP
BOTTOM
TOP_SUPPORT_FRONT
TOP_SUPPORT_BACK
BACK
SHELF
PARTITION
SHUTTER
DRAWER_FRONT
DRAWER_BOX_SIDE
DRAWER_BOX_FRONT
DRAWER_BOX_BACK
DRAWER_BOTTOM
PLINTH
FILLER
END_PANEL
KICKBOARD
```

Each component must contain:

```text
componentId
sourceObjectId
componentType
dimensions
materialId
finishId
edges
grainDirection
drilling
hardwareLinks
quantity
manufacturingData
```

---

# 17. Traceability

Every output must be traceable:

```text
Project
 ↓
DesignVersion
 ↓
DesignObject
 ↓
Component
 ↓
BOMItem
 ↓
ManufacturingPanel
 ↓
Drawing
 ↓
SiteTask
```

Example component IDs should be deterministic and human-readable where useful:

```text
OBJ-KIT-001-SL
OBJ-KIT-001-SR
OBJ-KIT-001-BOT
OBJ-KIT-001-SHF-01
OBJ-KIT-001-SHT-L
OBJ-KIT-001-SHT-R
```

---

# 18. Validation Engine

Severity levels:

```text
INFO
WARNING
ERROR
BLOCKER
```

Examples:

- width below allowed minimum
- cabinet intersects wall/column
- missing material
- missing hardware
- incompatible drawer runner
- shutter exceeds configured limit
- insufficient service clearance
- invalid drilling configuration

BLOCKER conditions prevent approval/manufacturing.

---

# 19. Material Model

Separate substrate from finish.

Example:

```json
{
  "materialId": "BOARD_BWP_18",
  "category": "BOARD",
  "thickness": 18,
  "sheetSize": {
    "width": 1220,
    "height": 2440
  },
  "grain": true
}
```

Finish example:

```json
{
  "finishId": "LAMINATE_WHITE",
  "type": "LAMINATE",
  "thickness": 1
}
```

Do not collapse board + laminate + edge band into one generic material.

---

# 20. Edge-Banding Engine

Edges are component-level data:

```json
{
  "left": {"required": true, "thickness": 2},
  "right": {"required": true, "thickness": 2},
  "top": {"required": true, "thickness": 2},
  "bottom": {"required": false}
}
```

Edge logic comes from construction recipes.

---

# 21. Grain Direction

Allowed values:

```text
HEIGHT
WIDTH
DEPTH
NONE
```

Grain direction affects:

- nesting
- board optimization
- manufacturing
- drawings
- visual representation

---

# 22. BOM vs BOQ

BOM = what is physically required to make the product.

BOQ = what is commercially measured and quoted.

Example BOM:

```text
18mm BWP panel
18mm HDHMR shutter
Hettich hinge
ABS edge band
Screws
```

Commercial BOQ may show:

```text
600 Base Cabinet × 1
```

The BOQ and BOM must remain separate but linked.

---

# 23. Pricing Engine

Pricing must be derived from snapshots and rules:

```text
Material
+ Finish
+ Hardware
+ Manufacturing
+ Transport
+ Installation
+ Wastage
+ Overhead
+ Margin
= Selling Price
```

A quotation must retain the exact pricing-rule snapshot used to generate it.

Old approved quotations must never change because current rates changed.

---

# 24. Hettich Integration

Hettich is the first manufacturer integration, not the architectural core.

The architecture must support future manufacturers such as:

```text
Hettich
Blum
Grass
Hafele
Kessebohmer
```

Hettich-specific data must live under a manufacturer adapter/data model.

---

# 25. Hettich Data Model

```text
hettich_articles
hettich_article_variants
hettich_product_families
hettich_cad_assets
hettich_drilling_patterns
hettich_installation_guides
hettich_technical_rules
hettich_calculation_rules
hettich_compatibility
hettich_accessories
hettich_source_versions
hettich_asset_licenses
```

Article record should support:

```text
manufacturer
articleNumber
family
series
category
application
dimensions
openingAngle
thicknessRanges
drilling
adjustment
installation
compatibility
accessories
cadAssets
technicalAssets
sourceUrl
sourceVersion
retrievedAt
licenseStatus
```

The public/authorized Hettich sources used for the initial pilot are:

- Hettich eShop
- Hettich CAD
- Hettich Technical Assistant
- Hettich downloads/media library
- Hettich Plan documentation

Do not assume rights to redistribute Hettich CAD binaries. Track source/license metadata and use official/authorized data for production.

---

# 26. Hettich Fitting Situation

Do not ask users to select a generic fitting first.

Create a fitting situation from construction context:

```text
cabinet type
component type
door type
door width
door height
door thickness
door material
front style
overlay/inset
opening angle
available depth
load
```

Then:

```text
Fitting Situation
 ↓
Compatibility Engine
 ↓
Valid Hettich Articles
 ↓
Suggested Article
 ↓
Drilling + Installation
 ↓
BOM
```

---

# 27. Hettich Hinge Logic

Do not hard-code a simple hinge-count table.

The engine should support manufacturer engineering inputs such as:

- door width
- door height
- door thickness
- door material/density
- door weight
- hinge family
- mounting type
- opening angle

Then resolve:

- compatible article
- quantity
- mounting plate
- drilling pattern
- hinge positions

Where manufacturer rules are available, treat them as the authoritative source.

---

# 28. Hettich Drawer Logic

For systems such as AvanTech YOU, model:

```text
system height
nominal length
cabinet width
drawer/front height
front thickness
front material
load
runner/load class
Push-to-open compatibility
```

Resolve:

- drawer components
- runners
- accessories
- drilling
- BOM

Do not make generic assumptions where Hettich provides actual configuration rules.

---

# 29. Hettich CAD Asset Registry

Each article may have:

```text
2D CAD
3D CAD
DWG
DXF
section drawing
assembly geometry
drilling data
installation document
technical document
```

Store references and permitted local/cache copies only where licensing permits.

---

# 30. 2D Editor V1

Required tools:

```text
SELECT
MOVE
ROTATE
DELETE
WALL
DOOR
WINDOW
COLUMN
CABINET
DIMENSION
TEXT
MEASURE
```

Snapping:

- endpoint
- midpoint
- object edge
- grid
- perpendicular
- parallel
- wall

The 2D editor is a view/controller for the intelligent model, not the model itself.

---

# 31. 3D Editor V1

Required:

- orbit
- pan
- zoom
- top/front/side views
- perspective/orthographic
- select object
- move
- rotate
- duplicate
- delete
- properties
- material preview

Three.js is the initial visualization layer.

Do not put business calculations inside the Three.js scene code.

---

# 32. Object Properties Panel

Minimum properties:

```text
Width
Height
Depth
Material
Finish
Front type
Shutter count
Shelf count
Hardware
```

Changing a property must update the parametric object and all affected derived data.

---

# 33. Drawing Engine V1

Initial drawing types:

```text
Front Elevation
Internal Elevation
Side Section
Panel Schedule
```

Drawing source:

```text
DesignVersion + Resolved Model
```

Never draw from a separately maintained 2D copy.

---

# 34. Drawing Metadata

Every drawing:

```text
Project ID
Room
Drawing Number
Drawing Title
Revision
Date
Designer
Checker
Scale
Approval Status
Source DesignVersion
```

---

# 35. Version Control

Design states:

```text
DRAFT
IN_REVIEW
CHANGES_REQUIRED
APPROVED
LOCKED
SUPERSEDED
```

Approved/locked versions are immutable.

Any change creates a new version.

BOQ/BOM/Pricing/Drawings must store the source DesignVersion and relevant catalog/rules versions.

---

# 36. API Principles

Base path:

`/api/v1`

Minimum resource groups:

```text
/projects
/rooms
/designs
/design-versions
/objects
/products
/materials
/finishes
/hardware
/boq
/bom
/pricing
/drawings
/hettich
```

Use request validation and object-level authorization.

---

# 37. Background Jobs

Use jobs for:

- BOM generation for large projects
- BOQ generation
- drawing generation
- PDF export
- rendering
- board optimization
- large imports
- CAD conversion

Job structure:

```text
jobId
projectId
type
status
attempt
startedAt
completedAt
error
```

---

# 38. Audit Logging

Log all critical changes:

- design changes
- approvals
- version locks
- pricing changes
- catalog changes
- rule changes
- manufacturing releases
- procurement approvals

Audit record:

```text
who
what
when
oldValue
newValue
reason
```

---

# 39. Security

Implement:

- authentication
- RBAC
- organization tenancy
- object authorization
- audit logs
- signed asset URLs
- input validation
- rate limiting

Never trust organization/project IDs supplied by clients without authorization checks.

---

# 40. Multi-Tenant Architecture

Organization is the top-level business boundary.

```text
Organization
├── Users
├── Projects
├── Catalog
├── Pricing
└── Vendors
```

Future support:

```text
Corporate
 ├── Branch
 ├── Branch
 └── Franchise
```

---

# 41. V1 Product Family

Only implement:

`KIT_BASE_STANDARD`

Initial parameters:

```text
width
height
depth
carcassThickness
backThickness
shelfCount
shutterCount
frontType
material
finish
hinge configuration
```

Do not implement wardrobes before the base cabinet engine is proven.

---

# 42. V1 Reference Cabinet

Use this deterministic reference case:

```text
Width: 600 mm
Height: 720 mm
Depth: 560 mm
Carcass: 18 mm
Back: 6 mm
Shelves: 1
Shutters: 2
Front: Overlay
Finish: configurable laminate
Hardware: valid Hettich Sensys configuration
```

The exact Hettich article and drilling data must be resolved through the Hettich catalog engine, not hard-coded from memory.

---

# 43. V1 Modification Tests

### Test A

600 × 720 × 560, two shutters.

### Test B

Change width 600 → 750.

Expected:

- geometry updates
- panel dimensions update
- shutter widths update
- BOM updates
- BOQ updates
- price updates
- drawing becomes stale and can be regenerated

### Test C

Change two shutters → one.

Expected:

- one shutter removed
- shutter width changes
- hinge quantity recalculates
- BOM/BOQ update
- drawing updates

### Test D

Change overlay → inset.

Expected:

- front geometry changes
- Hettich compatibility reruns
- drilling changes if required
- BOM updates
- drawing updates

### Test E

Change material.

Expected:

- geometry stays unless thickness differs
- material quantities/costs update
- BOM changes
- manufacturing metadata changes

---

# 44. Golden Tests

Create a golden JSON fixture for the 600 × 720 × 560 reference cabinet.

Repeated execution with identical inputs must produce equivalent output.

Golden tests must cover:

- components
- dimensions
- materials
- hardware requirements
- BOM
- BOQ
- validation

---

# 45. Definition of Done for V1

V1 is not complete until this exact workflow works:

```text
Create Project
 ↓
Create Kitchen Room
 ↓
Enter dimensions
 ↓
Place Base Cabinet
 ↓
Edit dimensions
 ↓
Select material/finish
 ↓
Resolve compatible Hettich hardware
 ↓
Generate component breakdown
 ↓
Generate BOM
 ↓
Generate BOQ
 ↓
Calculate price
 ↓
Generate execution elevation
 ↓
Export PDF
```

All outputs must trace back to the same DesignVersion.

---

# 46. Development Phases

## Phase 0 — Foundation

- repository
- TypeScript
- database
- authentication
- organizations
- users
- RBAC
- project model
- CI/CD

## Phase 1 — Domain Engine

- types
- formula engine
- parameter resolver
- validation engine
- construction rules
- component generator

## Phase 2 — Hettich Engine

- article schema
- asset registry
- compatibility engine
- fitting situation
- drilling model
- calculation rule model

## Phase 3 — Base Cabinet

- KIT_BASE_STANDARD recipe
- geometry generator
- hardware resolution
- BOM
- BOQ

## Phase 4 — 2D/3D

- room editor
- 2D placement
- Three.js viewer
- object properties
- transform controls

## Phase 5 — Drawings

- elevation
- section
- dimensions
- PDF

## Phase 6 — Pricing

- pricing rules
- price snapshots
- quotation

## Phase 7 — Production

- panels
- cutlists
- board optimization
- CNC
- labels

## Phase 8 — Site

- tasks
- installation
- QC
- snagging
- handover

## Phase 9 — AI

- design assistant
- BOQ assistant
- drawing checker
- procurement assistant
- site assistant

---

# 47. First 30 Engineering Tasks

1. Create monorepo.
2. Configure TypeScript strict mode.
3. Configure Next.js app.
4. Configure backend API.
5. Configure PostgreSQL.
6. Configure migrations.
7. Authentication scaffolding.
8. Organization/RBAC.
9. Client/Project/Room models.
10. DesignVersion model.
11. DesignObject model.
12. Product/Material/Finish/Hardware types.
13. Formula engine.
14. Parameter resolver.
15. Validation engine.
16. Construction recipe registry.
17. Component generator.
18. Geometry generator.
19. Hettich article schema.
20. Hettich asset registry.
21. Hettich compatibility engine.
22. KIT_BASE_STANDARD recipe.
23. Hardware resolution for reference cabinet.
24. BOM generator.
25. BOQ generator.
26. Pricing engine.
27. Drawing projection engine.
28. PDF export.
29. Golden test suite.
30. End-to-end vertical slice.

---

# 48. Rules for Claude / Claude Code

Claude must:

1. Read this PRD before changing architecture.
2. Inspect the repository before making changes.
3. Reuse existing code before creating duplicate abstractions.
4. Make small, reviewable changes.
5. Run tests after implementation.
6. Run TypeScript checks.
7. Run lint.
8. Explain assumptions.
9. Never silently modify unrelated modules.
10. Never invent manufacturer technical specifications.
11. Never hard-code commercial pricing into geometry code.
12. Never hard-code Hettich compatibility when official/authorized data exists.
13. Never make AI-generated dimensions authoritative.
14. Preserve versioning and auditability.
15. Do not proceed to a later phase if the current phase's acceptance tests fail.

---

# 49. Claude Task Format

Every implementation task should follow this structure:

```text
TASK

OBJECTIVE

CONTEXT

FILES TO INSPECT

REQUIREMENTS

NON-GOALS

ACCEPTANCE CRITERIA

TESTS

IMPLEMENTATION

REPORT
```

After implementation Claude must report:

- files created
- files modified
- tests run
- tests passed/failed
- assumptions
- remaining issues

---

# 50. First Claude Code Task

Use this prompt after the repository is initialized:

```text
Read /docs/PRD/LINTEL_DESIGN_OS_MASTER_PRD_v1.md before making changes.

You are acting as the senior engineer implementing Lintel Design OS.

First inspect the repository and existing architecture. Do not modify code yet.

Return:

1. current repository structure
2. architecture gaps against the PRD
3. dependencies already installed
4. database state
5. existing test setup
6. recommended first implementation changes
7. risks or conflicts with the PRD

Do not implement until this inspection is complete.
```

After review, the first implementation task is:

```text
Implement the domain foundation for the Lintel Parametric Cabinet Engine.

Do not build the UI yet.

Implement:

- ProductDefinition
- ProductParameters
- ResolvedParameters
- ConstructionRecipe
- FormulaDefinition
- RuleDefinition
- CabinetComponent
- HardwareRequirement
- ResolvedCabinet
- BOM
- BOQ
- ValidationMessage
- ValidationResult

Implement the formula engine and parameter resolver.

Use strict TypeScript.
Keep domain logic independent of React and Three.js.
Create unit tests and golden fixtures.

Do not implement undocumented construction assumptions.
Where a value is unknown, create a configurable rule rather than inventing a value.

Run type-check, lint and tests before finishing.
```

---

# 51. Strategic Direction

Lintel Design OS is not intended to be merely an interior visualizer.

Its long-term value is the connection:

```text
DESIGN
  ↓
ENGINEERING
  ↓
COMMERCIAL
  ↓
MANUFACTURING
  ↓
EXECUTION
```

The 3D view is the visible interface.

The real IP is the structured construction intelligence beneath it.

The first defensible technical asset is therefore the combination of:

```text
Parametric Product Model
+
Construction Rules
+
Manufacturer Compatibility
+
BOQ/BOM Logic
+
Execution Drawing Logic
```

---

# 52. Immediate Priority

Do not start with:

- AI rendering
- VR
- full AutoCAD replacement
- full ERP
- freeform 3D modelling
- CNC for every machine

Start with:

> One production-grade parametric cabinet that can move from dimensions to Hettich hardware to BOM/BOQ to execution drawing.

Once that vertical slice is stable, expand the same engine horizontally across kitchen, wardrobe, TV units, studies, vanities, crockery, storage and other interior products.

---

# 53. End State

Ultimately:

```text
                    LINTEL DESIGN OS
                           │
                INTELLIGENT PROJECT MODEL
                           │
       ┌───────────────┬───┴───┬────────────────┐
       │               │       │                │
      2D              3D      BIM             Rules
       │               │       │                │
       └───────────────┴───┬───┴────────────────┘
                           │
                    ENGINEERING DATA
                           │
            ┌──────────────┼───────────────┐
            │              │               │
           BOQ            BOM            PRICE
            │              │               │
            └──────────────┼───────────────┘
                           │
                     DRAWINGS / CAD
                           │
                      MANUFACTURING
                           │
                         DELIVERY
                           │
                          SITE
                           │
                       HANDOVER
```

This is the master architecture for Lintel Design OS.
