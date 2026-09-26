# M6 checkpoint 4 — resolved-model preview API (G3)

## Route

`GET /api/v1/design-versions/{versionId}/model` (internal, authenticated, `reference.read`) returns the resolved model of **exactly** this design version.

It is **read-only**: a READ ONLY, REPEATABLE READ transaction, with nothing persisted (no validation run and no snapshot).

## How it resolves

**Inputs:** `readEngineeringInputs()` is now the single reader shared with output generation. It reads:
- the version row;
- its room-survey revision, objects and override history;
- the **exact pinned** engineering versions (never "latest").

It also refuses when the stored input hash differs from the rows read.

**Resolution:** `engineeringModel()` + `resolveEngineeringModel()` from `modules/outputs/engines/validation.ts`, the same entry BOM, BOQ and drawings use.

**Proof:** a test shows that the `modelFingerprint` equals the `roomFingerprint` of a BOM generated from the same version.

**No second engine:** the API projects the engine result only, adding no geometry or rules of its own. The UI renders this response and never computes design rules.

## Response

**Version and inputs:**
- `designVersion`: id, design, project, number, status, input hash / revision, content hash.
- `pins`: the exact engineering versions.
- `dataClassification` and `testFixtureSources`: TEST_FIXTURE is shown as such, never as production.
- `engine`: the validation engine's version, fingerprint and build.
- `modelFingerprint`.

**Room:** dimensions and walls A–D.

**`objects[]`**, in engine order:
- **Identity:**
  - `objectId` is the object row of this version, for the edit routes.
  - `lineageId` is the stable identity across versions: the engine's object id and the UI's selection key.
- **Product:** `objectCode`, `productCode` and `productVersionId`.
- **Parameters:** resolved `parameters` with `parameterSources` (DEFAULT or OBJECT), plus `dimensions` and `transform`.
- **`placement`:** wall, rotation, room-coordinate envelope, along-wall extent, distance to wall.
- **`components[]`:** id, type, finished dimensions, room-coordinate box, material, finish, finished faces, grain.
- **Validation:** the object's validation counts and its messages.

**Layout:**
- `runs[]`: wall, ordered `lineageIds`, start, end, length.
- `relationships[]`: type, source (derived or override), `lineageIds`, gap, touching.

**`validation`:** counts, `canApprove` (no BLOCKER), and all messages. A message's `lineageId` is null for room-level messages.

**Coordinates** are in millimetres: x along wall A, z into the room, y up.
