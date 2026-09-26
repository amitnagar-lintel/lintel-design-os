/**
 * Which environment the pilot commands act on (LOCAL / STAGING / PRODUCTION), decided from the URLs themselves, never
 * from a default that could reach production. Pure.
 *
 * - PILOT_ENV names the environment; unset means LOCAL.
 * - LOCAL accepts only loopback database, API and UI URLs. Anything else refuses and asks for PILOT_ENV.
 * - STAGING / PRODUCTION additionally need `--confirm <database identity>` (the Supabase project ref), exactly like the
 *   migration runner, and a hosted database is never accepted as LOCAL.
 */
import { RefusedError, targetOf } from "../target.js";

export const PILOT_ENVS = ["LOCAL", "STAGING", "PRODUCTION"] as const;
export type PilotEnv = (typeof PILOT_ENVS)[number];

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
export const isLoopback = (url: string): boolean => {
  try {
    return LOOPBACK.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
};

export interface Classified {
  readonly env: PilotEnv;
  /** host:port/database of the database, or null when none is configured. */
  readonly database: string | null;
  readonly databaseIdentity: string | null;
  readonly databaseHosted: boolean;
  readonly apiUrl: string;
  readonly webUrl: string;
}

export function classify(e: NodeJS.ProcessEnv, confirm: string | undefined): Classified {
  const declared = (e.PILOT_ENV ?? "LOCAL").toUpperCase();
  if (!(PILOT_ENVS as readonly string[]).includes(declared)) throw new RefusedError("USAGE", `PILOT_ENV must be one of ${PILOT_ENVS.join(", ")}`);
  const env = declared as PilotEnv;
  const apiUrl = e.PILOT_API_URL ?? "http://127.0.0.1:3000";
  const webUrl = e.PILOT_WEB_URL ?? "http://127.0.0.1:5173";
  const dbUrl = e.MIGRATION_DATABASE_URL;
  const target = dbUrl === undefined || dbUrl === "" ? null : targetOf(dbUrl);
  if (env === "LOCAL") {
    const remote = [
      ...(target !== null && (target.hosted || !isLoopback(dbUrl ?? "")) ? [`database ${target.display}`] : []),
      ...(isLoopback(apiUrl) ? [] : [`API ${apiUrl}`]),
      ...(isLoopback(webUrl) ? [] : [`UI ${webUrl}`]),
    ];
    if (remote.length > 0) throw new RefusedError("GUARD", `PILOT_ENV is LOCAL but ${remote.join(", ")} is not on this machine: set PILOT_ENV=STAGING or PRODUCTION (with --confirm) deliberately`);
  } else {
    if (target === null) throw new RefusedError("USAGE", `PILOT_ENV=${env} needs MIGRATION_DATABASE_URL (the direct connection of that environment)`);
    if (target.pooled) throw new RefusedError("GUARD", "a Supabase pooler connection is never used by the pilot tools: use the direct connection");
    if (confirm === undefined) throw new RefusedError("GUARD", `PILOT_ENV=${env} needs --confirm ${target.identity}`);
    if (confirm.toLowerCase() !== target.identity) throw new RefusedError("GUARD", `--confirm ${confirm} does not match the database ${target.identity}`);
    if (isLoopback(apiUrl) || isLoopback(webUrl)) throw new RefusedError("GUARD", `PILOT_ENV=${env} with a loopback API or UI URL: set PILOT_API_URL and PILOT_WEB_URL to the ${env.toLowerCase()} deployment`);
  }
  return { env, database: target?.display ?? null, databaseIdentity: target?.identity ?? null, databaseHosted: target?.hosted ?? false, apiUrl, webUrl };
}
