/** Keeps the approved M5 design documents consistent with the decisions they record. */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLANNING_VARIABLES } from "@lintel/catalog-engine";

const ARCH = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "architecture");
const design = readFileSync(join(ARCH, "M5-TECHNICAL-DESIGN.md"), "utf8");
const dataArch = readFileSync(join(ARCH, "PRODUCTION-DATA-ARCHITECTURE.md"), "utf8");

const STANDARDS = ["construction_standard", "planning_standard", "edge_band_standard", "manufacturing_standard", "pricing_standard", "quotation_policy"];
const ROLES = ["ADMIN", "DESIGNER", "DESIGN_HEAD", "SALES", "COSTING", "FINANCE", "PROCUREMENT", "PRODUCTION", "SITE_ENGINEER", "CLIENT"];
const ENVELOPE = ["entityId", "versionId", "versionNumber", "status", "source", "createdBy", "createdAt", "approvedBy", "approvedAt", "effectiveFrom", "supersededBy", "contentHash"];

describe("M5-TECHNICAL-DESIGN.md", () => {
  it("keeps every standard in its own entity and version tables, with no generic standard table", () => {
    for (const s of STANDARDS) {
      expect(design).toContain(`\`${s}\``);
      expect(design).toContain(`\`${s}_version\``);
    }
    expect(design).not.toMatch(/`standard`|`standard_version`|`configuration`/);
    expect(design).not.toMatch(/MaterialStandard|HardwareStandard/);
  });
  it("uses the approved lifecycle and keeps CHANGES_REQUIRED out of the persisted statuses", () => {
    expect(design).toContain("DRAFT, IN_REVIEW, APPROVED, LOCKED or SUPERSEDED");
    expect(design).toContain("previous_status = IN_REVIEW");
  });
  it("defines exactly the approved Design OS roles in the permission matrix", () => {
    const header = design.split("\n").find((l) => l.startsWith("| Action group |"));
    expect(header?.split("|").map((c) => c.trim()).filter(Boolean).slice(1)).toEqual(ROLES);
  });
  it("records the full version identity envelope", () => {
    for (const f of ENVELOPE) expect(design).toContain(`\`${f}\``);
  });
  it("gives finance approvals to FINANCE only, never to ADMIN or COSTING (D9)", () => {
    const header = design.split("\n").find((l) => l.startsWith("| Action group |")) ?? "";
    const cols = header.split("|").map((c) => c.trim()).filter(Boolean);
    const rows = design.split("\n").filter((l) => /^\| \*\*(Pricing standard approve|Quotation policy approve|Finance-related commercial configuration approve)/.test(l));
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const cells = row.split("|").slice(1, -1).map((c) => c.trim());
      const granted = cols.filter((_, i) => i > 0 && cells[i] !== "");
      expect(granted).toEqual(["FINANCE"]);
    }
    expect(design).toContain("can be granted **only to FINANCE**");
  });
  it("uses a separate passwordless, project-scoped client sign-in route (D10)", () => {
    expect(design).toContain("**Passwordless email OTP**");
    expect(design).toContain("Access a project by supplying its ID");
    expect(design).toContain("Create an organization");
    expect(design).toContain("Assign themselves or anyone else to a project");
    expect(design).toContain("client_contact.client_id` to equal `project.client_id`");
    expect(design).not.toContain("inactive until this is approved");
  });
  it("records complete snapshot provenance, including all six snapshot kinds", () => {
    for (const t of ["bom_snapshot", "boq_snapshot", "pricing_snapshot", "quotation_snapshot", "drawing_snapshot", "manufacturing_document_snapshot"]) expect(design).toContain(`\`${t}\``);
    for (const c of ["construction_standard_version_id", "planning_standard_version_id", "edge_band_standard_version_id", "manufacturing_standard_version_id", "pricing_standard_version_id", "quotation_policy_version_id", "material_catalog_version_id", "hardware_catalog_version_id", "hettich_dataset_version_id", "engine_version"]) {
      expect(design).toContain(`\`${c}\``);
    }
  });
  it("enforces approver ≠ submitter in the database and forbids fixtures and SQL calculations", () => {
    expect(design).toContain("approved_by <> submitted_by");
    expect(design).toContain("data_classification = 'PRODUCTION'");
    expect(design).toContain("no PL/pgSQL business calculations");
  });
  it("defines the FileStorageProvider operations", () => {
    for (const op of ["upload(", "download(", "delete(", "signedUrl(", "metadata(", "checksum("]) expect(design).toContain(op);
  });
  it("seeds the planning registry with exactly the approved planning variables", () => {
    expect(PLANNING_VARIABLES).toHaveLength(6);
    expect(design).toContain("registry of 6 codes");
  });
});

describe("PRODUCTION-DATA-ARCHITECTURE.md", () => {
  it("keeps materials, finishes, hardware, Hettich and appliances as catalog domains", () => {
    for (const d of ["**Material**", "**Finish**", "**Hardware**", "**Hettich**", "**Appliance**"]) expect(dataArch).toContain(d);
    expect(dataArch).toContain("There is no `MaterialStandard` and no `HardwareStandard`");
  });
  it("records the full identity envelope", () => {
    for (const f of ENVELOPE) expect(dataArch).toContain(`\`${f}\``);
  });
});
