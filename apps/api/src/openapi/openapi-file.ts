import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { FEATURE_MODULES } from "../app.js";
import { z } from "zod";
import * as common from "../common/http/schemas.js";
import * as clients from "../modules/clients/clients.schemas.js";
import * as designVersions from "../modules/design-versions/design-versions.schemas.js";
import * as designs from "../modules/designs/designs.schemas.js";
import * as me from "../modules/me/me.schemas.js";
import * as outputs from "../modules/outputs/outputs.schemas.js";
import * as projects from "../modules/projects/projects.schemas.js";
import * as rooms from "../modules/rooms/rooms.schemas.js";
import { buildOpenApiDocument } from "./document.js";

/** Every exported Zod schema of the API's schema modules becomes a named component (first name wins). */
const NAMED: Readonly<Record<string, z.ZodType>> = Object.fromEntries(
  [common, clients, projects, rooms, designs, designVersions, outputs, me].flatMap((m) => Object.entries(m).filter((e): e is [string, z.ZodType] => e[1] instanceof z.ZodType)),
);

/** The committed OpenAPI document. */
export const OPENAPI_PATH = join(dirname(fileURLToPath(import.meta.url)), "../../openapi/openapi.json");

/** The API's version (package.json) is the document's `info.version`. */
function apiVersion(): string {
  const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../package.json"), "utf8")) as { version?: string };
  return pkg.version ?? "0.0.0";
}

/** The document as committed: 2-space JSON with a trailing newline. */
export function openApiJson(): string {
  return `${JSON.stringify(buildOpenApiDocument(FEATURE_MODULES, apiVersion(), NAMED), null, 2)}\n`;
}
