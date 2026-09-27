import type { Appliance } from "@lintel/types";

/**
 * Reference appliance data (Design Studio Slice 5 step 3), exactly like `materials.ts`'s `MATERIALS`/`FINISHES`:
 * a plausible V1 engineering placeholder, not a Lintel-approved or manufacturer-verified specification —
 * `status: "DRAFT"`, never `"APPROVED"`, until an organization supplies and approves a real value through the
 * same intake/approval workflow every other reference-data item goes through. No real manufacturer dimensions
 * are invented (CLAUDE.md); this is a single generic single-oven size, common enough across manufacturers to
 * serve as a development placeholder, deliberately not attributed to any specific make or model.
 */
export const APPLIANCES: readonly Appliance[] = [
  {
    applianceId: "OVEN_REFERENCE_60CM",
    category: "OVEN",
    make: null,
    model: null,
    dimensions: { widthMm: 595, heightMm: 595, depthMm: 550 },
    installation: { widthMm: 560, heightMm: 585, depthMm: 550, clearances: [] },
    ventilation: null,
    frontAlignment: "FLUSH",
    status: "DRAFT",
    source: "V1 reference value — not a Lintel-approved or manufacturer-verified appliance specification.",
  },
  {
    applianceId: "HOB_REFERENCE_60CM",
    category: "HOB",
    make: null,
    model: null,
    dimensions: { widthMm: 595, heightMm: 55, depthMm: 510 },
    installation: { widthMm: 560, heightMm: 120, depthMm: 490, clearances: [] },
    ventilation: null,
    frontAlignment: "FLUSH",
    status: "DRAFT",
    source: "V1 reference value — not a Lintel-approved or manufacturer-verified appliance specification.",
  },
];
