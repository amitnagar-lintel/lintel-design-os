import type { FileStorageProvider, StorageKey } from "@lintel/storage";
import { LocalFsStorageProvider, MemoryStorageProvider } from "@lintel/storage";
import type { ApiConfig } from "../../config.js";

/** A storage provider that signs its own short-lived URLs (memory / local) and can verify them when served. */
export interface SigningStorageProvider extends FileStorageProvider {
  verifySignedUrl(url: string): StorageKey;
}

/** The path under which the API serves signed file URLs (GET, public; the signature is the credential). */
export const FILE_CONTENT_PATH = "/api/v1/file-content";

/**
 * The configured output file storage (M5 §12): in-memory (development / tests) or the local filesystem. No hosted
 * bucket and no cloud SDK exists yet. Signed URLs point at this API's FILE_CONTENT_PATH.
 */
export function createFileStorage(files: ApiConfig["files"]): SigningStorageProvider {
  const baseUrl = `${files.publicBaseUrl}${FILE_CONTENT_PATH}`;
  if (files.provider === "local") {
    if (files.root === undefined) throw new Error("local file storage requires a root directory");
    return new LocalFsStorageProvider({ root: files.root, signingSecret: files.signingSecret, baseUrl });
  }
  return new MemoryStorageProvider({ signingSecret: files.signingSecret, baseUrl });
}
