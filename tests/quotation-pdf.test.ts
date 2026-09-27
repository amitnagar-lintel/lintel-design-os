/** The quotation document (PDF) is deterministic and prints the sealed snapshot's figures exactly as stored. */
import { describe, expect, it } from "vitest";
import { inrText, renderQuotationPdf } from "@lintel/pricing-engine";
import type { QuotationDocumentHeader } from "@lintel/pricing-engine";
import { fixtureRoom } from "./support/room.js";
import { quote } from "./support/quotation.js";

const header: QuotationDocumentHeader = {
  quotationNumber: "Q-PR-001-R1", revisionNumber: 1, projectCode: "PR-001", projectName: "Mehta kitchen", siteAddress: { line1: "12 Park Road" },
  clientCode: "CL-001", clientName: "Mehta Residence", clientContact: { phone: "+91 00000 00000" }, roomName: "Kitchen", designVersionNumber: 3,
  designVersionId: "7ad53553-4efb-4d77-997b-d3fa08931f09", purpose: "FOR_PRODUCTION",
};

function quotation() {
  const r = quote(fixtureRoom());
  if (r.status !== "PRICED") throw new Error("fixture quotation unavailable");
  return r.snapshot;
}

describe("quotation PDF", () => {
  it("is a byte-identical PDF for the same snapshot and header, and changes with either", () => {
    const q = quotation();
    const a = renderQuotationPdf(q, header);
    expect(a.startsWith("%PDF-1.4\n")).toBe(true);
    expect(a.endsWith("%%EOF\n")).toBe(true);
    expect(renderQuotationPdf(q, header)).toBe(a);
    expect(renderQuotationPdf(q, { ...header, revisionNumber: 2 })).not.toBe(a);
    expect(Buffer.from(a, "latin1").every((b) => b < 128)).toBe(true);
  });

  it("prints the header, every line (quantity, rate, amount), the tax groups, the totals and the policy terms as stored", () => {
    const q = quotation();
    const pdf = renderQuotationPdf(q, header);
    for (const s of ["Q-PR-001-R1", "Mehta Residence \\(CL-001\\)", "Mehta kitchen \\(PR-001\\)", "12 Park Road", "+91 00000 00000", "FOR_PRODUCTION", q.quotationId, q.contentHash]) expect(pdf).toContain(s);
    for (const l of q.lines) {
      expect(pdf).toContain(l.description);
      expect(pdf).toContain(`(${inrText(l.unitPriceExGst)})`);
      expect(pdf).toContain(`(${inrText(l.taxableAmount)})`);
    }
    for (const g of q.taxGroups) expect(pdf).toContain(`(${inrText(g.taxAmount)})`);
    expect(pdf).toContain(`(${inrText(q.totals.grandTotal)})`);
    expect(pdf).toContain(`quotation policy ${q.policyRef.id}@${q.policyRef.version}`);
    expect(pdf).toContain(`rate card ${q.rateCardRef.id}@${q.rateCardRef.version}`);
  });

  it("formats paise with Indian digit grouping, never rounding", () => {
    expect(inrText(3221500)).toBe("INR 32,215.00");
    expect(inrText(123456789)).toBe("INR 12,34,567.89");
    expect(inrText(-47)).toBe("-INR 0.47");
    expect(inrText(5)).toBe("INR 0.05");
  });
});
