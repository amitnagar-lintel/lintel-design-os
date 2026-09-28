/** Screen 2 — the organization, its projects (create / open) with the client, and the project team. */
import { useState } from "react";
import type { ScreenProps } from "../App";
import { api, must } from "../api/client";
import { Action, Badge, ErrorBox, Field, Section, useLoad } from "../ui";

const PROJECT_ROLES = ["DESIGNER", "DESIGN_HEAD", "SITE_ENGINEER", "COSTING", "SALES", "FINANCE", "PRODUCTION", "PROCUREMENT"] as const;

/** Creation friction: a client/project code used to be a second thing to invent, right next to the name that
 * already says the same thing — this derives a starting code from the name (letters/digits only, `_` for
 * everything else, matching the API's own "Letters, digits, - and _" rule), which is still an ordinary editable
 * field, not a hidden value: typing in it directly overrides the derived one and stops it following the name. */
function slugCode(name: string, maxLen = 24): string {
  return name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, maxLen);
}

export function ProjectScreen({ me, sel, setSel, go }: ScreenProps) {
  const projects = useLoad(() => must(api.GET("/api/v1/projects", { params: { query: { limit: 100 } } })), `projects:${me.userId}`);
  const [f, setF] = useState({ clientName: "", clientCode: "", phone: "", email: "", projectName: "", projectCode: "", site: "" });
  const [codeEdited, setCodeEdited] = useState(false);
  const [projectCodeEdited, setProjectCodeEdited] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF({ ...f, [k]: e.target.value }); };
  const setClientName = (e: { target: { value: string } }) => {
    const clientName = e.target.value;
    setF((prev) => ({ ...prev, clientName, ...(codeEdited ? {} : { clientCode: slugCode(clientName) }) }));
  };
  const setClientCode = (e: { target: { value: string } }) => { setCodeEdited(true); set("clientCode")(e); };
  const setProjectName = (e: { target: { value: string } }) => {
    const projectName = e.target.value;
    setF((prev) => ({ ...prev, projectName, ...(projectCodeEdited ? {} : { projectCode: slugCode(projectName) }) }));
  };
  const setProjectCode = (e: { target: { value: string } }) => { setProjectCodeEdited(true); set("projectCode")(e); };
  const canWrite = me.permissions.includes("project.write");

  return (
    <>
      <Section title="Organization">
        <p>Organization <code>{me.orgId}</code> · you: <code>{me.userId}</code> · roles: {me.roles.map((r) => <Badge key={r}>{r}</Badge>)}</p>
      </Section>
      <Section title="Projects">
        <ErrorBox error={projects.error} />
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Status</th><th /></tr></thead>
          <tbody>
            {(projects.data?.items ?? []).map((p) => (
              <tr key={p.id} className={sel.projectId === p.id ? "selected" : ""}>
                <td>{p.projectCode}</td><td>{p.name}</td><td>{p.status}</td>
                <td><button type="button" onClick={() => { setSel({ projectId: p.id }); go("room"); }}>Open</button></td>
              </tr>
            ))}
            {projects.data?.items.length === 0 && <tr><td colSpan={4}>No project yet.</td></tr>}
          </tbody>
        </table>
      </Section>
      {canWrite && (
        <Section title="New project">
          <div className="grid">
            <Field label="Client name"><input value={f.clientName} onChange={setClientName} /></Field>
            <Field label="Client code" hint="Letters, digits, - and _ — filled in from the name, editable"><input value={f.clientCode} onChange={setClientCode} /></Field>
            <Field label="Client phone (optional)"><input value={f.phone} onChange={set("phone")} /></Field>
            <Field label="Client email (optional)"><input value={f.email} onChange={set("email")} /></Field>
            <Field label="Project name"><input value={f.projectName} onChange={setProjectName} /></Field>
            <Field label="Project code" hint="Filled in from the name, editable"><input value={f.projectCode} onChange={setProjectCode} /></Field>
            <Field label="Site address (optional)"><input value={f.site} onChange={set("site")} /></Field>
          </div>
          <Action kind="primary" label="Create client and project" run={async () => {
            const contact = Object.fromEntries(Object.entries({ phone: f.phone, email: f.email }).filter(([, v]) => v.trim() !== ""));
            const client = await must(api.POST("/api/v1/clients", { body: { clientCode: f.clientCode.trim(), name: f.clientName.trim(), ...(Object.keys(contact).length > 0 ? { contact } : {}) } }));
            const project = await must(api.POST("/api/v1/projects", { body: { clientId: client.id, projectCode: f.projectCode.trim(), name: f.projectName.trim(), ...(f.site.trim() === "" ? {} : { siteAddress: { line1: f.site.trim() } }) } }));
            setSel({ projectId: project.id });
            projects.reload();
          }} />
        </Section>
      )}
      {sel.projectId !== undefined && <ProjectTeam projectId={sel.projectId} canAssign={me.permissions.includes("project_members.assign")} />}
    </>
  );
}

function ProjectTeam({ projectId, canAssign }: { readonly projectId: string; readonly canAssign: boolean }) {
  const members = useLoad(() => must(api.GET("/api/v1/projects/{projectId}/members", { params: { path: { projectId } } })), `members:${projectId}`);
  const org = useLoad(() => must(api.GET("/api/v1/org/members")).catch(() => null), `org-members:${projectId}`);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<(typeof PROJECT_ROLES)[number]>("DESIGNER");
  return (
    <Section title="Project team">
      <p>Designers, the design head, the site engineer and costing work on a project only as its members.</p>
      <ErrorBox error={members.error} />
      <table>
        <thead><tr><th>User</th><th>Role</th></tr></thead>
        <tbody>{(members.data?.items ?? []).map((m) => {
          const person = org.data?.items.find((p) => p.userId === m.userId);
          return <tr key={`${m.userId}-${m.role}`}><td>{person === undefined ? <code>{m.userId}</code> : `${person.displayName} (${person.email})`}</td><td>{m.role}</td></tr>;
        })}</tbody>
      </table>
      {canAssign && (
        <div className="row">
          {org.data !== null ? (
            <select value={userId} onChange={(e) => { setUserId(e.target.value); }} aria-label="Person">
              <option value="">— person —</option>
              {org.data.items.map((m) => <option key={m.userId} value={m.userId}>{m.displayName} ({m.email})</option>)}
            </select>
          ) : <input placeholder="User id" value={userId} onChange={(e) => { setUserId(e.target.value); }} />}
          <select value={role} onChange={(e) => { setRole(e.target.value as typeof role); }} aria-label="Role">{PROJECT_ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          <Action label="Add to project" disabled={userId === ""} run={async () => {
            await must(api.POST("/api/v1/projects/{projectId}/members", { params: { path: { projectId } }, body: { userId, role } }));
            members.reload();
          }} />
        </div>
      )}
    </Section>
  );
}
