/** Deterministic number formatting for drawings (no locale, trailing zeros trimmed). */
export function fmt(value: number, decimals = 2): string {
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  const s = (r === 0 ? 0 : r).toFixed(decimals);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/** Coordinates in SVG/PDF output (3 decimals of a millimetre / point). */
export const coord = (v: number): string => fmt(v, 3);

const REPLACEMENTS: Readonly<Record<string, string>> = { "×": "x", "—": "-", "–": "-", "≠": "!=", "≤": "<=", "≥": ">=", "₹": "INR ", "→": "->", "·": "-" };

/** Drawing text is ASCII only so SVG and PDF standard fonts render identically. */
export function ascii(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= 32 && code <= 126) out += ch;
    else out += REPLACEMENTS[ch] ?? "?";
  }
  return out;
}
