/** Screen 1 — sign in (Supabase Auth, or a LOCAL demo token). Several people may be signed in; the header switches. */
import { useState } from "react";
import type { Session } from "../auth";
import { APP_ENV, sessionFromToken, signInWithPassword } from "../auth";
import { Action, ErrorBox, Field, Section } from "../ui";

export function LoginScreen({ sessions, active, onChange }: { readonly sessions: Session[]; readonly active: number; readonly onChange: (s: Session[], active: number) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [error, setError] = useState<unknown>(null);
  const add = (s: Session) => {
    const rest = sessions.filter((x) => x.userId !== s.userId);
    onChange([...rest, s], rest.length);
  };
  return (
    <>
      <Section title={APP_ENV === "LOCAL" ? "Sign in (LOCAL demo)" : "Sign in"}>
        {APP_ENV === "LOCAL" ? (
          <>
            <p>Paste an access token from <code>.pilot/tokens/&lt;ROLE&gt;.txt</code> (printed by <code>pnpm pilot:demo</code>). LOCAL rehearsal data only.</p>
            <Field label="Access token"><textarea rows={3} value={token} onChange={(e) => { setToken(e.target.value); }} /></Field>
            <button type="button" className="primary" onClick={() => {
              try {
                add(sessionFromToken(token));
                setToken("");
                setError(null);
              } catch (e) { setError(e); }
            }}>Add person</button>
            <ErrorBox error={error} />
          </>
        ) : (
          <>
            <Field label="Email"><input type="email" autoComplete="username" value={email} onChange={(e) => { setEmail(e.target.value); }} /></Field>
            <Field label="Password"><input type="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); }} /></Field>
            <Action kind="primary" label="Sign in" run={async () => { add(await signInWithPassword(email, password)); setPassword(""); }} />
          </>
        )}
      </Section>
      {sessions.length > 0 && (
        <Section title="Signed in">
          <table>
            <thead><tr><th>Person</th><th>User id</th><th>Session ends</th><th /></tr></thead>
            <tbody>
              {sessions.map((s, i) => (
                <tr key={s.userId} className={i === active ? "selected" : ""}>
                  <td>{s.email}</td><td><code>{s.userId}</code></td><td>{new Date(s.expiresAt).toLocaleString()}</td>
                  <td>
                    <button type="button" disabled={i === active} onClick={() => { onChange(sessions, i); }}>Use</button>
                    <button type="button" onClick={() => { const next = sessions.filter((x) => x.userId !== s.userId); onChange(next, Math.min(active, Math.max(0, next.length - 1))); }}>Sign out</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}
    </>
  );
}
