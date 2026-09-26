/**
 * The typed API client (openapi-fetch over the generated OpenAPI types). The UI only calls the API: every number it
 * shows (geometry, validation, BOM, BOQ, prices, quotation totals, drawings) comes from the API's engines.
 * The access token of the signed-in person is attached here; no other credential ever reaches the browser.
 */
import createClient from "openapi-fetch";
import type { components, operations, paths } from "./schema";

export type Schemas = components["schemas"];
export type Problem = Schemas["Problem"];
export type ModelPreview = operations["ModelPreview_get"]["responses"][200]["content"]["application/json"];

let bearer: string | null = null;
export const setBearer = (token: string | null): void => { bearer = token; };

export const api = createClient<paths>({ baseUrl: "" });
api.use({
  onRequest({ request }) {
    if (bearer !== null) request.headers.set("authorization", `Bearer ${bearer}`);
    return request;
  },
});

export const idempotency = () => crypto.randomUUID();

export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly problem: Partial<Problem> | null) {
    super(message);
    this.name = "ApiError";
  }
}

function toError(status: number, error: unknown): ApiError {
  const p = error !== null && typeof error === "object" ? error as Partial<Problem> : null;
  const details = [p?.detail, ...(p?.errors ?? []).map((e) => `${e.path}: ${e.message}`), p?.context === undefined ? undefined : JSON.stringify(p.context)].filter((x) => x !== undefined && x !== "");
  return new ApiError(status, p?.code ?? `HTTP_${String(status)}`, `${p?.title ?? `HTTP ${String(status)}`}${details.length > 0 ? ` — ${details.join("; ")}` : ""}`, p);
}

/** The response body, or an ApiError carrying the RFC 9457 problem. */
export async function must<T>(call: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const r = await call;
  if (r.error !== undefined || r.data === undefined) throw toError(r.response.status, r.error);
  return r.data;
}

/** A design version and its strong ETag (every edit of the version names it in If-Match). */
export async function versionWithEtag(versionId: string): Promise<{ version: Schemas["VersionResponse"]; etag: string }> {
  const r = await api.GET("/api/v1/design-versions/{versionId}", { params: { path: { versionId } } });
  if (r.error !== undefined) throw toError(r.response.status, r.error);
  return { version: r.data, etag: r.response.headers.get("etag") ?? "" };
}
