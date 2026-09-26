# M5 Step 7 checkpoint 4 — Issue and finalization

Status: implemented (migration 0018, `apps/api/src/modules/outputs/issues.*`). Builds on the output model of
`M5-STEP6-OUTPUT-PLAN.md` (§4.4, §11, §14, §15).

## 1. Endpoints (`/api/v1`)

| Method & path | Action | Body | Responses |
|---|---|---|---|
| `POST /quotation-snapshots/{id}/issue` | `quotation.issue` | `{ reason, expectedContentHash, pricingStandardVersionId, quotationPolicyVersionId }` | 201 issue record · 409 `ISSUE_PRECONDITIONS_FAILED` · 409 `ALREADY_ISSUED` · 404 |
| `GET /quotation-snapshots/{id}/issue` | internal member (RLS) | — | 200 · 404 while not issued |
| `POST /drawing-snapshots/{id}/issue` | `drawing.issue` | `{ reason, expectedContentHash }` | 201 · 409 · 409 · 404 |
| `GET /drawing-snapshots/{id}/issue` | internal member (RLS) | — | 200 · 404 |

- **`Idempotency-Key` is required.** The same key and body replay the original 201. The same key with another body is 409 `IDEMPOTENCY_CONFLICT`.
- **The request declares what it issues:** the content hash, and for quotations the exact PricingStandard and QuotationPolicy versions. The database refuses any mismatch.
- **Every other field of the issue record is derived by the database from the snapshot:** project, design version, revision, drawing number/revision and file manifest. The issue timestamp comes from the database (`now()`).
- **Snapshot envelopes of quotations and drawings carry `issue: { issuedBy, issuedAt, reason } | null`.**

## 2. Issue / lifecycle matrix

| Design version | PRELIMINARY | FOR_REVIEW | FOR_PRODUCTION |
|---|---|---|---|
| DRAFT | ✗ (purpose) | — (cannot exist) | — (cannot exist) |
| IN_REVIEW | ✗ (purpose) | ✗ (purpose) | — (cannot exist) |
| APPROVED | ✗ | ✗ | ✗ `{status: APPROVED}` — LOCK first |
| **LOCKED** | ✗ | ✗ | **✓** |
| SUPERSEDED | ✗ | ✗ | ✗ `{status: SUPERSEDED}`; issues made while LOCKED stay valid |

Beyond the matrix, `design_os.check_issue` requires all of the following, refusing with LD017 / 409 `ISSUE_PRECONDITIONS_FAILED` and `context.problems`:

- **Output:**
  - 0 BLOCKERs in the output;
  - 0 BLOCKERs in its OUTPUT_GENERATION validation evidence;
  - a complete output.
- **Inputs and dependencies:**
  - the snapshot is of the locked content (`design_version_content_hash`) and of the current engineering input hash and revision;
  - every exact dependency's content is unchanged (DB-recomputed dependency hashes);
  - every pinned engineering dependency is APPROVED or LOCKED;
  - for quotations, the exact PricingStandard and QuotationPolicy versions are APPROVED or LOCKED.
- **Access:** the issuer can access the project. Otherwise the answer is 404, and existence is not disclosed.

An older engine fingerprint does not block an issue. The output remains exact, reproducible evidence, and its staleness reports `ENGINE_CHANGED`.

## 3. Locking behaviour

- **The design must already be LOCKED.** Issue never locks a design (APPROVED-but-not-LOCKED is refused). LOCKing a design locks its exact engineering dependency versions (lock cascade, 0008).
- **Issuing a quotation LOCKs its exact PricingStandard and QuotationPolicy versions** in the same transaction (0017 trigger), so its commercial basis can never change.
  - A later approved version may still SUPERSEDE them. The issued quotation stays valid, readable and exact.
  - A new quotation must then be priced with the new version.
- **Issue records are insert-only,** and so are snapshots. UPDATE and DELETE are refused (LD015).

## 4. Permissions

| Action | Who (default roles) |
|---|---|
| Issue quotation | `quotation.issue` (SALES) |
| Issue drawing | `drawing.issue` (DESIGN_HEAD) |
| Read issue record | internal members (RLS); CLIENT members of the project with `output.read.issued` |

The issue insert passes RLS only with the issue action, as the current user (`issued_by = current_user_id()`). `check_issue` also checks project access.

## 5. Audit / decision record

- **The issue row is the decision record.** It holds:
  - project;
  - design version;
  - snapshot;
  - revision (quotation revision number; drawing number + revision);
  - exact content hash;
  - commercial versions (quotation) or sealed file manifest hash (drawing);
  - issuer, database timestamp and reason.
- **The generic audit trigger adds it to the hash-chained `audit_log`** with the actor, reason and request id.
- **Commercial-version LOCKs caused by an issue** are recorded as `approval_decision` LOCK decisions.

## 6. Client visibility rules (no portal yet; enforced now by RLS)

A CLIENT identity:

- **can never use internal routes.** Every output route is INTERNAL (`IDENTITY_KIND_MISMATCH`).
- **reads a snapshot only when it is issued** and belongs to a project the client is a member of (`snapshot_read_issued`). It never sees PRELIMINARY, FOR_REVIEW or unissued FOR_PRODUCTION snapshots, nor BOM, BOQ or Pricing.
- **reads issue records only of its own projects** (0018 tightened `issue_read`).
- **reads files only when they belong to an issued drawing of its project** (`client_can_read_file`). It may request a 300 s signed URL for such a file (`GET /files/{id}/url` is `AnyIdentity`); for any other file it gets 404.

The future portal only has to expose read routes over these rows; no new visibility rule is needed.

## 7. Concurrency and idempotency

- **One issue per snapshot:** primary key plus an explicit LD027 check.
- **One issue per quotation revision per design version:** `quotation_issue_revision_unique`.
- **One issue per drawing number + revision per project:** `drawing_issue_number_revision_unique`.
- **Concurrent requests:** exactly one commits. The others get 409 `ALREADY_ISSUED`, mapped from the unique violations.

## 8. V1 operational limitations (accepted, documented)

- **Orphaned stored files on rollback.**
  - **What happens:** drawing files are written to storage before the database transaction commits. If the transaction rolls back, the objects remain in storage without a `file_object` row.
  - **Why it is accepted for V1:** storage is local / in-memory, keys are content-addressed (`org/…/dv/…/drawing/<sha256>.<ext>`), and a retry reuses the same object.
  - **For the hosted-storage phase:** add a reconciliation (storage keys without `file_object` rows) or a two-phase upload. No background cleanup exists in V1.
