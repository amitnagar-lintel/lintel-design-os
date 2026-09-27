/**
 * Entry module of the `quotation` output engine: quoteRoom (always PRODUCTION mode) from the resolved room model, an
 * exact stored room BOQ and room pricing (consumed, never re-priced) and the explicitly chosen QuotationPolicy
 * version. Every financial rule (tax, grouping, rounding, totals) is the engine's; nothing is decided here.
 */
import type { QuotationPolicyRows } from "@lintel/persistence";
import { quotationPolicyFromRows } from "@lintel/persistence";
import type { QuotationResult } from "@lintel/pricing-engine";
import { quoteRoom, renderQuotationPdf } from "@lintel/pricing-engine";
import type { CatalogSnapshot, QuotationSnapshot, ResolvedRoom, RoomBOQ, RoomPriceSnapshot } from "@lintel/types";
import type { RenderedFile } from "./drawing.js";

export { engineeringModel, resolveEngineeringModel } from "./validation.js";

export function roomQuotation(input: {
  readonly resolved: ResolvedRoom; readonly catalog: CatalogSnapshot; readonly boq: RoomBOQ; readonly pricing: RoomPriceSnapshot;
  readonly quotationPolicy: QuotationPolicyRows; readonly revision: string; readonly createdAt: string;
}): QuotationResult {
  const policy = quotationPolicyFromRows(input.quotationPolicy).value;
  return quoteRoom({ mode: "PRODUCTION", room: input.resolved, roomBoq: input.boq, pricing: input.pricing, policy, catalog: input.catalog, revision: input.revision, createdAt: input.createdAt });
}

/** Records the quotation document prints (project, site, client, room, design version number). */
export interface QuotationDocumentFacts {
  readonly project_code: string;
  readonly project_name: string;
  readonly site_address: Readonly<Record<string, string>> | null;
  readonly client_code: string | null;
  readonly client_name: string | null;
  readonly client_contact: Readonly<Record<string, string>> | null;
  readonly version_number: number;
  readonly room_name: string;
}

/**
 * The quotation document: the engine's PDF of the sealed quotation with its project / client records. Mapping only;
 * every figure is the quotation's. The quotation number is the project code and the quotation revision.
 */
export function quotationDocument(q: QuotationSnapshot, r: QuotationDocumentFacts, revisionNumber: number, purpose: string, designVersionId: string): RenderedFile {
  const pdf = renderQuotationPdf(q, {
    quotationNumber: `Q-${r.project_code}-R${String(revisionNumber)}`, revisionNumber, projectCode: r.project_code, projectName: r.project_name, siteAddress: r.site_address,
    clientCode: r.client_code, clientName: r.client_name, clientContact: r.client_contact, roomName: r.room_name, designVersionNumber: r.version_number, designVersionId, purpose,
  });
  return { format: "PDF", sheetIndex: null, bytes: new Uint8Array(Buffer.from(pdf, "latin1")) };
}
