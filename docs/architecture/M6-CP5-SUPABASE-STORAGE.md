# M6 checkpoint 5 — Supabase Storage adapter (G5)

## What exists

`SupabaseStorageProvider` (`apps/api/src/infrastructure/storage/supabase-storage.ts`) implements the existing `FileStorageProvider` interface. The abstraction, the domain and the schema are unchanged. It talks to the Supabase Storage REST API with `fetch` (no SDK), server-side only.

| Requirement | How |
|---|---|
| Immutable snapshot-linked files | Keys stay content-addressed (`org/…/dv/…/drawing/<sha256>.<ext>`). Uploads never overwrite (`x-upsert: false`). An identical re-upload is idempotent; different content at an existing key is `ObjectExistsError` |
| Checksum verification | The caller's SHA-256 is verified before any request. Every download recomputes it from the bytes, and `FileService.retrieve` compares it with the checksum recorded in the database |
| PDF / SVG storage | The content type is stored with the object and returned on download |
| Signed URLs | Supabase-native, 1–3600 s (the API uses 300 s), `download=` for attachments. They are created per request and never stored. The API's `/file-content` route is refused for this provider |
| No deletion of referenced files | Unchanged: `FileService.deleteUnreferenced` refuses a file still referenced by a snapshot or issue. The adapter only executes allowed deletions |
| Environment-safe configuration | `FILE_STORAGE=supabase` requires `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET` and `SUPABASE_STORAGE_KEY`. These are refused with any other provider. Errors never contain the credential |
| No secrets in browser code | The key lives only in the API process (the host secret store). Browsers receive short-lived signed URLs only |

**Tests** run against a local stand-in of the Storage API:
- immutability and idempotency;
- a checksum refused before sending;
- corruption detected on read;
- signed URLs (inline and attachment, the expiry bound, missing objects);
- deletion rules;
- credential handling;
- configuration.

## Credential decision (needs Amit's approval before hosted use)

Supabase Storage accepts only a project **secret key** (`sb_secret_…`) or a user JWT for server-side access. Its S3 access keys would need an AWS SDK or a SigV4 signer. None of these can be scoped to one bucket.

This adapter therefore needs a secret key in the API's environment (`SUPABASE_STORAGE_KEY`). That relaxes the M6 plan's rule "no secret key in the API" to "one secret key in the API, used **only** for Storage requests; the database is still reached only as `design_os_api`".

**Choices:**
- **(a) Approve this for the pilot.** Keep the key in the host secret store, rotate it after the pilot, and create a separate staging project and key.
- **(b) Require S3 access keys with a SigV4 signer** (a follow-up of about one day).

## What remains (hosted verification boundary, gate M6-7 / M6-8)

1. Create the private bucket `design-os-outputs` on the **staging** project: not public, a 20 MB file-size limit, MIME types `application/pdf` and `image/svg+xml`.
2. Set `FILE_STORAGE=supabase`, `SUPABASE_URL`, `SUPABASE_STORAGE_BUCKET` and `SUPABASE_STORAGE_KEY` in the staging API's secret store.
3. On staging:
   - generate a drawing;
   - confirm the object exists in the bucket;
   - open `GET /api/v1/files/{id}/url` and check that the PDF downloads;
   - re-generate and confirm the call is idempotent.
4. Storage is not covered by database PITR: configure the nightly bucket copy (plan §1.3).
5. The orphan reconciliation report (storage objects with no `file_object` row) is **not** implemented yet. It is a read-only operator report, needed before production (plan §1.3).

Until hosted access is approved, the pilot runs with `FILE_STORAGE=local` (persistent files on the API host).
