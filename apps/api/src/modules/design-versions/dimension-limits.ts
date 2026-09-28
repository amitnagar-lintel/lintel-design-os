import type { Tx } from "../../common/db/tx.js";
import type { FieldError } from "../../common/errors/api-problem.js";
import { referenceDataRepository } from "../../infrastructure/persistence/reference-data.repository.js";

/**
 * Remediation (Slice 6F follow-up, hardening): the pinned product's own width/height/depth limits, moved to the
 * authoritative backend path — the exact same source `apps/web/src/validation.ts`'s client-side check reads
 * (`product_version.definition.parameters[].min/max`), so the client and the API enforce identical rules without
 * either inventing a limit the catalog doesn't declare. The client stays responsible for immediate feedback; this
 * is what actually rejects a bad value, whatever it comes from (UI, a direct API call, or any future caller).
 */
export interface DimensionLimit {
  readonly min: number | null;
  readonly max: number | null;
}

const DIMENSION_KEYS = ["width", "height", "depth"] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

function limitOf(parameters: unknown, key: DimensionKey): DimensionLimit {
  const p = Array.isArray(parameters) ? parameters.find((x): x is Record<string, unknown> => typeof x === "object" && x !== null && (x as Record<string, unknown>).key === key) : undefined;
  return { min: typeof p?.min === "number" ? p.min : null, max: typeof p?.max === "number" ? p.max : null };
}

/** `null` when the product version itself can't be read — a different, pre-existing concern (e.g. an unknown
 * productVersionId) this function does not duplicate; the caller then simply has nothing to check against. */
export async function productDimensionLimits(tx: Tx, productVersionId: string): Promise<Readonly<Record<DimensionKey, DimensionLimit>> | null> {
  const v = await referenceDataRepository.version(tx, "product", productVersionId);
  if (v === null) return null;
  const parameters = (v.content as { definition?: { parameters?: unknown } }).definition?.parameters;
  return Object.fromEntries(DIMENSION_KEYS.map((key) => [key, limitOf(parameters, key)])) as Record<DimensionKey, DimensionLimit>;
}

/** Field errors for any dimension outside its declared limit — empty when every dimension is within range, or has
 * no declared limit at all (CLAUDE.md "do not invent construction dimensions" applies to limits too: an
 * undeclared min/max never blocks a value). */
export function dimensionFieldErrors(
  dimensions: { readonly widthMm: number; readonly heightMm: number; readonly depthMm: number },
  limits: Readonly<Record<DimensionKey, DimensionLimit>>,
): FieldError[] {
  const checks: readonly [DimensionKey, number][] = [["width", dimensions.widthMm], ["height", dimensions.heightMm], ["depth", dimensions.depthMm]];
  const errors: FieldError[] = [];
  for (const [key, value] of checks) {
    const { min, max } = limits[key];
    const path = `body.dimensions.${key}Mm`;
    if (min !== null && value < min) errors.push({ path, code: "out_of_range", message: `must be at least ${String(min)} mm (got ${String(value)})` });
    else if (max !== null && value > max) errors.push({ path, code: "out_of_range", message: `must be at most ${String(max)} mm (got ${String(value)})` });
  }
  return errors;
}
