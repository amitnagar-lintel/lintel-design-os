import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { ChecksumMismatchError, InvalidStorageKeyError, ObjectExistsError, ObjectNotFoundError } from "./errors.js";
import { assertValidStorageKey, sha256Of, UrlSigner } from "./keys.js";
import type { FileStorageProvider, Sha256, SignedUrl, SignedUrlOptions, StorageKey, StoredObjectMetadata, UploadInput } from "./types.js";

const isNotFound = (e: unknown): boolean => e instanceof Error && (e as NodeJS.ErrnoException).code === "ENOENT";

/**
 * Local-filesystem provider for development only. Objects live under `root/objects/<key>`,
 * metadata in a sidecar `root/meta/<key>.json`. Paths are confined to `root`.
 */
export class LocalFsStorageProvider implements FileStorageProvider {
  readonly providerId = "local";
  private readonly root: string;
  private readonly signer: UrlSigner;
  private readonly now: () => Date;

  constructor(options: { readonly root: string; readonly signingSecret: string; readonly baseUrl?: string; readonly now?: () => Date }) {
    this.root = resolve(options.root);
    const now = options.now ?? (() => new Date());
    this.signer = new UrlSigner(options.baseUrl ?? "local://objects", options.signingSecret, now);
    this.now = now;
  }

  private path(area: "objects" | "meta", key: StorageKey): string {
    assertValidStorageKey(key);
    const base = join(this.root, area);
    const full = resolve(base, area === "meta" ? `${key}.json` : key);
    if (!full.startsWith(base + sep)) throw new InvalidStorageKeyError(key, "escapes the storage root");
    return full;
  }

  private async atomicWrite(path: string, data: Uint8Array | string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, data, { flag: "wx" });
    await rename(tmp, path);
  }

  async upload(input: UploadInput): Promise<StoredObjectMetadata> {
    const objectPath = this.path("objects", input.key);
    const actual = sha256Of(input.bytes);
    if (actual !== input.checksum) throw new ChecksumMismatchError(input.key, input.checksum, actual);
    const existing = await this.metadata(input.key);
    if (existing !== null) {
      if (existing.checksum === actual && existing.contentType === input.contentType) return existing;
      throw new ObjectExistsError(input.key);
    }
    const metadata: StoredObjectMetadata = { key: input.key, contentType: input.contentType, byteSize: input.bytes.byteLength, checksum: actual, createdAt: this.now().toISOString() };
    await this.atomicWrite(objectPath, input.bytes);
    await this.atomicWrite(this.path("meta", input.key), JSON.stringify(metadata));
    return metadata;
  }

  async download(key: StorageKey): Promise<{ bytes: Uint8Array; metadata: StoredObjectMetadata }> {
    const metadata = await this.metadata(key);
    if (metadata === null) throw new ObjectNotFoundError(key);
    const bytes = new Uint8Array(await readFile(this.path("objects", key)));
    const actual = sha256Of(bytes);
    if (actual !== metadata.checksum) throw new ChecksumMismatchError(key, metadata.checksum, actual);
    return { bytes, metadata };
  }

  async delete(key: StorageKey): Promise<void> {
    await rm(this.path("objects", key), { force: true });
    await rm(this.path("meta", key), { force: true });
  }

  async signedUrl(key: StorageKey, options: SignedUrlOptions): Promise<SignedUrl> {
    if ((await this.metadata(key)) === null) throw new ObjectNotFoundError(key);
    return this.signer.sign(key, options.expiresInSeconds, options.disposition);
  }

  verifySignedUrl(url: string): StorageKey {
    return this.signer.verify(url);
  }

  async metadata(key: StorageKey): Promise<StoredObjectMetadata | null> {
    try {
      return JSON.parse(await readFile(this.path("meta", key), "utf8")) as StoredObjectMetadata;
    } catch (e) {
      if (isNotFound(e)) return null;
      throw e;
    }
  }

  async checksum(key: StorageKey): Promise<Sha256> {
    try {
      return sha256Of(new Uint8Array(await readFile(this.path("objects", key))));
    } catch (e) {
      if (isNotFound(e)) throw new ObjectNotFoundError(key);
      throw e;
    }
  }
}
