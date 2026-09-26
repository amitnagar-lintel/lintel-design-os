import { ChecksumMismatchError, ObjectExistsError, ObjectNotFoundError } from "./errors.js";
import { assertValidStorageKey, sha256Of, UrlSigner } from "./keys.js";
import type { FileStorageProvider, Sha256, SignedUrl, SignedUrlOptions, StorageKey, StoredObjectMetadata, UploadInput } from "./types.js";

/** In-memory provider for tests and local development. Same immutability and checksum rules as real providers. */
export class MemoryStorageProvider implements FileStorageProvider {
  readonly providerId = "memory";
  private readonly objects = new Map<StorageKey, { bytes: Uint8Array; metadata: StoredObjectMetadata }>();
  private readonly signer: UrlSigner;
  private readonly now: () => Date;

  constructor(options: { readonly now?: () => Date; readonly signingSecret?: string; readonly baseUrl?: string } = {}) {
    this.now = options.now ?? (() => new Date());
    this.signer = new UrlSigner(options.baseUrl ?? "memory://objects", options.signingSecret ?? "memory-provider-signing-secret", this.now);
  }

  upload(input: UploadInput): Promise<StoredObjectMetadata> {
    assertValidStorageKey(input.key);
    const actual = sha256Of(input.bytes);
    if (actual !== input.checksum) return Promise.reject(new ChecksumMismatchError(input.key, input.checksum, actual));
    const existing = this.objects.get(input.key);
    if (existing !== undefined) {
      if (existing.metadata.checksum === actual && existing.metadata.contentType === input.contentType) return Promise.resolve(existing.metadata);
      return Promise.reject(new ObjectExistsError(input.key));
    }
    const metadata: StoredObjectMetadata = { key: input.key, contentType: input.contentType, byteSize: input.bytes.byteLength, checksum: actual, createdAt: this.now().toISOString() };
    this.objects.set(input.key, { bytes: new Uint8Array(input.bytes), metadata });
    return Promise.resolve(metadata);
  }

  download(key: StorageKey): Promise<{ bytes: Uint8Array; metadata: StoredObjectMetadata }> {
    const o = this.objects.get(key);
    if (o === undefined) return Promise.reject(new ObjectNotFoundError(key));
    const actual = sha256Of(o.bytes);
    if (actual !== o.metadata.checksum) return Promise.reject(new ChecksumMismatchError(key, o.metadata.checksum, actual));
    return Promise.resolve({ bytes: new Uint8Array(o.bytes), metadata: o.metadata });
  }

  delete(key: StorageKey): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }

  signedUrl(key: StorageKey, options: SignedUrlOptions): Promise<SignedUrl> {
    if (!this.objects.has(key)) return Promise.reject(new ObjectNotFoundError(key));
    try {
      return Promise.resolve(this.signer.sign(key, options.expiresInSeconds, options.disposition));
    } catch (e) {
      return Promise.reject(e instanceof Error ? e : new Error(String(e)));
    }
  }

  /** Resolve a URL issued by `signedUrl` (what an HTTP handler would do). */
  verifySignedUrl(url: string): StorageKey {
    return this.signer.verify(url);
  }

  metadata(key: StorageKey): Promise<StoredObjectMetadata | null> {
    return Promise.resolve(this.objects.get(key)?.metadata ?? null);
  }

  checksum(key: StorageKey): Promise<Sha256> {
    const o = this.objects.get(key);
    if (o === undefined) return Promise.reject(new ObjectNotFoundError(key));
    return Promise.resolve(sha256Of(o.bytes));
  }

  /** Test hook: simulate storage corruption. */
  corruptForTest(key: StorageKey): void {
    const o = this.objects.get(key);
    if (o !== undefined && o.bytes.length > 0) o.bytes[0] = (o.bytes[0] ?? 0) ^ 0xff;
  }
}
