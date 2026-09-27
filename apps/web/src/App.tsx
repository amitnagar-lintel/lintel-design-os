/**
 * The pilot UI: Login → Project → Room → Design Studio → Validation → Outputs → Issue. Every screen is a view over
 * /api/v1; nothing is calculated here. Design Studio (Phase D6) is the primary cabinet-design experience, replacing
 * the earlier "Base cabinets" table and "Preview" screens as the primary editing surface — see screens/DesignStudio.tsx.
 * Those two screens' code is kept (screens/Layout.tsx, screens/Preview.tsx) as project-workflow infrastructure the
 * Design Studio itself reuses (version selection, plan/elevation drawing), not as separate navigable steps.
 */
import { useEffect, useState } from "react";
import type { Schemas } from "./api/client";
import { api, must, setBearer } from "./api/client";
import type { Session } from "./auth";
import { APP_ENV, loadSessions, saveSessions } from "./auth";
import { DesignStudioScreen } from "./screens/DesignStudio";
import { IssueScreen } from "./screens/Issue";
import { LoginScreen } from "./screens/Login";
import { OutputsScreen } from "./screens/Outputs";
import { ProjectScreen } from "./screens/Project";
import { RoomScreen } from "./screens/Room";
import { ValidationScreen } from "./screens/Validation";
import { ErrorBox } from "./ui";

export interface Selection {
  readonly projectId?: string | undefined;
  readonly roomId?: string | undefined;
  readonly designId?: string | undefined;
  readonly versionId?: string | undefined;
}
export interface ScreenProps {
  readonly me: Schemas["MeResponse"];
  readonly sel: Selection;
  readonly setSel: (s: Selection) => void;
  readonly go: (step: Step) => void;
}

const STEPS = [
  ["login", "1 Login"], ["project", "2 Project"], ["room", "3 Room"], ["studio", "4 Design Studio"],
  ["validation", "5 Validation"], ["outputs", "6 Outputs"], ["issue", "7 Issue"],
] as const;
export type Step = (typeof STEPS)[number][0];

export function App() {
  const [sessions, setSessions] = useState<Session[]>(loadSessions);
  const [active, setActive] = useState(0);
  const [me, setMe] = useState<Schemas["MeResponse"] | null>(null);
  const [meError, setMeError] = useState<unknown>(null);
  const [step, setStep] = useState<Step>("login");
  const [sel, setSel] = useState<Selection>({});
  const session = sessions[active] ?? null;

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);
  useEffect(() => {
    setBearer(session?.token ?? null);
    setMe(null);
    setMeError(null);
    if (session === null) return;
    must(api.GET("/api/v1/me")).then(setMe, setMeError);
  }, [session]);

  const needs: Record<Step, boolean> = {
    login: true, project: me !== null, room: sel.projectId !== undefined, studio: sel.roomId !== undefined,
    validation: sel.versionId !== undefined, outputs: sel.versionId !== undefined, issue: sel.versionId !== undefined,
  };
  const props = me === null ? null : { me, sel, setSel, go: setStep };

  return (
    <div className="app">
      <header className="top">
        <strong>Lintel Design OS — pilot</strong>
        <span className={`env ${APP_ENV === "LOCAL" ? "local" : ""}`}>{APP_ENV === "LOCAL" ? "LOCAL (rehearsal data)" : "Supabase Auth"}</span>
        {sessions.length > 0 && (
          <select aria-label="Signed-in person" value={active} onChange={(e) => { setActive(Number(e.target.value)); }}>
            {sessions.map((s, i) => <option key={s.userId} value={i}>{s.email}</option>)}
          </select>
        )}
        {me !== null && <span className="roles">{me.roles.join(", ")}</span>}
      </header>
      <nav className="steps">
        {STEPS.map(([id, label]) => (
          <button key={id} type="button" className={step === id ? "current" : ""} disabled={!needs[id]} onClick={() => { setStep(id); }}>{label}</button>
        ))}
      </nav>
      <main>
        <ErrorBox error={meError} />
        {step === "login" && <LoginScreen sessions={sessions} active={active} onChange={(s, a) => { setSessions(s); setActive(a); if (s.length > 0) setStep("project"); }} />}
        {props !== null && step === "project" && <ProjectScreen {...props} />}
        {props !== null && step === "room" && <RoomScreen {...props} />}
        {props !== null && step === "studio" && <DesignStudioScreen {...props} />}
        {props !== null && step === "validation" && <ValidationScreen {...props} />}
        {props !== null && step === "outputs" && <OutputsScreen {...props} />}
        {props !== null && step === "issue" && <IssueScreen {...props} />}
        {props === null && step !== "login" && <p>Sign in first.</p>}
      </main>
    </div>
  );
}
