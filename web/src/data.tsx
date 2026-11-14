import { createContext, useCallback, useContext, useMemo, useState, type ReactNode, useEffect, useRef } from 'react';
import type { CalendarEntry, GuestDto } from '../../src/shared/hotel.js';
import { BlockDialog } from './hotel/BlockDialog.tsx';
import { BookingDialog } from './hotel/BookingDialog.tsx';
import { InvoiceDialog } from './billing/InvoiceDialog.tsx';
import { CompanyDialog } from './hotel/CompanyDialog.tsx';
import { GuestDialog } from './hotel/GuestDialog.tsx';
import { api } from './api.ts';
import { NewBooking } from './hotel/NewBooking.tsx';

export interface NewPreset {
  roomId?: string; from?: string; to?: string; guest?: GuestDto; companyId?: string;
  /** Vorbelegung aus einer E-Mail-Anfrage */
  draft?: { firstName?: string; lastName?: string; email?: string; phone?: string }; notes?: string; source?: string; onCreated?: (id: string) => void;
}
export interface BlockPreset { roomId?: string; from?: string; entry?: CalendarEntry }
type Open =
  | { kind: 'booking'; id: string }
  | { kind: 'new'; preset: NewPreset }
  | { kind: 'guest'; id: string | null }
  | { kind: 'block'; preset: BlockPreset }
  | { kind: 'invoice'; id: string }
  | { kind: 'company'; id: string | null };

interface Data {
  /** Zähler: erhöht sich nach jeder Änderung, Seiten laden dann neu */
  rev: number;
  bump: () => void;
  openBooking: (id: string) => void;
  newBooking: (preset?: NewPreset) => void;
  openGuest: (id: string | null) => void;
  openBlock: (preset: BlockPreset) => void;
  openInvoice: (id: string) => void;
  openCompany: (id: string | null) => void;
  /** alle geöffneten Dialoge schließen (vor einem Seitenwechsel) */
  closeAll: () => void;
}
const Ctx = createContext<Data>(null!);
export const useData = () => useContext(Ctx);

/** Hält die geöffneten Dialoge (auch übereinander, z. B. Reservierung → Gast) und meldet Änderungen an die Seiten. */
export function DataProvider({ children }: { children: ReactNode }) {
  const [rev, setRev] = useState(0);
  const [stack, setStack] = useState<Open[]>([]);
  const push = useCallback((o: Open) => setStack((s) => [...s, o]), []);
  const value = useMemo<Data>(() => ({
    rev,
    bump: () => setRev((r) => r + 1),
    openBooking: (id) => push({ kind: 'booking', id }),
    newBooking: (preset = {}) => push({ kind: 'new', preset }),
    openGuest: (id) => push({ kind: 'guest', id }),
    openBlock: (preset) => push({ kind: 'block', preset }),
    openInvoice: (id) => push({ kind: 'invoice', id }),
    openCompany: (id) => push({ kind: 'company', id }),
    closeAll: () => setStack([]),
  }), [rev, push]);
  // Gleichzeitiges Arbeiten: alle 8 Sekunden nachsehen, ob jemand (auch an einem anderen Rechner) etwas geändert hat.
  // Ist gerade kein Fenster offen, werden die Listen sofort neu geladen; sonst erst nach dem Schließen – damit keine Eingabe verloren geht.
  const seen = useRef<number | null>(null);
  const [pending, setPending] = useState(false);
  const open = stack.length > 0;
  useEffect(() => {
    let stop = false;
    const check = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        const r = await api<{ rev: number }>('GET', '/sync');
        if (stop) return;
        if (seen.current !== null && r.rev !== seen.current) setPending(true);
        seen.current = r.rev;
      } catch { /* gerade nicht erreichbar – beim nächsten Mal wieder */ }
    };
    void check();
    const t = setInterval(() => void check(), 8000);
    const vis = () => void check();
    document.addEventListener('visibilitychange', vis);
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, []);
  useEffect(() => { if (pending && !open) { setPending(false); setRev((r) => r + 1); } }, [pending, open]);
  const close = (i: number) => setStack((s) => s.filter((_, j) => j !== i));
  return (
    <Ctx.Provider value={value}>
      {children}
      {pending && open && <div className="syncnote" role="status">Inzwischen wurde an anderer Stelle etwas geändert. Die Listen werden aktualisiert, sobald dieses Fenster geschlossen ist.</div>}
      {stack.map((o, i) => {
        const onClose = () => close(i);
        if (o.kind === 'booking') return <BookingDialog key={i} id={o.id} onClose={onClose} />;
        if (o.kind === 'new') return <NewBooking key={i} preset={o.preset} onClose={onClose} />;
        if (o.kind === 'guest') return <GuestDialog key={i} id={o.id} onClose={onClose} />;
        if (o.kind === 'company') return <CompanyDialog key={i} id={o.id} onClose={onClose} />;
        if (o.kind === 'invoice') return <InvoiceDialog key={i} id={o.id} onClose={onClose} />;
        return <BlockDialog key={i} preset={o.preset} onClose={onClose} />;
      })}
    </Ctx.Provider>
  );
}
