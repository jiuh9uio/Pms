import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ButtonHTMLAttributes, type FormEvent, type ReactNode,
} from 'react';
import type { ZodType } from 'zod';
import { ApiFailure } from './api.ts';

// ---------- Meldungen ----------
interface Toast { id: number; text: string; kind: 'ok' | 'error' }
const ToastCtx = createContext<(text: string, kind?: Toast['kind']) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: Toast['kind'] = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </ToastCtx.Provider>
  );
}

// ---------- Bausteine ----------
export function Button({ variant = 'default', busy, children, ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'danger' | 'ghost'; busy?: boolean }) {
  return (
    <button type="button" {...rest} className={`btn ${variant} ${rest.className ?? ''}`} disabled={rest.disabled || busy} aria-busy={busy}>
      {children}
    </button>
  );
}

export function Field({ label, error, hint, children, wide }: { label: string; error?: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={`field${wide ? ' wide' : ''}${error ? ' invalid' : ''}`}>
      <span className="label">{label}</span>
      {children}
      {error ? <span className="error" role="alert">{error}</span> : hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <header className="pagehead">
      <div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export function Dialog({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    if (!d.open) d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog ref={ref} className="dialog" onCancel={(e) => { e.preventDefault(); onClose(); }}
      onMouseDown={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="dialog-head"><h2>{title}</h2><button type="button" className="iconbtn" onClick={onClose} aria-label="Schließen">✕</button></div>
      <div className="dialog-body">{children}</div>
      {footer && <div className="dialog-foot">{footer}</div>}
    </dialog>
  );
}

// ---------- Laden und Speichern ----------
/** Lädt Daten und liefert Zustand + Neuladen. */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    loader().then((d) => { if (live) { setData(d); setError(null); } })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);
  return { data, error, reload: useCallback(() => setTick((t) => t + 1), []) };
}

export function LoadState({ error, loading }: { error: string | null; loading: boolean }) {
  if (error) return <p className="notice danger" role="alert">{error}</p>;
  if (loading) return <p className="muted">Lädt …</p>;
  return null;
}

/**
 * Formular-Helfer: prüft mit dem gemeinsamen Schema, sendet, und ordnet Fehler des Servers den Feldern zu.
 */
export function useSubmit<T>(schema: ZodType<T>, send: (value: T) => Promise<void>) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const submit = async (raw: unknown, e?: FormEvent) => {
    e?.preventDefault();
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const f: Record<string, string> = {};
      for (const i of parsed.error.issues) f[i.path.join('.')] ??= i.message;
      setErrors(f);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      await send(parsed.data);
    } catch (err) {
      if (err instanceof ApiFailure && Object.keys(err.fields).length) setErrors(err.fields);
      else toast(err instanceof Error ? err.message : 'Unbekannter Fehler', 'error');
    } finally {
      setBusy(false);
    }
  };
  return { errors, busy, submit };
}

export const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
