import type {
  BOM,
  BOQ,
  BoqItemPrice,
  DataClassification,
  PriceLine,
  PriceSnapshot,
  PriceTotals,
  PricingResult,
  PricingRuleSet,
  RateCard,
  ResolvedCabinet,
  ValidationMessage,
  VersionRef,
} from "@lintel/types";
import { deepFreeze, hash53, stableStringify } from "@lintel/types";
import { buildValidationResult, evaluateNumber } from "@lintel/rules-engine";
import { modelFingerprint } from "@lintel/design-engine";
import { amountFor, inrToPaise, MoneyError, percentOf, percentToBasisPoints, roundDiv, toSafeNumber } from "./money.js";

export const PRICING_ENGINE_VERSION = "0.1.0";

export interface PriceCabinetInput {
  /** Requested pricing classification. Data of the other classification is refused, never substituted. */
  readonly mode: DataClassification;
  readonly resolved: ResolvedCabinet;
  readonly bom: BOM;
  readonly boq: BOQ;
  readonly rateCard: RateCard;
  readonly rules: PricingRuleSet;
  /** Supplied by the caller (ISO timestamp) — the engine never reads the clock. */
  readonly createdAt: string;
}

/** Variables available to `PricingRuleSet.manufacturingCost`. */
export const MANUFACTURING_VARIABLES = ["PANEL_COUNT", "BOARD_AREA_M2", "EDGE_LENGTH_M", "FINISH_AREA_M2", "HARDWARE_UNITS"] as const;

function block(code: string, message: string, path?: string): ValidationMessage {
  return path === undefined ? { code, severity: "BLOCKER", message } : { code, severity: "BLOCKER", message, path };
}

/** Deep copy of JSON-safe data (engines stay free of environment-specific globals). */
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const refOf = (id: string, version: string, status: VersionRef["status"]): VersionRef => ({ id, version, status });

