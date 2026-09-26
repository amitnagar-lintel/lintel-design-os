/**
 * Pure layout helpers of the pilot UI. They only place user input (where a cabinet goes along wall A) and scale the
 * API's resolved model for drawing; they never compute construction, validation, quantities or prices.
 */

export interface RunItem {
  readonly id: string;
  readonly x: number;
  readonly width: number;
}

/**
 * "Arrange run": the cabinets of wall A edge to edge in their current left-to-right order, starting at `start`
 * (the leftmost cabinet's current position unless given). Returns only the cabinets whose position changes.
 */
export function arrangeRun(items: readonly RunItem[], start?: number): { id: string; x: number }[] {
  if (items.length === 0) return [];
  const ordered = [...items].sort((a, b) => a.x - b.x || (a.id < b.id ? -1 : 1));
  let x = start ?? Math.max(0, ordered[0]?.x ?? 0);
  const out: { id: string; x: number }[] = [];
  for (const it of ordered) {
    if (it.x !== x) out.push({ id: it.id, x });
    x += it.width;
  }
  return out;
}

/** The next free position at the right end of the run (0 for an empty wall). */
export function nextFreeX(items: readonly RunItem[]): number {
  return items.reduce((m, it) => Math.max(m, it.x + it.width), 0);
}

/** A uniform scale that fits a `w` × `h` millimetre extent into a `boxW` × `boxH` pixel box with `pad` pixels around. */
export function fit(w: number, h: number, boxW: number, boxH: number, pad = 24): { scale: number; ox: number; oy: number } {
  if (w <= 0 || h <= 0) return { scale: 1, ox: pad, oy: pad };
  const scale = Math.min((boxW - 2 * pad) / w, (boxH - 2 * pad) / h);
  return { scale, ox: (boxW - w * scale) / 2, oy: (boxH - h * scale) / 2 };
}

/** Whole millimetres for display, e.g. 4200 → "4200 mm". */
export const mm = (v: number): string => `${String(Math.round(v))} mm`;

/** Paise → "₹12,345.00" (display only; the amount itself comes from the API). */
export function inr(paise: unknown): string {
  if (typeof paise !== "number" || !Number.isFinite(paise)) return "—";
  const rupees = Math.trunc(paise / 100);
  const p = Math.abs(paise % 100);
  return `₹${rupees.toLocaleString("en-IN")}.${String(p).padStart(2, "0")}`;
}
