/**
 * The quotation document: a deterministic, dependency-free PDF 1.4 of one sealed QuotationSnapshot (A4 portrait,
 * standard Helvetica, ASCII only). Presentation only: every amount, quantity, rate, tax and total is printed exactly as
 * the quotation engine stored it; nothing is recomputed, rounded or re-priced here. No clock: the date printed is the
 * snapshot's own `createdAt`, so the same snapshot and header always give byte-identical files.
 *
 * The terms printed are only those the quotation model represents (tax policy and rates, rounding, discount policy,
 * the exact rate card / pricing rules / quotation policy versions). Nothing else is invented.
 */
import type { QuotationSnapshot } from "@lintel/types";
import { QUOTATION_ENGINE_VERSION } from "./quotation.js";

/** Facts of the quotation document that come from records, not from the pricing model. */
export interface QuotationDocumentHeader {
  /** Human quotation number, e.g. the project code and revision. */
  readonly quotationNumber: string;
  readonly revisionNumber: number;
  readonly projectCode: string;
  readonly projectName: string;
  readonly siteAddress: Readonly<Record<string, string>> | null;
  readonly clientCode: string | null;
  readonly clientName: string | null;
  readonly clientContact: Readonly<Record<string, string>> | null;
  readonly roomName: string;
  readonly designVersionNumber: number;
  readonly designVersionId: string;
  /** The output purpose (FOR_PRODUCTION for an issuable quotation). */
  readonly purpose: string;
}

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 42;
const LINES_FIRST_PAGE = 18;
const LINES_PER_PAGE = 34;

/** WinAnsi-safe ASCII: anything else becomes "?" (the PDF must never depend on a font's glyph coverage). */
export function pdfAscii(s: string): string {
  return s.replace(/[^\x20-\x7e]/g, "?");
}
const pdfString = (s: string): string => `(${pdfAscii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
const n = (v: number): string => (Math.round(v * 100) / 100).toFixed(2).replace(/\.?0+$/, "");

/** Paise → "INR 12,34,567.89" (Indian digit grouping), as stored; sign preserved. */
export function inrText(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  const rupees = String(Math.trunc(abs / 100));
  const last3 = rupees.slice(-3);
  const rest = rupees.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${sign}INR ${rest === "" ? last3 : `${rest},${last3}`}.${String(abs % 100).padStart(2, "0")}`;
}

/** Approximate Helvetica advance widths (1/1000 em), for right alignment only. */
function widthPt(s: string, size: number, bold: boolean): number {
  let w = 0;
  for (const ch of s) {
    if (ch === " ") w += 278;
    else if (/[0-9]/.test(ch)) w += 556;
    else if (/[A-Z]/.test(ch)) w += ch === "I" ? 278 : ch === "M" || ch === "W" ? 833 : 667;
    else if (/[a-z]/.test(ch)) w += ch === "i" || ch === "l" || ch === "j" ? 222 : ch === "m" || ch === "w" ? 833 : 500;
    else if (".,:;!|'".includes(ch)) w += 278;
    else w += 333;
  }
  return (w * size * (bold ? 1.06 : 1)) / 1000;
}

