/**
 * @lintel/storage — FileStorageProvider abstraction (M5 step 2, requirement G).
 * Interface + in-memory and local-filesystem providers. Supabase Storage and S3 adapters
 * live in the API's infrastructure layer (step 4); no cloud SDK is imported here.
 */
export type { ContentDisposition, FileStorageProvider, Sha256, SignedUrl, SignedUrlOptions, StorageKey, StoredObjectMetadata, UploadInput } from "./types.js";
export { MAX_SIGNED_URL_SECONDS } from "./types.js";
export { ChecksumMismatchError, FileReferencedError, InvalidStorageKeyError, ObjectExistsError, ObjectNotFoundError, SignedUrlError, StorageError } from "./errors.js";
export type { StoredFileKind } from "./keys.js";
export { assertValidStorageKey, buildStorageKey, sha256Of, UrlSigner } from "./keys.js";
export { MemoryStorageProvider } from "./memory.js";
export { LocalFsStorageProvider } from "./local-fs.js";
export { FileService } from "./file-service.js";
