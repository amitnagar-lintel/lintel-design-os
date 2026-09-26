import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FileStorageProvider } from "../src/index.js";
import {
  assertValidStorageKey,
  buildStorageKey,
  ChecksumMismatchError,
  FileReferencedError,
  FileService,
  InvalidStorageKeyError,
  LocalFsStorageProvider,
  MemoryStorageProvider,
  ObjectExistsError,
  ObjectNotFoundError,
  sha256Of,
  SignedUrlError,
} from "../src/index.js";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const KEY = buildStorageKey({ orgId: "org_lintel", projectId: "project_001", designVersionId: "dv_001", kind: "drawing", fileId: "snap_1", extension: "pdf" });
const T0 = new Date("2026-09-26T10:00:00.000Z");

describe("storage keys", () => {
  it("builds the canonical layout", () => {
    expect(KEY).toBe("org/org_lintel/project/project_001/dv/dv_001/drawing/snap_1.pdf");
  });
  it("rejects absolute paths, traversal, backslashes and odd characters", () => {
    for (const bad of ["/etc/passwd", "a/../b", "..", "a//b", "a\\b", "a/b c", "", "a/.hidden", "a/b/.."]) {
      expect(() => {
        assertValidStorageKey(bad);
      }).toThrow(InvalidStorageKeyError);
    }
  });
});

let dir = "";
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "lintel-storage-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const clock = () => {
  let now = T0;
  return { now: () => now, advance: (s: number) => (now = new Date(now.getTime() + s * 1000)) };
};

const providers: readonly (readonly [string, (c: ReturnType<typeof clock>) => FileStorageProvider & { verifySignedUrl(url: string): string }])[] = [
  ["memory", (c) => new MemoryStorageProvider({ now: c.now })],
  ["local-fs", (c) => new LocalFsStorageProvider({ root: dir, signingSecret: "local-dev-secret-0123456789", now: c.now })],
];

describe.each(providers)("%s provider", (_name, make) => {
  it("uploads with a verified checksum and downloads the same bytes", async () => {
    const p = make(clock());
    const data = bytes("%PDF-1.4 drawing");
    const meta = await p.upload({ key: KEY, bytes: data, contentType: "application/pdf", checksum: sha256Of(data) });
    expect(meta).toEqual({ key: KEY, contentType: "application/pdf", byteSize: data.byteLength, checksum: sha256Of(data), createdAt: T0.toISOString() });
    const got = await p.download(KEY);
    expect(got.bytes).toEqual(data);
    expect(await p.metadata(KEY)).toEqual(meta);
    expect(await p.checksum(KEY)).toBe(sha256Of(data));
  });
  it("refuses an upload whose checksum does not match the bytes", async () => {
    const p = make(clock());
    await expect(p.upload({ key: KEY, bytes: bytes("a"), contentType: "text/plain", checksum: sha256Of(bytes("b")) })).rejects.toThrow(ChecksumMismatchError);
    expect(await p.metadata(KEY)).toBeNull();
  });
  it("objects are immutable: identical re-upload is idempotent, different content is refused", async () => {
    const p = make(clock());
    const data = bytes("v1");
    const first = await p.upload({ key: KEY, bytes: data, contentType: "application/pdf", checksum: sha256Of(data) });
    expect(await p.upload({ key: KEY, bytes: data, contentType: "application/pdf", checksum: sha256Of(data) })).toEqual(first);
    const other = bytes("v2");
    await expect(p.upload({ key: KEY, bytes: other, contentType: "application/pdf", checksum: sha256Of(other) })).rejects.toThrow(ObjectExistsError);
    expect((await p.download(KEY)).bytes).toEqual(data);
  });
  it("issues short-lived signed URLs that expire and cannot be altered", async () => {
    const c = clock();
    const p = make(c);
    const data = bytes("x");
    await p.upload({ key: KEY, bytes: data, contentType: "application/pdf", checksum: sha256Of(data) });
    const { url, expiresAt } = await p.signedUrl(KEY, { expiresInSeconds: 300, disposition: "attachment" });
    expect(expiresAt).toBe(new Date(T0.getTime() + 300_000).toISOString());
    expect(p.verifySignedUrl(url)).toBe(KEY);
    expect(() => p.verifySignedUrl(url.replace("snap_1", "snap_2"))).toThrow(SignedUrlError);
    expect(() => p.verifySignedUrl(url.replace("attachment", "inline"))).toThrow(SignedUrlError);
    c.advance(301);
    expect(() => p.verifySignedUrl(url)).toThrow(SignedUrlError);
    await expect(p.signedUrl(KEY, { expiresInSeconds: 7200, disposition: "inline" })).rejects.toThrow(SignedUrlError);
    await expect(p.signedUrl("org/x/missing.pdf", { expiresInSeconds: 60, disposition: "inline" })).rejects.toThrow(ObjectNotFoundError);
  });
  it("delete is idempotent; missing objects are reported", async () => {
    const p = make(clock());
    const data = bytes("x");
    await p.upload({ key: KEY, bytes: data, contentType: "application/pdf", checksum: sha256Of(data) });
    await p.delete(KEY);
    await p.delete(KEY);
    expect(await p.metadata(KEY)).toBeNull();
    await expect(p.download(KEY)).rejects.toThrow(ObjectNotFoundError);
    await expect(p.checksum(KEY)).rejects.toThrow(ObjectNotFoundError);
  });
});

