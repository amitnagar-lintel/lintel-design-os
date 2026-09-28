/** Small presentational pieces shared by the screens. */
import type { ReactNode } from "react";
import { Component, useEffect, useState } from "react";
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

/**
 * Remediation P0 (Slice 6F follow-up): a secondary safety net, not the primary fix. The Design Studio already
 * validates/rejects an out-of-range dimension before Save (`validation.ts`) and degrades gracefully around a
 * decode failure for the selected object alone (`screens/DesignStudio.tsx`'s own try/catch around
 * `decodeCabinetInstance`); this boundary exists only for whatever else could still throw during render, so that
 * NO error anywhere in the wrapped subtree can ever blank the whole screen. It never hides the underlying error
 * (PRD/CLAUDE.md: never hide a validation error) and never loses the surrounding screen (the version selector,
 * nav, etc. above it keep working — project/design identity is never lost, since it lives in `App`'s own state,
 * outside this boundary). `resetKey` clears a caught error automatically once the condition that caused it may
 * have changed (e.g. a different object selected, or the model reloaded).
 */
interface ErrorBoundaryProps {
  readonly children: ReactNode;
  readonly resetKey?: string | number;
  readonly onReset?: () => void;
}
interface ErrorBoundaryState {
  readonly error: Error | null;
}
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidUpdate(prev: ErrorBoundaryProps): void {
    if (this.state.error !== null && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div className="error" role="alert">
        <p><strong>Something went wrong while rendering this screen:</strong> {error.message}</p>
        <p>The rest of your design has not been lost. Try again, or reload the model.</p>
        <button type="button" onClick={() => { this.setState({ error: null }); this.props.onReset?.(); }}>Try again</button>
      </div>
    );
  }
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