/** Checks that decide whether pricing is available at all. Every failure is reported. */
function gate(input: PriceCabinetInput): ValidationMessage[] {
  const { mode, resolved, bom, boq, rateCard, rules } = input;
  const out: ValidationMessage[] = [];

  // Never mix classifications (production safety rule).
  if (rateCard.classification !== mode) out.push(block("PRICING_CLASSIFICATION_MISMATCH", `Rate card ${rateCard.rateCardId} is ${rateCard.classification}; ${mode} pricing refuses it`, "rateCard"));
  if (rules.classification !== mode) out.push(block("PRICING_CLASSIFICATION_MISMATCH", `Pricing rules ${rules.ruleSetId} are ${rules.classification}; ${mode} pricing refuses them`, "rules"));
  if (rateCard.classification === "TEST_FIXTURE" && rateCard.status !== "TEST_FIXTURE") out.push(block("PRICING_DATA_MISLABELLED", `Rate card ${rateCard.rateCardId}: TEST_FIXTURE classification requires TEST_FIXTURE status`, "rateCard.status"));
  if (rules.classification === "TEST_FIXTURE" && rules.status !== "TEST_FIXTURE") out.push(block("PRICING_DATA_MISLABELLED", `Rules ${rules.ruleSetId}: TEST_FIXTURE classification requires TEST_FIXTURE status`, "rules.status"));

  if (mode === "PRODUCTION") {
    if (resolved.trace.dataClassification !== "PRODUCTION") {
      out.push(block("PRICING_TEST_FIXTURE_DESIGN_DATA", `Design uses TEST_FIXTURE data (${resolved.trace.testFixtureSources.join("; ")}); production pricing refused`, "resolved.trace"));
    }
    if (rateCard.status !== "APPROVED") out.push(block("PRICING_RATE_CARD_NOT_APPROVED", `Rate card ${rateCard.rateCardId} v${rateCard.version} is ${rateCard.status}`, "rateCard.status"));
    if (rules.status !== "APPROVED") out.push(block("PRICING_RULES_NOT_APPROVED", `Pricing rules ${rules.ruleSetId} v${rules.version} are ${rules.status}`, "rules.status"));
    if (!resolved.validation.canApprove) {
      out.push(block("PRICING_DESIGN_BLOCKED", `Production catalog/design not approved: ${resolved.validation.counts.BLOCKER} design BLOCKER(s) outstanding`, "resolved.validation"));
    }
  }

  // Artifacts must all derive from the same resolved model.
  const t = resolved.trace;
  if (bom.trace.designVersionId !== t.designVersionId || bom.trace.objectId !== t.objectId) out.push(block("PRICING_TRACE_MISMATCH", `BOM ${bom.bomId} was not derived from this design`, "bom"));
  if (boq.trace.designVersionId !== t.designVersionId || boq.trace.objectId !== t.objectId) out.push(block("PRICING_TRACE_MISMATCH", `BOQ ${boq.boqId} was not derived from this design`, "boq"));
  if (boq.items.some((i) => i.linkedBomId !== bom.bomId)) out.push(block("PRICING_TRACE_MISMATCH", `BOQ ${boq.boqId} is not linked to BOM ${bom.bomId}`, "boq"));
  if (boq.items.length !== 1) out.push(block("PRICING_BOQ_SHAPE_UNSUPPORTED", `M2 prices one BOQ item per object (got ${boq.items.length})`, "boq.items"));
  if (bom.incomplete) out.push(block("PRICING_BOM_INCOMPLETE", `BOM ${bom.bomId} is incomplete (missing components or unresolved hardware); nothing is priced at zero`, "bom"));

  // Every rule value must be verified.
  const ruleFields: [string, unknown][] = [
    ["manufacturingCost", rules.manufacturingCost],
    ["wastagePercent.board", rules.wastagePercent.board],
    ["wastagePercent.edgeBand", rules.wastagePercent.edgeBand],
    ["wastagePercent.finish", rules.wastagePercent.finish],
    ["overheadPercent", rules.overheadPercent],
    ["marginBasis", rules.marginBasis],
    ["marginPercent", rules.marginPercent],
    ["gstPercent", rules.gstPercent],
  ];
  for (const [field, v] of ruleFields) if (v === null) out.push(block("PRICING_RULE_UNVERIFIED", `Pricing rule ${field} is NULL / UNVERIFIED in ${rules.ruleSetId}`, `rules.${field}`));
  for (const [field, v] of ruleFields) {
    if (typeof v === "number") {
      try {
        percentToBasisPoints(v);
      } catch (e) {
        out.push(block("PRICING_RULE_INVALID", `rules.${field}: ${(e as Error).message}`, `rules.${field}`));
      }
    }
  }
  if (rules.marginBasis === "MARGIN_ON_PRICE" && rules.marginPercent !== null && rules.marginPercent >= 100) {
    out.push(block("PRICING_RULE_INVALID", "Margin on price must be below 100%", "rules.marginPercent"));
  }

  // Every priced BOM line needs a verified rate.
  const need = (table: Readonly<Record<string, number | null>>, key: string, path: string): void => {
    if (!Object.prototype.hasOwnProperty.call(table, key)) out.push(block("PRICING_RATE_MISSING", `No rate for ${key} in ${rateCard.rateCardId}`, `${path}.${key}`));
    else {
      const v = table[key];
      if (v === null || v === undefined) out.push(block("PRICING_RATE_UNVERIFIED", `Rate for ${key} is NULL / UNVERIFIED in ${rateCard.rateCardId}`, `${path}.${key}`));
      else {
        try {
          inrToPaise(v);
        } catch (e) {
          out.push(block("PRICING_RATE_INVALID", `${path}.${key}: ${(e as Error).message}`, `${path}.${key}`));
        }
      }
    }
  };
  for (const item of bom.items) {
    switch (item.kind) {
      case "BOARD":
        need(rateCard.boardPerM2, item.materialId, "rateCard.boardPerM2");
        break;
      case "EDGE_BAND":
        need(rateCard.edgeBandPerM, item.edgeBandId, "rateCard.edgeBandPerM");
        break;
      case "FINISH":
        need(rateCard.finishPerM2, item.finishId, "rateCard.finishPerM2");
        break;
      case "HARDWARE":
        if (item.status === "RESOLVED" && item.articleNumber !== null) need(rateCard.hardwarePerUnit, `${item.manufacturer}:${item.articleNumber}`, "rateCard.hardwarePerUnit");
        break;
      // An appliance is referenced reference data, never a priced BOM line (design doc §8): not proposed here.
      case "PANEL":
      case "APPLIANCE":
        break;
    }
  }
  return out;
}

const rateOf = (table: Readonly<Record<string, number | null>>, key: string): number => {
  const v = table[key];
  if (v === null || v === undefined) throw new MoneyError(`rate ${key} missing after gate`);
  return v;
};
const num = (v: number | null, field: string): number => {
  if (v === null) throw new MoneyError(`${field} missing after gate`);
  return v;
};

/**
 * Price one resolved cabinet (PRD §23):
 * material + finish + hardware + manufacturing + wastage → direct cost; + overhead → cost;
 * + margin → selling price ex GST; + GST → selling price inc GST.
 * Returns an immutable PriceSnapshot, or UNAVAILABLE with every blocker. Pure.
 */
