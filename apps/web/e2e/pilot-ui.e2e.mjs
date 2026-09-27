// The pilot workflow through the UI in a real browser, against a running `pnpm pilot:demo` (LOCAL, rehearsal data).
// Usage: node apps/web/e2e/pilot-ui.e2e.mjs [screenshot dir]   (Playwright + Chromium must be installed)
// Updated for the Design Studio nav (Phase D6, Slice 1): step 4 now drives the 3-pane Design Studio instead of
// the old "Base cabinets" table + "Preview" screens. Selectors match apps/web/src/screens/DesignStudio.tsx; run
// this locally against a live `pilot:demo` to confirm after any further Design Studio UI change.
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { playwright = createRequire(`${process.env.PLAYWRIGHT_MODULE_DIR ?? "/opt/node22/lib/node_modules"}/`)("playwright"); }
const WEB = process.env.PILOT_WEB_URL ?? "http://127.0.0.1:5173";
const SHOTS = process.argv[2] ?? ".pilot/ui-e2e";
mkdirSync(SHOTS, { recursive: true });
const token = (role) => readFileSync(join(".pilot", "tokens", `${role}.txt`), "utf8").trim();
const email = { SALES: "sales@rehearsal.local", SITE_ENGINEER: "site@rehearsal.local", DESIGNER: "designer@rehearsal.local", DESIGN_HEAD: "design-head@rehearsal.local", COSTING: "costing@rehearsal.local" };
const userId = (role) => JSON.parse(Buffer.from(token(role).split(".")[1], "base64url").toString()).sub;
const suffix = Date.now().toString(36).toUpperCase();

