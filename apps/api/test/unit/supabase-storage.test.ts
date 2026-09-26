/**
 * Supabase Storage adapter (M6 G5) against a local stand-in of the Storage REST API (no hosted project is contacted):
 * immutable keys, checksums, signed URLs, the application's deletion rule, credential handling and configuration.
 */
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { ChecksumMismatchError, FileReferencedError, FileService, ObjectExistsError, ObjectNotFoundError, sha256Of, SignedUrlError, StorageError } from "@lintel/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.js";
import { createFileStorage } from "../../src/infrastructure/storage/file-storage.js";
import { SupabaseStorageProvider } from "../../src/infrastructure/storage/supabase-storage.js";

const KEY = "sb_secret_test_0123456789abcdefghij";
const BUCKET = "design-os-outputs";
const objects = new Map<string, { bytes: Buffer; type: string }>();
const tokens = new Map<string, { key: string; expires: number }>();
let server: Server;
let url = "";
let requests = 0;

async function body(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks);
}

/** The subset of the Supabase Storage API the adapter uses, with its auth and no-overwrite behaviour. */
async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  requests++;
  const u = new URL(req.url ?? "/", "http://x");
  const path = decodeURIComponent(u.pathname);
  const signed = /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/.exec(path);
  if (req.method === "GET" && signed !== null) {
    const t = tokens.get(u.searchParams.get("token") ?? "");
    const o = t === undefined || t.expires < Date.now() || t.key !== signed[2] ? undefined : objects.get(t.key);
    if (o === undefined) { res.writeHead(400).end(); return; }
    res.writeHead(200, { "content-type": o.type, ...(u.searchParams.has("download") ? { "content-disposition": `attachment; filename="${u.searchParams.get("download") ?? ""}"` } : {}) }).end(o.bytes);
    return;
  }
  if (req.headers.authorization !== `Bearer ${KEY}` || req.headers.apikey !== KEY) { res.writeHead(401).end(JSON.stringify({ error: "Unauthorized" })); return; }
  const obj = /^\/storage\/v1\/object\/(authenticated\/)?([^/]+)\/(.+)$/.exec(path);
  if (req.method === "POST" && signed !== null) {
    const { expiresIn } = JSON.parse((await body(req)).toString()) as { expiresIn: number };
    if (!objects.has(signed[2]!)) { res.writeHead(400).end(JSON.stringify({ error: "not_found" })); return; }
    const token = randomBytes(12).toString("hex");
    tokens.set(token, { key: signed[2]!, expires: Date.now() + expiresIn * 1000 });
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ signedURL: `/object/sign/${BUCKET}/${signed[2]!}?token=${token}` }));
    return;
  }
  if (req.method === "POST" && obj !== null && obj[1] === undefined) {
    const bytes = await body(req);
    if (objects.has(obj[3]!) && req.headers["x-upsert"] !== "true") { res.writeHead(400).end(JSON.stringify({ statusCode: "409", error: "Duplicate" })); return; }
    objects.set(obj[3]!, { bytes, type: String(req.headers["content-type"]) });
    res.writeHead(200).end(JSON.stringify({ Key: `${BUCKET}/${obj[3]!}` }));
    return;
  }
  if (req.method === "GET" && obj?.[1] !== undefined) {
    const o = objects.get(obj[3]!);
    if (o === undefined) { res.writeHead(400).end(JSON.stringify({ error: "not_found" })); return; }
    res.writeHead(200, { "content-type": o.type, "last-modified": "Sat, 26 Sep 2026 10:00:00 GMT" }).end(o.bytes);
    return;
  }
  if (req.method === "DELETE" && path === `/storage/v1/object/${BUCKET}`) {
    const { prefixes } = JSON.parse((await body(req)).toString()) as { prefixes: string[] };
    for (const p of prefixes) objects.delete(p);
    res.writeHead(200).end("[]");
    return;
  }
  res.writeHead(404).end();
}

beforeAll(async () => {
  server = createServer((req, res) => { void handle(req, res); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  url = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => { r(); }));
});

const provider = (key = KEY) => new SupabaseStorageProvider({ url, bucket: BUCKET, key });
const pdf = (s: string) => new TextEncoder().encode(`%PDF-1.7 ${s}`);
const sk = (name: string) => `org/o1/project/p1/dv/v1/drawing/${createHash("sha256").update(name).digest("hex")}.pdf`;