export function priceCabinet(input: PriceCabinetInput): PricingResult {
  const blockers = gate(input);
  const { mode, resolved, bom, boq, rateCard, rules } = input;
  if (blockers.length > 0) return { status: "UNAVAILABLE", classification: mode, blockers: buildValidationResult(blockers).messages };

  const lines: PriceLine[] = [];
  let board = 0n;
  let edge = 0n;
  let finish = 0n;
  let hardware = 0n;
  const measures = { PANEL_COUNT: 0, BOARD_AREA_M2: 0, EDGE_LENGTH_M: 0, FINISH_AREA_M2: 0, HARDWARE_UNITS: 0 };

  for (const item of bom.items) {
    switch (item.kind) {
      case "PANEL":
        measures.PANEL_COUNT += item.quantity;
        break;
      case "BOARD": {
        const rate = rateOf(rateCard.boardPerM2, item.materialId);
        const amount = amountFor(item.quantity, rate);
        board += amount;
        measures.BOARD_AREA_M2 += item.quantity;
        lines.push({ lineId: `PL:MATERIAL:BOARD:${item.materialId}`, category: "MATERIAL", description: `${item.materialId} board`, sourceBomItemIds: [item.bomItemId], quantity: item.quantity, unit: "M2", rate, amount: toSafeNumber(amount) });
        break;
      }
      case "EDGE_BAND": {
        const rate = rateOf(rateCard.edgeBandPerM, item.edgeBandId);
        const amount = amountFor(item.quantity, rate);
        edge += amount;
        measures.EDGE_LENGTH_M += item.quantity;
        lines.push({ lineId: `PL:MATERIAL:EDGE:${item.edgeBandId}`, category: "MATERIAL", description: `${item.edgeBandId} edge band`, sourceBomItemIds: [item.bomItemId], quantity: item.quantity, unit: "M", rate, amount: toSafeNumber(amount) });
        break;
      }
      case "FINISH": {
        const rate = rateOf(rateCard.finishPerM2, item.finishId);
        const amount = amountFor(item.quantity, rate);
        finish += amount;
        measures.FINISH_AREA_M2 += item.quantity;
        lines.push({ lineId: `PL:FINISH:${item.finishId}`, category: "FINISH", description: `${item.finishId} finish`, sourceBomItemIds: [item.bomItemId], quantity: item.quantity, unit: "M2", rate, amount: toSafeNumber(amount) });
        break;
      }
      case "HARDWARE": {
        const key = `${item.manufacturer}:${item.articleNumber ?? ""}`;
        const rate = rateOf(rateCard.hardwarePerUnit, key);
        const amount = amountFor(item.quantity, rate);
        hardware += amount;
        measures.HARDWARE_UNITS += item.quantity;
        lines.push({ lineId: `PL:HARDWARE:${key}`, category: "HARDWARE", description: item.description, sourceBomItemIds: [item.bomItemId], quantity: item.quantity, unit: "NOS", rate, amount: toSafeNumber(amount) });
        break;
      }
      // An appliance is referenced reference data, never a priced BOM line (design doc §8): not proposed here.
      case "APPLIANCE":
        break;
    }
  }

  // Manufacturing: data-driven formula over BOM measures (INR → paise, half up).
  const mScope = Object.fromEntries(Object.entries(measures).map(([k, v]) => [k, Number(v.toFixed(6))]));
  const formula = rules.manufacturingCost ?? "";
  const m = evaluateNumber(formula, mScope);
  if (!m.ok || m.value < 0) {
    return {
      status: "UNAVAILABLE",
      classification: mode,
      blockers: [block("PRICING_RULE_INVALID", `Manufacturing cost formula failed: ${m.ok ? `negative result ${m.value}` : m.error.message}`, "rules.manufacturingCost")],
    };
  }
  // Formula result (INR) is fixed at micro-INR, then rounded half up to paise.
  const manufacturing = roundDiv(BigInt(Math.round(m.value * 1e6)) * 100n, 1_000_000n);
  lines.push({ lineId: "PL:MANUFACTURING", category: "MANUFACTURING", description: `Manufacturing (${formula})`, sourceBomItemIds: bom.items.filter((i) => i.kind === "PANEL").map((i) => i.bomItemId), quantity: 1, unit: "LUMP", rate: null, amount: toSafeNumber(manufacturing) });

  // Wastage (percentage of the measured material / finish cost).
  const w = rules.wastagePercent;
  const wastageParts: [string, bigint, number][] = [
    ["BOARD", board, num(w.board, "wastage.board")],
    ["EDGE_BAND", edge, num(w.edgeBand, "wastage.edgeBand")],
    ["FINISH", finish, num(w.finish, "wastage.finish")],
  ];
  let wastage = 0n;
  for (const [key, base, pct] of wastageParts) {
    const amount = percentOf(base, pct);
    wastage += amount;
    lines.push({ lineId: `PL:WASTAGE:${key}`, category: "WASTAGE", description: `Wastage on ${key.toLowerCase().replace("_", " ")} (${pct}%)`, sourceBomItemIds: [], quantity: toSafeNumber(base), unit: "PAISE", rate: pct, amount: toSafeNumber(amount) });
  }

  const material = board + edge;
  const directCost = material + finish + hardware + manufacturing + wastage;
  const overheadPct = num(rules.overheadPercent, "overheadPercent");
  const overhead = percentOf(directCost, overheadPct);
  lines.push({ lineId: "PL:OVERHEAD", category: "OVERHEAD", description: `Overhead (${overheadPct}% of direct cost)`, sourceBomItemIds: [], quantity: toSafeNumber(directCost), unit: "PAISE", rate: overheadPct, amount: toSafeNumber(overhead) });
  const totalCost = directCost + overhead;

  const marginPct = num(rules.marginPercent, "marginPercent");
  let sellingExGst: bigint;
  if (rules.marginBasis === "MARKUP_ON_COST") sellingExGst = totalCost + percentOf(totalCost, marginPct);
  else sellingExGst = roundDiv(totalCost * 10_000n, 10_000n - percentToBasisPoints(marginPct));
  const margin = sellingExGst - totalCost;
  lines.push({ lineId: "PL:MARGIN", category: "MARGIN", description: `Margin (${marginPct}% ${rules.marginBasis === "MARKUP_ON_COST" ? "markup on cost" : "of selling price"})`, sourceBomItemIds: [], quantity: toSafeNumber(totalCost), unit: "PAISE", rate: marginPct, amount: toSafeNumber(margin) });

  const gstPct = num(rules.gstPercent, "gstPercent");
  const gst = percentOf(sellingExGst, gstPct);
  lines.push({ lineId: "PL:GST", category: "GST", description: `GST (${gstPct}%)`, sourceBomItemIds: [], quantity: toSafeNumber(sellingExGst), unit: "PAISE", rate: gstPct, amount: toSafeNumber(gst) });

  const totals: PriceTotals = {
    material: toSafeNumber(material),
    finish: toSafeNumber(finish),
    hardware: toSafeNumber(hardware),
    manufacturing: toSafeNumber(manufacturing),
    wastage: toSafeNumber(wastage),
    directCost: toSafeNumber(directCost),
    overhead: toSafeNumber(overhead),
    totalCost: toSafeNumber(totalCost),
    margin: toSafeNumber(margin),
    sellingPriceExGst: toSafeNumber(sellingExGst),
    gst: toSafeNumber(gst),
    sellingPriceIncGst: toSafeNumber(sellingExGst + gst),
  };
  const boqItem = boq.items[0];
  const boqPrices: BoqItemPrice[] =
    boqItem === undefined
      ? []
      : [{ boqItemId: boqItem.boqItemId, quantity: boqItem.quantity, unitPriceExGst: toSafeNumber(roundDiv(sellingExGst, BigInt(boqItem.quantity))), amountExGst: totals.sellingPriceExGst }];

  const body: Omit<PriceSnapshot, "contentHash"> = {
    priceSnapshotId: `PRICE:${resolved.trace.designVersionId}:${resolved.trace.objectId}:${rateCard.rateCardId}@${rateCard.version}:${rules.ruleSetId}@${rules.version}`,
    classification: mode,
    currency: "INR",
    createdAt: input.createdAt,
    trace: clone(resolved.trace),
    modelFingerprint: modelFingerprint(resolved),
    bomId: bom.bomId,
    boqId: boq.boqId,
    // Embedded copies: later rate changes can never alter this snapshot (PRD §23).
    rateCard: clone(rateCard),
    rateCardRef: refOf(rateCard.rateCardId, rateCard.version, rateCard.status),
    pricingRules: clone(rules),
    pricingRulesRef: refOf(rules.ruleSetId, rules.version, rules.status),
    lines,
    totals,
    boqPrices,
    designBlockerCount: resolved.validation.counts.BLOCKER,
  };
  const snapshot: PriceSnapshot = { ...body, contentHash: hash53(stableStringify(body)) };
  const messages: ValidationMessage[] =
    mode === "TEST_FIXTURE"
      ? [{ code: "PRICE_IS_TEST_FIXTURE", severity: "BLOCKER", message: "TEST_FIXTURE price: synthetic rates, never a quotation", sourceObjectId: resolved.trace.objectId }]
      : [];
  return { status: "PRICED", snapshot: deepFreeze(snapshot), messages };
}

/** Recompute the content hash; false means the snapshot was altered after creation. */
export function verifyPriceSnapshot(snapshot: PriceSnapshot): boolean {
  const { contentHash, ...body } = snapshot;
  return hash53(stableStringify(body)) === contentHash;
}

/** A price is stale when the model it was computed from has changed. */
export function isPriceStale(snapshot: PriceSnapshot, current: ResolvedCabinet): boolean {
  return snapshot.modelFingerprint !== modelFingerprint(current);
}
