/**
 * Supabase Storage adapter (M6 G5) behind the existing FileStorageProvider interface. It speaks the Storage REST API
 * with `fetch` (no SDK) to ONE private bucket, server-side only. The domain and schema are unchanged: the database
 * keeps storage keys and checksums; this adapter never persists URLs.
 *
 * - Immutable: an upload never overwrites (`x-upsert: false`); identical content at an existing key is idempotent,
 *   different content is ObjectExistsError.
 * - Checksums: verified before upload (the caller's) and recomputed from the bytes on every download.
 * - Signed URLs: Supabase-native, short-lived (≤ 3600 s), created per request and never stored. The API's own
 *   /file-content route is not used with this provider (verifySignedUrl always refuses).
 * - Deletion: the application decides (FileService refuses referenced files); the adapter only executes it.
 * - Credential: SUPABASE_STORAGE_KEY is held by the API process only (never sent to a browser) and is used for
 *   Storage requests only; the API reaches Postgres exclusively as design_os_api.
 */
import type { FileStorageProvider, Sha256, SignedUrl, SignedUrlOptions, StorageKey, StoredObjectMetadata, UploadInput } from "@lintel/storage";
import { assertValidStorageKey, ChecksumMismatchError, MAX_SIGNED_URL_SECONDS, ObjectExistsError, ObjectNotFoundError, sha256Of, SignedUrlError, StorageError } from "@lintel/storage";

export interface SupabaseStorageConfig {
  /** Project URL, e.g. https://<project-ref>.supabase.co */
  readonly url: string;
  readonly bucket: string;
  /** Server-side Storage credential (secret key). Never sent to a browser, never logged. */
  readonly key: string;
  /** Tests only. */
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
}

const encodeKey = (key: StorageKey) => key.split("/").map(encodeURIComponent).join("/");

