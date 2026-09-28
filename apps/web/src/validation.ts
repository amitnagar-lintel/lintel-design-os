/**
 * Remediation P0 (Slice 6F follow-up): client-side field validation for the Design Studio's Properties panel.
 * A pinned product's own parameter definitions already carry `min`/`max` (see `screens/Layout.tsx`'s `Param`);
 * this only checks a candidate value against them before Save, so an out-of-range dimension is rejected here
 * instead of being silently persisted and later crashing the decoder (see `packages/cabinet-engine/src/decode.ts`).
 */
export interface DimensionLimit {
  readonly min: number | null;
  readonly max: number | null;
}

export function dimensionError(label: string, valueMm: number, limit: DimensionLimit | undefined): string | null {
  if (!Number.isFinite(valueMm)) return `${label} must be a number`;
  if (limit === undefined) return null;
  if (limit.min !== null && valueMm < limit.min) return `${label} must be at least ${limit.min} mm (got ${valueMm})`;
  if (limit.max !== null && valueMm > limit.max) return `${label} must be at most ${limit.max} mm (got ${valueMm})`;
  return null;
}