const browser = await playwright.chromium.launch({ executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("pageerror", (e) => { console.error("PAGE ERROR", e.message); });
const step = async (name) => { await page.getByRole("button", { name, exact: true }).click(); };
const as = async (role) => { await page.getByLabel("Signed-in person").selectOption({ label: email[role] }); await page.waitForTimeout(300); };
const click = async (name) => { await page.getByRole("button", { name, exact: true }).first().click(); };
const noError = async (where) => { await page.waitForTimeout(700); const e = page.locator(".error"); if (await e.count() > 0) throw new Error(`${where}: ${await e.first().innerText()}`); };
const shot = async (n) => { await page.screenshot({ path: join(SHOTS, `${n}.png`), fullPage: true }); };

await page.goto(WEB);
// 1. Login: five people in one tab.
for (const role of Object.keys(email)) {
  await step("1 Login");
  await page.getByLabel("Access token").fill(token(role));
  await click("Add person");
}
await step("1 Login");
await shot("1-login");

// 2. Project (SALES): client + project, then the project team.
await as("SALES");
await step("2 Project");
await page.getByLabel("Client name").fill("Rehearsal client");
await page.getByLabel("Client code").fill(`CL-${suffix}`);
await page.getByLabel("Client phone").fill("+91 00000 00000");
await page.getByLabel("Project name").fill("Rehearsal kitchen (UI)");
await page.getByLabel("Project code").fill(`PR-${suffix}`);
await click("Create client and project");
await noError("create project");
for (const role of ["DESIGNER", "SITE_ENGINEER", "DESIGN_HEAD", "COSTING"]) {
  await page.getByLabel("Person", { exact: true }).selectOption(userId(role));
  await page.getByLabel("Role", { exact: true }).selectOption(role);
  await click("Add to project");
  await noError(`member ${role}`);
}
await shot("2-project");

// 3. Room (SITE_ENGINEER): rectangular kitchen.
await as("SITE_ENGINEER");
await step("3 Room");
await page.getByLabel("Width along wall A (mm)").fill("4200");
await page.getByLabel("Depth (mm)").fill("3200");
await page.getByLabel("Height (mm)").fill("3000");
await page.getByLabel("Wall thickness (mm)").fill("150");
await page.getByLabel("Survey source").fill("UI rehearsal survey");
await click("Create kitchen");
await noError("create room");
await click("Open");
await shot("3-room");

// 4. Design Studio (DESIGNER): design, version pinned to approved data, add cabinets, edit a front, BOM.
await as("DESIGNER");
await step("4 Design Studio");
await click("Create design");
await noError("create design");
await click("Create version (pinned to approved data)");
await noError("create version");
await click("+ Add");
await noError("add cabinet");
await page.getByLabel("Width (mm)").fill("750");
await click("Save");
await noError("save width");
await click("+ Add");
await noError("add second cabinet");
await page.getByLabel("Front").selectOption({ label: "2 shutters" });
await click("Save");
await noError("save front");
await page.getByRole("button", { name: "Plan", exact: true }).click();
await shot("4-studio-plan");
await page.getByRole("button", { name: "Elevation", exact: true }).click();
await shot("4-studio-elevation");
await page.getByRole("button", { name: "BOM", exact: true }).click();
await click("Generate BOM (PRELIMINARY)");
await noError("generate bom");
await page.getByText("Full payload (as stored)").waitFor();
await shot("4-studio-bom");

// 5. Validation → submit (DESIGNER), approve (DESIGN_HEAD), lock (SALES).
await step("5 Validation");
await page.getByRole("heading", { name: "Passed" }).waitFor();
await click("Run APPROVAL validation");
await noError("validation run");
await click("Submit");
await noError("submit");
await as("DESIGN_HEAD");
await step("5 Validation");
await click("Approve");
await noError("approve");
await as("SALES");
await step("5 Validation");
await click("Lock for issue");
await noError("lock");
await shot("5-validation");

// 6. Outputs FOR_PRODUCTION: BOM, BOQ, drawings (DESIGNER); pricing, quotation (COSTING).
await as("DESIGNER");
await step("6 Outputs");
await page.waitForTimeout(800);
await page.getByLabel("Purpose").selectOption("FOR_PRODUCTION");
await page.getByLabel("Drawing number").fill(`UI-${suffix}`);
for (const b of ["BOM", "BOQ", "Drawing: wall A elevation", "Drawing: panel schedule"]) { await click(b); await noError(b); }
await as("COSTING");
await step("6 Outputs");
await page.waitForTimeout(800);
await page.getByLabel("Purpose").selectOption("FOR_PRODUCTION");
for (const b of ["Pricing", "Quotation"]) { await click(b); await noError(b); }
await page.locator("tr", { hasText: "QUOTATION" }).getByRole("button", { name: "View" }).click();
await page.waitForTimeout(800);
const handOver = (await page.locator("code.handover").innerText()).trim();
await shot("6-outputs");

// 7. Issue: quotation (SALES), drawings (DESIGN_HEAD), PDF download.
await as("SALES");
await step("7 Issue");
await page.getByLabel("Reason (recorded in the audit log)").fill("UI rehearsal issue");
await page.getByLabel("Hand-over code").fill(handOver);
await click("Issue quotation");
await noError("issue quotation");
await page.getByText("ISSUED: quotation").waitFor();
await as("DESIGN_HEAD");
await step("7 Issue");
await page.getByLabel("Reason (recorded in the audit log)").fill("UI rehearsal issue");
for (let i = 0; i < 2; i++) {
  await page.locator("tr", { hasText: "DRAWING" }).filter({ has: page.getByRole("button", { name: "Issue", exact: true }) }).first().getByRole("button", { name: "Issue", exact: true }).click();
  await noError("issue drawing");
}
await page.waitForTimeout(1500);
const download = page.waitForEvent("download", { timeout: 10000 });
await page.locator("tbody tr", { hasText: /DRAWING/ }).first().getByRole("button", { name: /^Download PDF/ }).click();
const file = await (await download).path();
const pdf = readFileSync(file);
const head = pdf.subarray(0, 5).toString();
if (head !== "%PDF-") throw new Error(`downloaded file is not a PDF (${head})`);
// The issued quotation document (PDF sealed with the quotation snapshot), downloaded by Costing.
await as("COSTING");
await step("7 Issue");
await page.waitForTimeout(1500);
const qDownload = page.waitForEvent("download", { timeout: 10000 });
await page.locator("tr", { hasText: "QUOTATION" }).getByRole("button", { name: /^Download PDF/ }).click();
const qpdf = readFileSync(await (await qDownload).path());
if (qpdf.subarray(0, 5).toString() !== "%PDF-" || !qpdf.toString("latin1").includes("GRAND TOTAL")) throw new Error("the quotation download is not the quotation PDF");
await shot("7-issue");
console.log(`UI E2E PASSED: drawing PDF ${String(pdf.byteLength)} bytes, quotation PDF ${String(qpdf.byteLength)} bytes; screenshots in ${SHOTS}`);
await browser.close();