class Page {
  readonly ops: string[] = [];
  text(x: number, y: number, s: string, o: { size?: number; bold?: boolean; align?: "left" | "right" } = {}): void {
    const size = o.size ?? 9;
    const bold = o.bold ?? false;
    const t = pdfAscii(s);
    const left = o.align === "right" ? x - widthPt(t, size, bold) : x;
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${n(size)} Tf ${n(left)} ${n(PAGE_H - y)} Td ${pdfString(t)} Tj ET`);
  }
  line(x1: number, y1: number, x2: number, y2: number, width = 0.5): void {
    this.ops.push(`${n(width)} w ${n(x1)} ${n(PAGE_H - y1)} m ${n(x2)} ${n(PAGE_H - y2)} l S`);
  }
}

const kv = (r: Readonly<Record<string, string>> | null): string =>
  r === null ? "-" : Object.keys(r).sort().map((k) => r[k] ?? "").filter((v) => v.trim() !== "").join(", ") || "-";

/** Columns of the line table: x of the left edge (text) or right edge (numbers). */
const COL = { no: MARGIN, item: MARGIN + 26, qty: 330, rate: 415, tax: 455, amount: PAGE_W - MARGIN };

function lineHeader(p: Page, y: number): void {
  p.text(COL.no, y, "#", { bold: true });
  p.text(COL.item, y, "Item", { bold: true });
  p.text(COL.qty, y, "Qty", { bold: true, align: "right" });
  p.text(COL.rate, y, "Rate (ex tax)", { bold: true, align: "right" });
  p.text(COL.tax, y, "Tax %", { bold: true, align: "right" });
  p.text(COL.amount, y, "Taxable amount", { bold: true, align: "right" });
  p.line(MARGIN, y + 4, PAGE_W - MARGIN, y + 4);
}

/** Render the quotation document. Returns the PDF as a latin1/ASCII string (store it with latin1 encoding). */
export function renderQuotationPdf(q: QuotationSnapshot, h: QuotationDocumentHeader): string {
  const pages: Page[] = [];
  const chunks: (typeof q.lines)[] = [];
  chunks.push(q.lines.slice(0, LINES_FIRST_PAGE));
  for (let i = LINES_FIRST_PAGE; i < q.lines.length; i += LINES_PER_PAGE) chunks.push(q.lines.slice(i, i + LINES_PER_PAGE));
  const date = q.createdAt.slice(0, 10);

  chunks.forEach((lines, pageIndex) => {
    const p = new Page();
    pages.push(p);
    let y = MARGIN + 10;
    p.text(MARGIN, y, "QUOTATION", { size: 18, bold: true });
    p.text(PAGE_W - MARGIN, y, `${h.quotationNumber}  (revision ${String(h.revisionNumber)})`, { size: 10, bold: true, align: "right" });
    y += 16;
    p.text(PAGE_W - MARGIN, y, `Date ${date}  |  ${h.purpose}  |  ${q.classification}`, { size: 8, align: "right" });
    if (pageIndex === 0) {
      y += 22;
      const left: [string, string][] = [
        ["Client", `${h.clientName ?? "-"}${h.clientCode === null ? "" : ` (${h.clientCode})`}`],
        ["Contact", kv(h.clientContact)],
        ["Project", `${h.projectName} (${h.projectCode})`],
        ["Site", kv(h.siteAddress)],
        ["Room", h.roomName],
        ["Design version", `v${String(h.designVersionNumber)}  ${h.designVersionId}`],
      ];
      for (const [k, v] of left) {
        p.text(MARGIN, y, k, { bold: true });
        p.text(MARGIN + 90, y, v);
        y += 13;
      }
      y += 10;
    } else {
      y += 22;
    }
    lineHeader(p, y);
    y += 16;
    for (const l of lines) {
      p.text(COL.no, y, String(l.lineNo));
      p.text(COL.item, y, l.description.slice(0, 60));
      p.text(COL.qty, y, n(l.quantity), { align: "right" });
      p.text(COL.rate, y, inrText(l.unitPriceExGst), { align: "right" });
      p.text(COL.tax, y, n(l.taxPercent), { align: "right" });
      p.text(COL.amount, y, inrText(l.taxableAmount), { align: "right" });
      y += 11;
      p.text(COL.item, y, `${l.productId}  |  ${l.objectCode}  |  tax ${l.taxRateId}${l.lineTax === null ? "" : `  |  line tax ${inrText(l.lineTax)}`}`, { size: 7 });
      y += 13;
    }
    if (pageIndex === chunks.length - 1) {
      p.line(MARGIN, y - 4, PAGE_W - MARGIN, y - 4);
      y += 8;
      p.text(MARGIN, y, "Tax", { bold: true });
      y += 13;
      for (const g of q.taxGroups) {
        p.text(MARGIN, y, `${g.taxRateId} @ ${n(g.percent)}% on ${inrText(g.taxableAmount)} (lines ${g.lineNos.join(", ")})`);
        p.text(COL.amount, y, inrText(g.taxAmount), { align: "right" });
        y += 12;
      }
      y += 6;
      const t = q.totals;
      const totals: [string, number, boolean][] = [
        ["Taxable amount", t.taxableAmount, false], ["Discount", t.discountAmount, false], ["Tax", t.taxAmount, false],
        ["Total before rounding", t.totalBeforeRounding, false], ["Rounding adjustment", t.roundingAdjustment, false], ["GRAND TOTAL", t.grandTotal, true],
      ];
      for (const [label, value, bold] of totals) {
        p.text(COL.rate, y, label, { bold, align: "right", size: bold ? 11 : 9 });
        p.text(COL.amount, y, inrText(value), { bold, align: "right", size: bold ? 11 : 9 });
        y += bold ? 16 : 12;
      }
      y += 12;
      p.text(MARGIN, y, "Terms (from the quotation policy of record)", { bold: true });
      y += 13;
      const r = q.policy.rounding;
      const terms = [
        `Currency ${q.currency}. Amounts in rupees; rates exclude tax.`,
        `Tax: ${q.policy.taxPolicy ?? "-"}; rates ${Object.keys(q.policy.taxRates).sort().map((k) => `${k} ${String(q.policy.taxRates[k] ?? "-")}%`).join(", ") || "-"}.`,
        `Rounding: tax ${r.tax === null ? "-" : `${r.tax.mode} to ${String(r.tax.incrementPaise)} paise`}; grand total ${r.grandTotal === null ? "-" : `${r.grandTotal.mode} to ${String(r.grandTotal.incrementPaise)} paise`}.`,
        `Discount policy: ${q.policy.discountPolicy?.mode ?? "-"}.`,
        `Basis: quotation policy ${q.policyRef.id}@${q.policyRef.version};`,
        `rate card ${q.rateCardRef.id}@${q.rateCardRef.version}; pricing rules ${q.pricingRulesRef.id}@${q.pricingRulesRef.version}.`,
      ];
      for (const s of terms) {
        p.text(MARGIN, y, s, { size: 8 });
        y += 11;
      }
    }
    p.line(MARGIN, PAGE_H - MARGIN + 6, PAGE_W - MARGIN, PAGE_H - MARGIN + 6, 0.3);
    p.text(MARGIN, PAGE_H - MARGIN + 18, `Quotation ${q.quotationId}  |  seal ${q.contentHash}  |  room ${q.roomFingerprint}`, { size: 6 });
    p.text(PAGE_W - MARGIN, PAGE_H - MARGIN + 18, `Page ${String(pageIndex + 1)} of ${String(chunks.length)}`, { size: 6, align: "right" });
  });

  const objects: string[] = [];
  const add = (body: string): number => { objects.push(body); return objects.length; };
  const catalog = add("");
  const pagesId = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds = pages.map((p) => {
    const stream = p.ops.join("\n");
    const contentId = add(`<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent ${String(pagesId)} 0 R /MediaBox [0 0 ${n(PAGE_W)} ${n(PAGE_H)}] /Resources << /Font << /F1 ${String(f1)} 0 R /F2 ${String(f2)} 0 R >> >> /Contents ${String(contentId)} 0 R >>`);
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${String(pagesId)} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((i) => `${String(i)} 0 R`).join(" ")}] /Count ${String(pageIds.length)} >>`;
  const info = add(`<< /Title ${pdfString(`Quotation ${h.quotationNumber} rev ${String(h.revisionNumber)}`)} /Producer ${pdfString(`Lintel Design OS quotation ${QUOTATION_ENGINE_VERSION}`)} /Subject ${pdfString(`${q.quotationId} hash=${q.contentHash}`)} >>`);

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${String(i + 1)} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const o of offsets) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${String(objects.length + 1)} /Root ${String(catalog)} 0 R /Info ${String(info)} 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return out;
}
