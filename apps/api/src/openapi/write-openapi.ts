/**
 * `pnpm api:openapi`: write the OpenAPI 3.1 document of the running route table to apps/api/openapi/openapi.json.
 * The committed file is checked by a drift test (apps/api/test/unit/openapi.test.ts).
 */
import "reflect-metadata";
import { writeFileSync } from "node:fs";
import { OPENAPI_PATH, openApiJson } from "./openapi-file.js";

writeFileSync(OPENAPI_PATH, openApiJson());
process.stdout.write(`wrote ${OPENAPI_PATH}\n`);
