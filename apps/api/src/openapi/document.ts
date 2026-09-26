import type { Type } from "@nestjs/common";
import { RequestMethod } from "@nestjs/common";
import { METHOD_METADATA, MODULE_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from "@nestjs/common/constants.js";
import { z } from "zod";
import type { AccessDeclaration, IdentityRequirement } from "../common/auth/decorators.js";
import { ACCESS, IDENTITY, NO_ORG } from "../common/auth/decorators.js";
import { PROBLEM_CODES, problemType } from "../common/errors/problem-codes.js";
import type { ApiDocSpec } from "../common/http/openapi.js";
import { OPENAPI } from "../common/http/openapi.js";
import { SchemaPipe } from "../common/http/schema.pipe.js";
import { ProblemSchema } from "../common/http/schemas.js";

/**
 * OpenAPI 3.1 from the running route table (Step 6 plan §17): every route of every feature module, with its request
 * schemas taken from the route's SchemaPipes, its responses from @ApiDoc, and its access declaration. Deterministic:
 * paths, methods and keys are emitted in a stable order, so the committed document is a drift check.
 */
type Json = Record<string, unknown>;
export const API_PREFIX = "/api/v1";
export const OPENAPI_TITLE = "Lintel Design OS API";

const METHOD: Readonly<Partial<Record<RequestMethod, string>>> = {
  [RequestMethod.GET]: "get", [RequestMethod.POST]: "post", [RequestMethod.PATCH]: "patch", [RequestMethod.PUT]: "put", [RequestMethod.DELETE]: "delete",
};

function schemaOf(t: z.ZodType, io: "input" | "output"): Json {
  const s = z.toJSONSchema(t, { io, target: "draft-2020-12", unrepresentable: "any", reused: "inline" }) as Json;
  delete s.$schema;
  return s;
}

function joinPath(...parts: readonly (string | undefined)[]): string {
  const p = parts.filter((x): x is string => x !== undefined && x !== "" && x !== "/").map((x) => x.replace(/^\/+|\/+$/g, "")).join("/");
  return `${API_PREFIX}/${p}`.replace(/:([A-Za-z0-9_]+)/g, "{$1}").replace(/\/\*$/, "/{path}");
}

interface RouteArg { readonly index: number; readonly pipes?: readonly unknown[] }

export interface DocumentedRoute {
  readonly method: string;
  readonly path: string;
  readonly controller: string;
  readonly handler: string;
  readonly doc: ApiDocSpec | undefined;
}

const controllersOf = (modules: readonly Type[]): Type[] => modules.flatMap((m) => (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, m) ?? []) as Type[]);

/** Every route of the modules' controllers, with its @ApiDoc (undefined when a route is undocumented). */
export function routesOf(modules: readonly Type[]): DocumentedRoute[] {
  return controllersOf(modules).flatMap(routesOfController);
}

function routesOfController(c: Type): DocumentedRoute[] {
  const out: DocumentedRoute[] = [];
  const prefix = Reflect.getMetadata(PATH_METADATA, c) as string | undefined;
  const proto = c.prototype as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(proto)) {
    const handler = proto[name];
    if (name === "constructor" || typeof handler !== "function") continue;
    const method = Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined;
    const path = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
    if (method === undefined || path === undefined) continue;
    out.push({ method: METHOD[method] ?? "unknown", path: joinPath(prefix, path), controller: c.name, handler: name, doc: Reflect.getMetadata(OPENAPI, handler) as ApiDocSpec | undefined });
  }
  return out;
}

function pipesOf(c: Type, handler: string): SchemaPipe<unknown>[] {
  const args = (Reflect.getMetadata(ROUTE_ARGS_METADATA, c, handler) ?? {}) as Record<string, RouteArg>;
  return Object.values(args).sort((a, b) => a.index - b.index).flatMap((a) => (a.pipes ?? []).filter((p): p is SchemaPipe<unknown> => p instanceof SchemaPipe));
}

function objectProperties(schema: Json): { props: Record<string, Json>; required: string[] } {
  return { props: (schema.properties ?? {}) as Record<string, Json>, required: (schema.required ?? []) as string[] };
}

/**
 * Component schemas: every named Zod schema (the modules' exported schemas) plus each operation's own request and
 * response schemas, converted in ONE registry per direction so nested uses become `$ref`s. Requests use the input
 * shape (defaults optional), responses the output shape; unreferenced components are pruned.
 */
class Components {
  private readonly registries = { input: z.registry<{ id: string }>(), output: z.registry<{ id: string }>() };
  constructor(named: Readonly<Record<string, z.ZodType>>) {
    for (const [name, schema] of Object.entries(named).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      // Request schemas (by name) are input components only; every other schema is an output component with an
      // `Input` twin for request use (the input shape: defaults optional).
      const request = /(Input|Request|Create|Update|Assign|Revoke|Query)$/.test(name);
      if (!request && !this.registries.output.has(schema)) this.registries.output.add(schema, { id: name });
      if (!this.registries.input.has(schema)) this.registries.input.add(schema, { id: request ? name : `${name}Input` });
    }
  }

  ref(schema: z.ZodType, io: "input" | "output", fallbackId: string): Json {
    const reg = this.registries[io];
    if (!reg.has(schema)) reg.add(schema, { id: fallbackId });
    return { $ref: `#/components/schemas/${reg.get(schema)?.id ?? fallbackId}` };
  }

