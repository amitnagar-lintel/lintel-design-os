import { ChecksumMismatchError, FileReferencedError } from "./errors.js";
import { sha256Of } from "./keys.js";
import type { ContentDisposition, FileStorageProvider, Sha256, SignedUrl, StorageKey, StoredObjectMetadata } from "./types.js";

/**
 * Application-level file handling over any FileStorageProvider (M5 §12):
 * checksum computed before upload, verified on every read, and deletion refused
 * while a snapshot or issued output still references the file.
 */
export class FileService {
  constructor(
    private readonly provider: FileStorageProvider,
    /** Answers "does any snapshot / issued output reference this key?" (a repository query in step 4). */
    private readonly isReferenced: (key: StorageKey) => Promise<boolean>,
  ) {}

  get providerId(): string {
    return this.provider.providerId;
  }

  async store(key: StorageKey, bytes: Uint8Array, contentType: string): Promise<StoredObjectMetadata> {
    const checksum = sha256Of(bytes);
    const stored = await this.provider.upload({ key, bytes, contentType, checksum });
    if (stored.checksum !== checksum) throw new ChecksumMismatchError(key, checksum, stored.checksum);
    return stored;
  }

  /** Download and verify against the checksum recorded in the database (not only the provider's metadata). */
  async retrieve(key: StorageKey, expected: Sha256): Promise<Uint8Array> {
    const { bytes } = await this.provider.download(key);
    const actual = sha256Of(bytes);
    if (actual !== expected) throw new ChecksumMismatchError(key, expected, actual);
    return bytes;
  }

  signedUrl(key: StorageKey, expiresInSeconds: number, disposition: ContentDisposition): Promise<SignedUrl> {
    return this.provider.signedUrl(key, { expiresInSeconds, disposition });
  }

  /** Only orphaned files may be deleted; referenced files are immutable evidence. */
  async deleteUnreferenced(key: StorageKey): Promise<void> {
    if (await this.isReferenced(key)) throw new FileReferencedError(key);
    await this.provider.delete(key);
  }
}