describe("corruption is detected on read", () => {
  it("memory provider", async () => {
    const p = new MemoryStorageProvider();
    const data = bytes("original");
    await p.upload({ key: KEY, bytes: data, contentType: "application/pdf", checksum: sha256Of(data) });
    p.corruptForTest(KEY);
    await expect(p.download(KEY)).rejects.toThrow(ChecksumMismatchError);
  });
  it("local-fs provider", async () => {
    const p = new LocalFsStorageProvider({ root: dir, signingSecret: "local-dev-secret-0123456789" });
    const data = bytes("original");
    await p.upload({ key: KEY, bytes: data, contentType: "application/pdf", checksum: sha256Of(data) });
    await writeFile(join(dir, "objects", KEY), "tampered");
    await expect(p.download(KEY)).rejects.toThrow(ChecksumMismatchError);
  });
});

describe("FileService", () => {
  it("stores with a computed checksum and verifies reads against the recorded checksum", async () => {
    const svc = new FileService(new MemoryStorageProvider(), () => Promise.resolve(false));
    const data = bytes("drawing");
    const meta = await svc.store(KEY, data, "application/pdf");
    expect(meta.checksum).toBe(sha256Of(data));
    expect(await svc.retrieve(KEY, meta.checksum)).toEqual(data);
    await expect(svc.retrieve(KEY, sha256Of(bytes("something else")))).rejects.toThrow(ChecksumMismatchError);
  });
  it("refuses to delete a file referenced by a snapshot or issued output", async () => {
    const referenced = new Set([KEY]);
    const provider = new MemoryStorageProvider();
    const svc = new FileService(provider, (k) => Promise.resolve(referenced.has(k)));
    await svc.store(KEY, bytes("issued drawing"), "application/pdf");
    await expect(svc.deleteUnreferenced(KEY)).rejects.toThrow(FileReferencedError);
    expect(await provider.metadata(KEY)).not.toBeNull();
    referenced.delete(KEY);
    await svc.deleteUnreferenced(KEY);
    expect(await provider.metadata(KEY)).toBeNull();
  });
  it("the domain only ever sees keys and checksums, never provider URLs", async () => {
    const svc = new FileService(new MemoryStorageProvider(), () => Promise.resolve(false));
    const meta = await svc.store(KEY, bytes("x"), "application/pdf");
    expect(Object.keys(meta).sort()).toEqual(["byteSize", "checksum", "contentType", "createdAt", "key"]);
  });
});
