/**
 * Screen 8 — issue (the existing issue workflow): a FOR_PRODUCTION quotation (SALES) and FOR_PRODUCTION drawings
 * (DESIGN_HEAD) of a LOCKED design version with no BLOCKER. The issued drawings' PDFs and the quotation document (a
 * PDF generated and sealed with the quotation snapshot) download through short-lived signed URLs. No client portal:
 * documents are delivered offline.
 */
import { useState } from "react";
import type { ScreenProps } from "../App";
import { api, idempotency, must } from "../api/client";
import { Action, Badge, ErrorBox, Field, Section, useLoad } from "../ui";
import { latestCommercial, parseHandOver, snapshotOf } from "./Outputs";
import type { HandOver } from "./Outputs";

async function issued(kind: "QUOTATION" | "DRAWING", snapshotId: string): Promise<boolean> {
  const r = kind === "QUOTATION"
    ? await api.GET("/api/v1/quotation-snapshots/{snapshotId}/issue", { params: { path: { snapshotId } } })
    : await api.GET("/api/v1/drawing-snapshots/{snapshotId}/issue", { params: { path: { snapshotId } } });
  return r.response.status === 200;
}

export function IssueScreen({ me, sel }: ScreenProps) {
  const versionId = sel.versionId ?? "";
  const [n, setN] = useState(0);
  const graph = useLoad(() => must(api.GET("/api/v1/design-versions/{versionId}/outputs", { params: { path: { versionId } } })), `issue:${versionId}:${String(n)}`);
  const candidates = (graph.data?.nodes ?? []).filter((s) => s.purpose === "FOR_PRODUCTION" && (s.kind === "QUOTATION" || s.kind === "DRAWING"));
  const states = useLoad(async () => Object.fromEntries(await Promise.all(candidates.map(async (s) => [s.id, await issued(s.kind as "QUOTATION" | "DRAWING", s.id)] as const))), `issued:${candidates.map((c) => c.id).join(",")}:${String(n)}`);
  const [reason, setReason] = useState("");
  const [code, setCode] = useState("");
  const [handOver, setHandOver] = useState<HandOver | null>(null);
  const [codeError, setCodeError] = useState<unknown>(null);
  const [issuedNote, setIssuedNote] = useState<string | null>(null);
  const salesOnly = me.permissions.includes("quotation.issue") && (graph.data?.hiddenKinds.includes("QUOTATION") ?? false);

  return (
    <>
      <ErrorBox error={graph.error ?? states.error} />
      <Section title="Issue">
        <p>Only FOR_PRODUCTION quotations and drawings of a LOCKED design version, with 0 BLOCKER, can be issued. An issue is permanent and audited.</p>
        <Field label="Reason (recorded in the audit log)"><input value={reason} onChange={(e) => { setReason(e.target.value); }} placeholder="e.g. Sent to client by email on 27-09" /></Field>
        {salesOnly && (
          <div className="card inner">
            <h3>Issue a quotation handed over by Costing</h3>
            <p>Your role issues quotations but does not read cost outputs. Paste the hand-over code shown with the FOR_PRODUCTION quotation (Outputs screen, Costing). After the issue, Costing (or Finance / Design head) downloads the quotation PDF on this screen and hands it over.</p>
            <Field label="Hand-over code"><input value={code} onChange={(e) => { setCode(e.target.value); setCodeError(null); try { setHandOver(e.target.value.trim() === "" ? null : parseHandOver(e.target.value)); } catch (x) { setHandOver(null); setCodeError(x); } }} /></Field>
            <ErrorBox error={codeError} />
            {issuedNote !== null && <p><Badge tone="ok">{issuedNote}</Badge></p>}
            {handOver !== null && <p>Quotation <code>{handOver.id}</code>, content <code>{handOver.contentHash}</code>, PricingStandard <code>{handOver.pricingStandardVersionId}</code>, QuotationPolicy <code>{handOver.quotationPolicyVersionId}</code></p>}
            <Action kind="primary" label="Issue quotation" disabled={handOver === null || reason.trim() === ""} run={async () => {
              if (handOver === null) return;
              await must(api.POST("/api/v1/quotation-snapshots/{snapshotId}/issue", { params: { path: { snapshotId: handOver.id }, header: { "Idempotency-Key": idempotency() } }, body: { reason: reason.trim(), expectedContentHash: handOver.contentHash, pricingStandardVersionId: handOver.pricingStandardVersionId, quotationPolicyVersionId: handOver.quotationPolicyVersionId } }));
              const r = await must(api.GET("/api/v1/quotation-snapshots/{snapshotId}/issue", { params: { path: { snapshotId: handOver.id } } }));
              setCode("");
              setHandOver(null);
              setIssuedNote(`ISSUED: quotation ${r.snapshotId}, revision ${String(r.revisionNumber)}, at ${r.issuedAt}`);
            }} />
          </div>
        )}
        <table>
          <thead><tr><th>Kind</th><th>Drawing</th><th>BLOCKER</th><th>Status</th><th /></tr></thead>
          <tbody>
            {candidates.map((s) => {
              const isIssued = states.data?.[s.id] === true;
              const blocked = s.blockerCount > 0 || !s.qualifiesForIssue;
              return (
                <tr key={s.id}>
                  <td>{s.kind}</td><td>{s.drawing === undefined ? "—" : `${s.drawing.drawingNumber} rev ${s.drawing.drawingRevision}`}</td>
                  <td>{s.blockerCount}</td>
                  <td>{isIssued ? <Badge tone="ok">ISSUED</Badge> : blocked ? <Badge tone="bad">not issuable</Badge> : <Badge>ready</Badge>}</td>
                  <td>
                    {!isIssued && <Action kind="primary" label="Issue" disabled={blocked || reason.trim() === ""} title={reason.trim() === "" ? "Enter a reason" : undefined} run={async () => {
                      if (s.kind === "QUOTATION") {
                        const snap = await snapshotOf("QUOTATION", s.id);
                        const pricingStandardVersionId = snap.commercial?.pricingStandardVersionId ?? await latestCommercial("pricing_standard");
                        const quotationPolicyVersionId = snap.commercial?.quotationPolicyVersionId ?? null;
                        if (pricingStandardVersionId === null || quotationPolicyVersionId === null) throw new Error("The quotation names no commercial versions.");
                        await must(api.POST("/api/v1/quotation-snapshots/{snapshotId}/issue", { params: { path: { snapshotId: s.id }, header: { "Idempotency-Key": idempotency() } }, body: { reason: reason.trim(), expectedContentHash: s.contentHash, pricingStandardVersionId, quotationPolicyVersionId } }));
                      } else {
                        await must(api.POST("/api/v1/drawing-snapshots/{snapshotId}/issue", { params: { path: { snapshotId: s.id }, header: { "Idempotency-Key": idempotency() } }, body: { reason: reason.trim(), expectedContentHash: s.contentHash } }));
                      }
                      setN((x) => x + 1);
                    }} />}
                    {isIssued && s.kind === "DRAWING" && <DrawingFiles snapshotId={s.id} name={s.drawing === undefined ? s.id : `${s.drawing.drawingNumber}-${s.drawing.drawingRevision}`} />}
                    {isIssued && s.kind === "QUOTATION" && <DrawingFiles kind="QUOTATION" snapshotId={s.id} name={`QUOTATION-${s.id.slice(0, 8)}-R${String(s.revisionNumber ?? 1)}`} />}
                  </td>
                </tr>
              );
            })}
            {candidates.length === 0 && <tr><td colSpan={5}>No FOR_PRODUCTION quotation or drawing yet (generate them on the Outputs screen from a LOCKED version).</td></tr>}
          </tbody>
        </table>
      </Section>
    </>
  );
}

