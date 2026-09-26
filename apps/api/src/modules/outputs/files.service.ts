import { Inject, Injectable } from "@nestjs/common";
import { ObjectNotFoundError, SignedUrlError, StorageError } from "@lintel/storage";
import type { RequestScope } from "../../common/auth/context.js";
import { UnitOfWork } from "../../common/db/unit-of-work.js";
import { ApiProblem } from "../../common/errors/api-problem.js";
import { API_CONFIG, FILE_STORAGE } from "../../common/tokens.js";
import type { ApiConfig } from "../../config.js";
import { filesRepository } from "../../infrastructure/persistence/files.repository.js";
import type { SigningStorageProvider } from "../../infrastructure/storage/file-storage.js";

/** Signed file URLs are short-lived (plan §15: 300 s) and never persisted. */
export const SIGNED_URL_SECONDS = 300;

/**
 * Stored output files: signed URLs for readable files, and serving a signed URL's bytes. Who may read a file is decided
 * by RLS on file_object (internal readers of production outputs, or a client for a file of an issued drawing of a
 * project they can access); the URL itself is only a short-lived, HMAC-signed capability for that one object.
 */
@Injectable()
export class FilesService {
  constructor(
    @Inject(API_CONFIG) private readonly config: ApiConfig,
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(FILE_STORAGE) private readonly storage: SigningStorageProvider,
  ) {}

  signedUrl(scope: RequestScope, fileId: string, disposition: "inline" | "attachment") {
    return this.uow.run(scope, { readOnly: true }, async (tx) => {
      const f = await filesRepository.get(tx, fileId);
      if (f === null) throw new ApiProblem("NOT_FOUND");
      if (f.provider_id !== this.storage.providerId) throw new ApiProblem("INTERNAL", `file ${fileId} is stored with provider ${f.provider_id}, not ${this.storage.providerId}`);
      try {
        const signed = await this.storage.signedUrl(f.storage_key, { expiresInSeconds: SIGNED_URL_SECONDS, disposition });
        return { fileId: f.id, url: signed.url, expiresAt: signed.expiresAt, expiresInSeconds: SIGNED_URL_SECONDS, contentType: f.content_type, byteSize: f.byte_size, checksum: f.checksum };
      } catch (e) {
        if (e instanceof ObjectNotFoundError) throw new ApiProblem("INTERNAL", `file ${fileId} is recorded but missing from storage`);
        throw e;
      }
    });
  }

  /**
   * The bytes behind a signed URL (path + query as received). The signature, expiry and key are verified by the
   * provider's signer; the provider verifies the stored checksum on download.
   */
  async content(pathAndQuery: string): Promise<{ readonly bytes: Uint8Array; readonly contentType: string; readonly disposition: "inline" | "attachment"; readonly checksum: string }> {
    const url = `${this.config.files.publicBaseUrl}${pathAndQuery}`;
    try {
      const key = this.storage.verifySignedUrl(url);
      const { bytes, metadata } = await this.storage.download(key);
      const disposition = new URL(url).searchParams.get("disposition") === "inline" ? "inline" : "attachment";
      return { bytes, contentType: metadata.contentType, disposition, checksum: metadata.checksum };
    } catch (e) {
      if (e instanceof SignedUrlError) throw new ApiProblem("SIGNED_URL_INVALID", e.message);
      if (e instanceof ObjectNotFoundError) throw new ApiProblem("NOT_FOUND");
      if (e instanceof StorageError) throw new ApiProblem("SIGNED_URL_INVALID", e.message);
      throw e;
    }
  }
}
