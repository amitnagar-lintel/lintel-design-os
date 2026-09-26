/**
 * Screen 6 — validation: BLOCKERs, warnings and passed checks of the resolved model; the recorded APPROVAL run; the
 * lifecycle (submit → approve → lock). Nothing moves forward while a BLOCKER exists; the API enforces the same.
 */
import { useState } from "react";
import type { ScreenProps } from "../App";
import { api, idempotency, must, versionWithEtag } from "../api/client";
import { Action, Badge, ErrorBox, Field, Section, useLoad } from "../ui";
import { ValidationBadges } from "./Preview";

export function ValidationScreen({ sel }: ScreenProps) {
  const versionId = sel.versionId ?? "";
  const [n, setN] = useState(0);
  const model = useLoad(() => must(api.GET("/api/v1/design-versions/{versionId}/model", { params: { path: { versionId } } })), `vmodel:${versionId}:${String(n)}`);
  const version = useLoad(() => versionWithEtag(versionId), `vversion:${versionId}:${String(n)}`);
  const [run, setRun] = useState<{ blockerCount: number; warningCount: number; canApprove: boolean; current: boolean; id: string } | null>(null);
  const [reason, setReason] = useState("");
  const m = model.data;
  const v = version.data?.version;
  const blockers = m?.validation.counts.BLOCKER ?? 1;
  const codeOf = new Map((m?.objects ?? []).map((o) => [o.lineageId, o.objectCode]));
  const bySeverity = (sev: string) => (m?.validation.messages ?? []).filter((x) => x.severity === sev);
  const refresh = () => { setN((x) => x + 1); };

  const transition = async (action: "SUBMIT" | "APPROVE" | "LOCK") => {
    const { version: now, etag } = await versionWithEtag(versionId);
    await must(api.POST("/api/v1/design-versions/{versionId}/transitions", {
      params: { path: { versionId }, header: { "If-Match": etag, "Idempotency-Key": idempotency() } },
      body: { action, reason: reason.trim() === "" ? `${action} from the pilot UI` : reason.trim(), ...(action === "APPROVE" ? { expectedContentHash: now.contentHash } : {}) },
    }));
    refresh();
  };

  return (
    <>
      <ErrorBox error={model.error ?? version.error} />
      {m !== null && v !== undefined && (
        <>
          <Section title={`Validation — version ${String(v.versionNumber)} (${v.status})`} aside={<ValidationBadges m={m} />}>
            <Messages title="BLOCKERs (prevent approval and production output)" tone="bad" items={bySeverity("BLOCKER")} codeOf={codeOf} />
            <Messages title="Errors" tone="bad" items={bySeverity("ERROR")} codeOf={codeOf} />
            <Messages title="Warnings" tone="warn" items={bySeverity("WARNING")} codeOf={codeOf} />
            <h3>Passed</h3>
            <ul>
              {m.objects.filter((o) => o.messages.length === 0).map((o) => <li key={o.lineageId}><Badge tone="ok">PASS</Badge> {o.objectCode}: every check of the product rules, construction, hardware and placement passed</li>)}
              {m.validation.messages.filter((x) => x.lineageId === null).length === 0 && <li><Badge tone="ok">PASS</Badge> Room and run checks (clearances, gaps, run length, service void)</li>}
            </ul>
          </Section>
          <Section title="Approval">
            <p>1. Record the APPROVAL validation run · 2. Designer submits · 3. Design head approves (the exact reviewed content) · 4. Sales locks for issue.</p>
            <Field label="Reason (recorded in the audit log)"><input value={reason} onChange={(e) => { setReason(e.target.value); }} placeholder="e.g. Layout agreed with the client on site" /></Field>
            <div className="row">
              <Action label="Run APPROVAL validation" disabled={v.status !== "DRAFT"} run={async () => {
                const r = await must(api.POST("/api/v1/design-versions/{versionId}/validation-runs", { params: { path: { versionId }, header: { "Idempotency-Key": idempotency() } }, body: {} }));
                setRun(r);
              }} />
              <Action kind="primary" label="Submit" disabled={v.status !== "DRAFT" || blockers > 0} title={blockers > 0 ? "Resolve every BLOCKER first" : undefined} run={() => transition("SUBMIT")} />
              <Action kind="primary" label="Approve" disabled={v.status !== "IN_REVIEW" || blockers > 0} run={() => transition("APPROVE")} />
              <Action kind="primary" label="Lock for issue" disabled={v.status !== "APPROVED" || blockers > 0} run={() => transition("LOCK")} />
            </div>
            {run !== null && <p>APPROVAL run <code>{run.id}</code>: {run.blockerCount} BLOCKER, {run.warningCount} WARNING — {run.canApprove ? <Badge tone="ok">can be approved</Badge> : <Badge tone="bad">cannot be approved</Badge>}</p>}
            {blockers > 0 && <div className="error">This version has {blockers} BLOCKER(s): submission, approval, production outputs and issue are not possible.</div>}
          </Section>
        </>
      )}
    </>
  );
}

function Messages({ title, tone, items, codeOf }: { readonly title: string; readonly tone: "bad" | "warn"; readonly items: readonly { code: string; message: string; lineageId: string | null }[]; readonly codeOf: Map<string, string> }) {
  if (items.length === 0) return <p><Badge tone="ok">0</Badge> {title}</p>;
  return (
    <>
      <h3><Badge tone={tone}>{items.length}</Badge> {title}</h3>
      <ul>{items.map((x, i) => <li key={i}><code>{x.code}</code> {x.lineageId === null ? "room" : codeOf.get(x.lineageId) ?? "object"}: {x.message}</li>)}</ul>
    </>
  );
}
