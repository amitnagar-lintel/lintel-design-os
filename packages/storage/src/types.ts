/**
 * File storage abstraction (M5 §12, requirement G). The domain model stores only storage
 * keys and checksums — never provider URLs or SDK objects — so Supabase Storage or any
 * S3-compatible store can be used without changing the domain or schema.
 */

/** Relative, validated object key, e.g. `org/o1/project/p1/dv/dv1/drawing/snap1.pdf`. */
export type StorageKey = string;

/** `sha256:` + 64 lowercase hex characters (same format as `@lintel/persistence`). */
export type Sha256 = `sha256:${string}`;

export type ContentDisposition = "inline" | "attachment";

export interface StoredObjectMetadata {
  readonly key: StorageKey;
  readonly contentType: string;
  readonly byteSize: number;
  readonly checksum: Sha256;
  readonly createdAt: string;
}

export interface UploadInput {
  readonly key: StorageKey;
  readonly bytes: Uint8Array;
  readonly contentType: string;
  /** Computed by the caller before upload; the provider verifies it. */
  readonly checksum: Sha256;
}

export interface SignedUrlOptions {
  /** Short-lived: 1 … 3600 seconds. */
  readonly expiresInSeconds: number;
  readonly disposition: ContentDisposition;
}

export interface SignedUrl {
  readonly url: string;
  readonly expiresAt: string;
}

/**
 * Stored objects are immutable: uploading different content to an existing key is refused;
 * re-uploading identical content is idempotent. Every read verifies the checksum.
 */
export interface FileStorageProvider {
  /** e.g. "memory", "local", "supabase", "s3". */
  readonly providerId: string;
  upload(input: UploadInput): Promise<StoredObjectMetadata>;
  download(key: StorageKey): Promise<{ readonly bytes: Uint8Array; readonly metadata: StoredObjectMetadata }>;
  /** Idempotent. Whether a delete is allowed is decided by the application (see FileService). */
  delete(key: StorageKey): Promise<void>;
  signedUrl(key: StorageKey, options: SignedUrlOptions): Promise<SignedUrl>;
  metadata(key: StorageKey): Promise<StoredObjectMetadata | null>;
  /** Recomputed from the stored bytes, not read from metadata. */
  checksum(key: StorageKey): Promise<Sha256>;
}

export const MAX_SIGNED_URL_SECONDS = 3600;