/** The sealed files of an issued drawing or quotation (the quotation document PDF), downloaded through signed URLs. */
function DrawingFiles({ snapshotId, name, kind = "DRAWING" }: { readonly snapshotId: string; readonly name: string; readonly kind?: "DRAWING" | "QUOTATION" }) {
  const files = useLoad(() => must(kind === "DRAWING"
    ? api.GET("/api/v1/drawing-snapshots/{snapshotId}/files", { params: { path: { snapshotId } } })
    : api.GET("/api/v1/quotation-snapshots/{snapshotId}/files", { params: { path: { snapshotId } } })), `files:${kind}:${snapshotId}`);
  return (
    <span>
      <ErrorBox error={files.error} />
      {(files.data?.items ?? []).map((f) => (
        <Action key={f.fileId} label={`Download ${f.format}${f.sheetIndex === null ? "" : ` sheet ${String(f.sheetIndex + 1)}`}`} run={async () => {
          const u = await must(api.GET("/api/v1/files/{fileId}/url", { params: { path: { fileId: f.fileId }, query: { disposition: "attachment" } } }));
          // A short-lived signed URL (never stored); saved under the document's own number.
          const file = await fetch(u.url);
          if (!file.ok) throw new Error(`Download failed (HTTP ${String(file.status)})`);
          const a = document.createElement("a");
          a.href = URL.createObjectURL(await file.blob());
          a.download = `${name}${f.sheetIndex === null ? "" : `-sheet-${String(f.sheetIndex + 1)}`}.${f.format.toLowerCase()}`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => { URL.revokeObjectURL(a.href); }, 60_000);
        }} />
      ))}
    </span>
  );
}
