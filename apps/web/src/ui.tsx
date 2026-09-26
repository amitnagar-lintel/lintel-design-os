/** Small presentational pieces shared by the screens. */
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ApiError } from "./api/client";

export function ErrorBox({ error }: { readonly error: unknown }) {
  if (error === null || error === undefined) return null;
  const code = error instanceof ApiError ? error.code : null;
  return <div className="error" role="alert">{code !== null && <strong>{code}: </strong>}{error instanceof Error ? error.message : JSON.stringify(error)}</div>;
}

/** A button that runs an async action, shows it is busy, and reports its error below. */
export function Action({ label, run, disabled, kind, title }: { readonly label: string; readonly run: () => Promise<unknown>; readonly disabled?: boolean | undefined; readonly kind?: "primary" | "danger" | undefined; readonly title?: string | undefined }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <span className="action">
      <button type="button" className={kind ?? ""} disabled={busy || disabled === true} title={title} onClick={() => {
        setBusy(true);
        setError(null);
        run().catch((e: unknown) => { setError(e); }).finally(() => { setBusy(false); });
      }}>{busy ? "…" : label}</button>
      <ErrorBox error={error} />
    </span>
  );
}

export function Field({ label, children, hint }: { readonly label: string; readonly children: ReactNode; readonly hint?: string | undefined }) {
  return <label className="field"><span>{label}</span>{children}{hint !== undefined && <small>{hint}</small>}</label>;
}

export function Section({ title, children, aside }: { readonly title: string; readonly children: ReactNode; readonly aside?: ReactNode }) {
  return <section className="card"><header><h2>{title}</h2>{aside}</header>{children}</section>;
}

export function Badge({ children, tone }: { readonly children: ReactNode; readonly tone?: "ok" | "warn" | "bad" | "info" }) {
  return <span className={`badge ${tone ?? "info"}`}>{children}</span>;
}

/** Loads when `key` changes; `reload` refetches. */
export function useLoad<T>(load: () => Promise<T>, key: string): { data: T | null; error: unknown; loading: boolean; reload: () => void } {
  const [n, setN] = useState(0);
  const [state, setState] = useState<{ key: string; data: T | null; error: unknown; loading: boolean }>({ key: "", data: null, error: null, loading: true });
  useEffect(() => {
    let live = true;
    setState((s) => ({ key, data: s.key === key ? s.data : null, error: null, loading: true }));
    load().then((data) => { if (live) setState({ key, data, error: null, loading: false }); }, (error: unknown) => { if (live) setState({ key, data: null, error, loading: false }); });
    return () => { live = false; };
    // `load` is a fresh closure every render; `key` names what it loads.
  }, [key, n]);
  return { data: state.key === key ? state.data : null, error: state.error, loading: state.loading, reload: () => { setN((x) => x + 1); } };
}