  schemas(): Record<string, Json> {
    const out: Record<string, Json> = {};
    for (const io of ["input", "output"] as const) {
      const converted = z.toJSONSchema(this.registries[io], { io, target: "draft-2020-12", unrepresentable: "any", uri: (id) => `#/components/schemas/${id}` }) as { schemas: Record<string, Json> };
      for (const [id, schema] of Object.entries(converted.schemas)) {
        delete schema.$schema;
        delete schema.$id;
        if (out[id] !== undefined) throw new Error(`OpenAPI component ${id} is defined for both requests and responses`);
        out[id] = schema;
      }
    }
    return out;
  }
}

/** Keep only the components reachable from the paths (and from each other). */
function prune(paths: Json, schemas: Record<string, Json>): Record<string, Json> {
  const keep = new Set<string>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (v === null || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Json)) {
      if (k === "$ref" && typeof x === "string" && x.startsWith("#/components/schemas/")) {
        const id = x.slice("#/components/schemas/".length);
        if (!keep.has(id)) {
          keep.add(id);
          visit(schemas[id]);
        }
      } else visit(x);
    }
  };
  visit(paths);
  return Object.fromEntries([...keep].sort().map((id) => [id, schemas[id] ?? {}]));
}

export function buildOpenApiDocument(modules: readonly Type[], version: string, named: Readonly<Record<string, z.ZodType>> = {}): Json {
  const components = new Components(named);
  const paths: Record<string, Record<string, Json>> = {};
  for (const c of controllersOf(modules)) {
    for (const route of routesOfController(c)) {
      if (route.doc === undefined) throw new Error(`${route.controller}.${route.handler} (${route.method.toUpperCase()} ${route.path}) has no @ApiDoc`);
      const handler = (c.prototype as Record<string, unknown>)[route.handler] as object;
      const access = Reflect.getMetadata(ACCESS, handler) as AccessDeclaration | undefined;
      const identity = (Reflect.getMetadata(IDENTITY, handler) ?? Reflect.getMetadata(IDENTITY, c) ?? "INTERNAL") as IdentityRequirement;
      const noOrg = Reflect.getMetadata(NO_ORG, handler) === true;
      const parameters: Json[] = [];
      let requestBody: Json | undefined;
      const operationId = `${route.controller.replace(/Controller$/, "")}_${route.handler}`;
      for (const pipe of pipesOf(c, route.handler)) {
        if (pipe.location === "body") {
          requestBody = { required: true, content: { "application/json": { schema: components.ref(pipe.schema as unknown as z.ZodType, "input", `${operationId}_Request`) } } };
          continue;
        }
        const schema = schemaOf(pipe.schema as unknown as z.ZodType, "input");
        const where = pipe.location === "params" ? "path" : pipe.location === "query" ? "query" : "header";
        const { props, required } = objectProperties(schema);
        for (const name of Object.keys(props).sort()) {
          parameters.push({ name, in: where, required: where === "path" || required.includes(name), schema: props[name] });
        }
      }
      if (route.path.endsWith("/{path}")) parameters.push({ name: "path", in: "path", required: true, description: "The signed file path, exactly as issued (with its query string)", schema: { type: "string" } });
      if (access?.kind !== "public" && !noOrg) parameters.push({ name: "X-Org", in: "header", required: false, description: "The organization to act in (required when the caller belongs to several)", schema: { type: "string", format: "uuid" } });
      if (route.doc.idempotent === true) parameters.push({ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", pattern: "^[!-~]{16,128}$" } });
      if (route.doc.ifMatch !== undefined) parameters.push({ name: "If-Match", in: "header", required: route.doc.ifMatch === "required", description: "The resource's current strong ETag", schema: { type: "string" } });
      const responses: Json = {};
      for (const [status, schema] of Object.entries(route.doc.responses)) {
        responses[status] = schema === "binary"
          ? { description: "The file bytes", content: { "application/octet-stream": { schema: { type: "string", contentMediaType: "application/octet-stream" } } } }
          : { description: Number(status) === 201 ? "Created" : "OK", content: { "application/json": { schema: components.ref(schema, "output", `${operationId}_${status}`) } } };
      }
      responses.default = { description: "RFC 9457 problem", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } };
      const op: Json = {
        operationId,
        summary: route.doc.summary,
        tags: [route.controller.replace(/Controller$/, "")],
        ...(parameters.length > 0 ? { parameters } : {}),
        ...(requestBody === undefined ? {} : { requestBody }),
        responses,
        security: access?.kind === "public" ? [] : [{ bearerAuth: [] }],
        "x-lintel-access": access?.kind === "action" ? { actions: [...access.actions] } : { kind: access?.kind ?? "undeclared" },
        "x-lintel-identity": identity,
      };
      (paths[route.path] ??= {})[route.method] = op;
    }
  }
  const sortedPaths = Object.fromEntries(Object.keys(paths).sort().map((p) => [p, Object.fromEntries(Object.keys(paths[p] ?? {}).sort().map((k) => [k, paths[p]?.[k]]))]));
  const problem = schemaOf(ProblemSchema, "output");
  (problem.properties as Record<string, Json>).code = { type: "string", enum: Object.keys(PROBLEM_CODES).sort() };
  return {
    openapi: "3.1.0",
    info: { title: OPENAPI_TITLE, version, description: "Generated from the API's Zod schemas and route table (pnpm api:openapi). Problem `type` URNs: " + problemType("NOT_FOUND").replace("not-found", "<code>") },
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    servers: [{ url: "/" }],
    paths: sortedPaths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "Supabase Auth access token" } },
      schemas: { ...prune(sortedPaths, components.schemas()), Problem: problem },
    },
  };
}
