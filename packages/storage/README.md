# @lintel/storage

The `FileStorageProvider` abstraction (M5 §12, requirement G) with two providers:

- `MemoryStorageProvider`, for tests;
- `LocalFsStorageProvider`, for development.

`FileService` adds SHA-256 checksums before upload, verification on every read, and a refusal to delete files that a snapshot or an issued output still references.

- Objects are immutable. Identical re-uploads are idempotent; different content under an existing key is refused.
- Signed URLs are short-lived (at most 3600 s) and HMAC-protected.
- The domain stores only keys and checksums, never URLs.
- The Supabase Storage and S3-compatible adapters are implemented in the API's infrastructure layer (step 4). This package imports no cloud SDK (enforced by ESLint).