export class SupabaseStorageProvider implements FileStorageProvider {
  readonly providerId = "supabase";
  private readonly base: string;
  private readonly fetch: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly config: SupabaseStorageConfig) {
    if (!/^https?:\/\//.test(config.url)) throw new Error("SUPABASE_URL must be an http(s) URL");
    if (!/^[a-z0-9][a-z0-9._-]{1,62}$/.test(config.bucket)) throw new Error("SUPABASE_STORAGE_BUCKET is not a valid bucket name");
    if (config.key.trim() === "") throw new Error("SUPABASE_STORAGE_KEY is required");
    this.base = `${config.url.replace(/\/+$/, "")}/storage/v1`;
    this.fetch = config.fetch ?? fetch;
    this.now = config.now ?? (() => new Date());
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { authorization: `Bearer ${this.config.key}`, apikey: this.config.key, ...extra };
  }

  private async request(method: string, path: string, init: { body?: Uint8Array | string; headers?: Record<string, string> } = {}): Promise<Response> {
    try {
      return await this.fetch(`${this.base}${path}`, { method, headers: this.headers(init.headers), ...(init.body === undefined ? {} : { body: init.body }) });
    } catch {
      // Never surface the request (it carries the credential): a transport failure is a plain storage error.
      throw new StorageError("StorageUnavailableError", `Supabase Storage is not reachable (${method} ${path.split("?")[0] ?? ""})`);
    }
  }

  private objectPath(key: StorageKey): string {
    return `/object/${encodeURIComponent(this.config.bucket)}/${encodeKey(key)}`;
  }

  async upload(input: UploadInput): Promise<StoredObjectMetadata> {
    assertValidStorageKey(input.key);
    const actual = sha256Of(input.bytes);
    if (actual !== input.checksum) throw new ChecksumMismatchError(input.key, input.checksum, actual);
    const r = await this.request("POST", this.objectPath(input.key), { body: input.bytes, headers: { "content-type": input.contentType, "x-upsert": "false", "cache-control": "max-age=31536000, immutable" } });
    if (r.ok) return { key: input.key, contentType: input.contentType, byteSize: input.bytes.byteLength, checksum: actual, createdAt: this.now().toISOString() };
    await r.body?.cancel();
    if (r.status === 409 || r.status === 400) {
      // Already there: identical content (and type) is idempotent, anything else is refused (immutable keys).
      const existing = await this.download(input.key).catch(() => null);
      if (existing?.metadata.checksum === actual && existing.metadata.contentType === input.contentType) return existing.metadata;
      throw new ObjectExistsError(input.key);
    }
    throw new StorageError("StorageRequestError", `Supabase Storage refused the upload of '${input.key}' (HTTP ${String(r.status)})`);
  }

  async download(key: StorageKey): Promise<{ readonly bytes: Uint8Array; readonly metadata: StoredObjectMetadata }> {
    assertValidStorageKey(key);
    const r = await this.request("GET", `/object/authenticated/${encodeURIComponent(this.config.bucket)}/${encodeKey(key)}`);
    if (r.status === 404 || r.status === 400) {
      await r.body?.cancel();
      throw new ObjectNotFoundError(key);
    }
    if (!r.ok) {
      await r.body?.cancel();
      throw new StorageError("StorageRequestError", `Supabase Storage refused the download of '${key}' (HTTP ${String(r.status)})`);
    }
    const bytes = new Uint8Array(await r.arrayBuffer());
    const lastModified = r.headers.get("last-modified");
    return {
      bytes,
      metadata: {
        key, contentType: r.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream", byteSize: bytes.byteLength, checksum: sha256Of(bytes),
        createdAt: lastModified === null ? this.now().toISOString() : new Date(lastModified).toISOString(),
      },
    };
  }

  async delete(key: StorageKey): Promise<void> {
    assertValidStorageKey(key);
    const r = await this.request("DELETE", `/object/${encodeURIComponent(this.config.bucket)}`, { body: JSON.stringify({ prefixes: [key] }), headers: { "content-type": "application/json" } });
    await r.body?.cancel();
    if (!r.ok && r.status !== 404) throw new StorageError("StorageRequestError", `Supabase Storage refused the deletion of '${key}' (HTTP ${String(r.status)})`);
  }

  async signedUrl(key: StorageKey, options: SignedUrlOptions): Promise<SignedUrl> {
    assertValidStorageKey(key);
    if (!Number.isInteger(options.expiresInSeconds) || options.expiresInSeconds < 1 || options.expiresInSeconds > MAX_SIGNED_URL_SECONDS) {
      throw new SignedUrlError(`expiresInSeconds must be 1..${String(MAX_SIGNED_URL_SECONDS)}`);
    }
    const r = await this.request("POST", `/object/sign/${encodeURIComponent(this.config.bucket)}/${encodeKey(key)}`, {
      body: JSON.stringify({ expiresIn: options.expiresInSeconds }), headers: { "content-type": "application/json" },
    });
    if (r.status === 404 || r.status === 400) {
      await r.body?.cancel();
      throw new ObjectNotFoundError(key);
    }
    if (!r.ok) {
      await r.body?.cancel();
      throw new StorageError("StorageRequestError", `Supabase Storage refused to sign '${key}' (HTTP ${String(r.status)})`);
    }
    const body = await r.json() as { signedURL?: unknown };
    if (typeof body.signedURL !== "string" || !body.signedURL.startsWith("/")) throw new StorageError("StorageRequestError", "Supabase Storage returned no signed URL");
    const url = new URL(`${this.base}${body.signedURL}`);
    if (options.disposition === "attachment") url.searchParams.set("download", key.split("/").at(-1) ?? "file");
    return { url: url.toString(), expiresAt: new Date(this.now().getTime() + options.expiresInSeconds * 1000).toISOString() };
  }

  async metadata(key: StorageKey): Promise<StoredObjectMetadata | null> {
    try {
      return (await this.download(key)).metadata;
    } catch (e) {
      if (e instanceof ObjectNotFoundError) return null;
      throw e;
    }
  }

  async checksum(key: StorageKey): Promise<Sha256> {
    return (await this.download(key)).metadata.checksum;
  }

  /** Signed URLs of this provider point at Supabase; the API's /file-content route never serves them. */
  verifySignedUrl(): StorageKey {
    throw new SignedUrlError("signed URLs of the Supabase provider are served by Supabase Storage");
  }
}
