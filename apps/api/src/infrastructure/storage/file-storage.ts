import type { FileStorageProvider, StorageKey } from "@lintel/storage";
import { LocalFsStorageProvider, MemoryStorageProvider } from "@lintel/storage";
import type { ApiConfig } from "../../config.js";
import { SupabaseStorageProvider } from "./supabase-storage.js";

/** A storage provider that signs its own short-lived URLs (memory / local) and can verify them when served. */
export interface SigningStorageProvider extends FileStorageProvider {
  verifySignedUrl(url: string): StorageKey;
}

/** The path under which the API serves signed file URLs (GET, public; the signature is the credential). */
export const FILE_CONTENT_PATH = "/api/v1/file-content";

/**
 * The configured output file storage (M5 §12): in-memory (development / tests), the local filesystem, or a private
 * Supabase Storage bucket (M6 G5). Memory / local signed URLs point at this API's FILE_CONTENT_PATH; Supabase signed
 * URLs point at Supabase Storage.
 */
export function createFileStorage(files: ApiConfig["files"]): SigningStorageProvider {
  const baseUrl = `${files.publicBaseUrl}${FILE_CONTENT_PATH}`;
  if (files.provider === "supabase") {
    if (files.supabase === undefined) throw new Error("supabase file storage requires SUPABASE_URL, SUPABASE_STORAGE_BUCKET and SUPABASE_STORAGE_KEY");
    return new SupabaseStorageProvider(files.supabase);
  }
  if (files.provider === "local") {
    if (files.root === undefined) throw new Error("local file storage requires a root directory");
    return new LocalFsStorageProvider({ root: files.root, signingSecret: files.signingSecret, baseUrl });
  }
  return new MemoryStorageProvider({ signingSecret: files.signingSecret, baseUrl });
}
