import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { InvalidStorageKeyError, SignedUrlError } from "./errors.js";
import type { ContentDisposition, Sha256, StorageKey } from "./types.js";
import { MAX_SIGNED_URL_SECONDS } from "./types.js";

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const MAX_KEY_LENGTH = 1024;

/** Relative `/`-separated key of safe segments: no absolute paths, `..`, backslashes or empty segments. */
export function assertValidStorageKey(key: string): asserts key is StorageKey {
  if (key.length === 0 || key.length > MAX_KEY_LENGTH) throw new InvalidStorageKeyError(key, `length must be 1–${MAX_KEY_LENGTH}`);
  if (key.startsWith("/")) throw new InvalidStorageKeyError(key, "must be relative");
  if (key.includes("\\")) throw new InvalidStorageKeyError(key, "backslashes are not allowed");
  for (const seg of key.split("/")) {
    if (seg === "" || seg === "." || seg === ".." || seg.includes("..")) throw new InvalidStorageKeyError(key, `bad segment '${seg}'`);
    if (!SEGMENT.test(seg)) throw new InvalidStorageKeyError(key, `segment '${seg}' has characters outside [A-Za-z0-9_.-]`);
  }
}

export type StoredFileKind = "drawing" | "manufacturing-document" | "document" | "cad" | "render";

/** Canonical key layout: `org/{org}/project/{project}/dv/{designVersion}/{kind}/{fileId}.{ext}`. */
export function buildStorageKey(p: {
  readonly orgId: string;
  readonly projectId: string;
  readonly designVersionId: string;
  readonly kind: StoredFileKind;
  readonly fileId: string;
  readonly extension: string;
}): StorageKey {
  const key = `org/${p.orgId}/project/${p.projectId}/dv/${p.designVersionId}/${p.kind}/${p.fileId}.${p.extension}`;
  assertValidStorageKey(key);
  return key;
}

export function sha256Of(bytes: Uint8Array): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/**
 * HMAC-signed, expiring URLs for providers without their own signing (memory, local).
 * Cloud adapters use the provider's native signed URLs instead.
 */
export class UrlSigner {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
    private readonly now: () => Date,
  ) {
    if (secret.length < 16) throw new SignedUrlError("signing secret must be at least 16 characters");
  }

  sign(key: StorageKey, expiresInSeconds: number, disposition: ContentDisposition): { url: string; expiresAt: string } {
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > MAX_SIGNED_URL_SECONDS) {
      throw new SignedUrlError(`expiresInSeconds must be an integer in 1…${MAX_SIGNED_URL_SECONDS}`);
    }
    const expires = Math.floor(this.now().getTime() / 1000) + expiresInSeconds;
    const sig = this.signature(key, expires, disposition);
    const path = key.split("/").map(encodeURIComponent).join("/");
    return { url: `${this.baseUrl}/${path}?expires=${expires}&disposition=${disposition}&sig=${sig}`, expiresAt: new Date(expires * 1000).toISOString() };
  }

  /** The key the URL grants access to, or an error when it is forged, altered or expired. */
  verify(url: string): StorageKey {
    if (!url.startsWith(`${this.baseUrl}/`)) throw new SignedUrlError("URL is not issued by this signer");
    const parsed = new URL(url);
    const key = decodeURIComponent(url.slice(this.baseUrl.length + 1).split("?")[0] ?? "");
    assertValidStorageKey(key);
    const expires = Number(parsed.searchParams.get("expires"));
    const disposition = parsed.searchParams.get("disposition");
    const sig = parsed.searchParams.get("sig") ?? "";
    if (!Number.isInteger(expires) || (disposition !== "inline" && disposition !== "attachment")) throw new SignedUrlError("malformed signed URL");
    const expected = Buffer.from(this.signature(key, expires, disposition), "hex");
    const given = Buffer.from(sig, "hex");
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new SignedUrlError("signature does not match");
    if (Math.floor(this.now().getTime() / 1000) > expires) throw new SignedUrlError("signed URL has expired");
    return key;
  }

  private signature(key: StorageKey, expires: number, disposition: ContentDisposition): string {
    return createHmac("sha256", this.secret).update(`${key}\n${expires}\n${disposition}`).digest("hex");
  }
}