describe("Supabase Storage provider", () => {
  it("stores immutable objects: identical re-upload is idempotent, different content is refused, bad checksums never leave the process", async () => {
    const p = provider();
    const bytes = pdf("a");
    const key = sk("a");
    const stored = await p.upload({ key, bytes, contentType: "application/pdf", checksum: sha256Of(bytes) });
    expect(stored).toMatchObject({ key, byteSize: bytes.byteLength, checksum: sha256Of(bytes), contentType: "application/pdf" });
    expect(await p.upload({ key, bytes, contentType: "application/pdf", checksum: sha256Of(bytes) })).toMatchObject({ checksum: sha256Of(bytes) });
    const other = pdf("b");
    await expect(p.upload({ key, bytes: other, contentType: "application/pdf", checksum: sha256Of(other) })).rejects.toThrow(ObjectExistsError);
    const before = requests;
    await expect(p.upload({ key: sk("c"), bytes: other, contentType: "application/pdf", checksum: sha256Of(bytes) })).rejects.toThrow(ChecksumMismatchError);
    expect(requests).toBe(before);
    const d = await p.download(key);
    expect([Buffer.from(d.bytes).toString(), d.metadata.checksum]).toEqual([Buffer.from(bytes).toString(), sha256Of(bytes)]);
  });

  it("verifies checksums on read (a corrupted object is detected by the application)", async () => {
    const p = provider();
    const bytes = pdf("corrupt-me");
    const key = sk("corrupt");
    await p.upload({ key, bytes, contentType: "application/pdf", checksum: sha256Of(bytes) });
    objects.get(key)!.bytes[0] ^= 0xff;
    const service = new FileService(p, () => Promise.resolve(true));
    await expect(service.retrieve(key, sha256Of(bytes))).rejects.toThrow(ChecksumMismatchError);
    expect(await p.checksum(key)).not.toBe(sha256Of(bytes));
  });

  it("signs short-lived Supabase URLs (inline / attachment) that serve the object; never stored, never the API route", async () => {
    const p = provider();
    const bytes = pdf("signed");
    const key = sk("signed");
    await p.upload({ key, bytes, contentType: "application/pdf", checksum: sha256Of(bytes) });
    const inline = await p.signedUrl(key, { expiresInSeconds: 300, disposition: "inline" });
    expect(inline.url.startsWith(`${url}/storage/v1/object/sign/${BUCKET}/`)).toBe(true);
    expect(inline.url).not.toContain(KEY);
    expect(Date.parse(inline.expiresAt) - Date.now()).toBeLessThanOrEqual(300_000);
    const got = await fetch(inline.url);
    expect([got.status, Buffer.from(await got.arrayBuffer()).toString()]).toEqual([200, Buffer.from(bytes).toString()]);
    const attachment = await p.signedUrl(key, { expiresInSeconds: 60, disposition: "attachment" });
    expect((await fetch(attachment.url)).headers.get("content-disposition")).toMatch(/^attachment/);
    await expect(p.signedUrl(key, { expiresInSeconds: 3601, disposition: "inline" })).rejects.toThrow(SignedUrlError);
    await expect(p.signedUrl(sk("missing"), { expiresInSeconds: 60, disposition: "inline" })).rejects.toThrow(ObjectNotFoundError);
    expect(() => p.verifySignedUrl()).toThrow(SignedUrlError);
  });

  it("never deletes a referenced file; deletes an orphan; missing objects are not found", async () => {
    const p = provider();
    const bytes = pdf("keep");
    const key = sk("keep");
    await p.upload({ key, bytes, contentType: "application/pdf", checksum: sha256Of(bytes) });
    await expect(new FileService(p, () => Promise.resolve(true)).deleteUnreferenced(key)).rejects.toThrow(FileReferencedError);
    expect(objects.has(key)).toBe(true);
    await new FileService(p, () => Promise.resolve(false)).deleteUnreferenced(key);
    expect(objects.has(key)).toBe(false);
    expect(await p.metadata(key)).toBeNull();
    await expect(p.download(key)).rejects.toThrow(ObjectNotFoundError);
  });

  it("keeps the credential out of every error and refuses without it", async () => {
    const bad = provider("sb_secret_wrong_0123456789abcdefghij");
    const bytes = pdf("x");
    const e = await bad.upload({ key: sk("x"), bytes, contentType: "application/pdf", checksum: sha256Of(bytes) }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(StorageError);
    expect(String((e as Error).message)).not.toContain("sb_secret");
    const down = new SupabaseStorageProvider({ url: "http://127.0.0.1:1", bucket: BUCKET, key: KEY });
    const u = await down.download(sk("x")).catch((x: unknown) => x);
    expect([u instanceof StorageError, String((u as Error).message).includes(KEY)]).toEqual([true, false]);
    expect(() => new SupabaseStorageProvider({ url, bucket: BUCKET, key: " " })).toThrow(/SUPABASE_STORAGE_KEY/);
  });
});

describe("configuration", () => {
  const base = {
    DATABASE_URL: "postgresql://x@h/db", AUTH_ISSUER: "https://a/auth/v1", AUTH_JWT_SECRET: "s".repeat(40), CURSOR_SECRET: "c".repeat(32),
    FILE_URL_SECRET: "f".repeat(32), FILE_URL_BASE: "https://api.example", BUILD_REVISION: "abc1234",
  };
  it("FILE_STORAGE=supabase needs the project URL, bucket and key — and only then", () => {
    const c = loadConfig({ ...base, FILE_STORAGE: "supabase", SUPABASE_URL: "https://ref.supabase.co", SUPABASE_STORAGE_BUCKET: BUCKET, SUPABASE_STORAGE_KEY: KEY });
    expect(c.files).toMatchObject({ provider: "supabase", supabase: { url: "https://ref.supabase.co", bucket: BUCKET, key: KEY } });
    expect(createFileStorage(c.files).providerId).toBe("supabase");
    expect(() => loadConfig({ ...base, FILE_STORAGE: "supabase", SUPABASE_URL: "https://ref.supabase.co" })).toThrow(/SUPABASE_STORAGE_BUCKET/);
    expect(() => loadConfig({ ...base, FILE_STORAGE: "memory", SUPABASE_STORAGE_KEY: KEY })).toThrow(/only for/);
    expect(loadConfig({ ...base, FILE_STORAGE: "memory" }).files.supabase).toBeUndefined();
  });
});
