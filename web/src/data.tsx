import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CalendarEntry, GuestDto } from '../../src/shared/hotel.js';
import { BlockDialog } from './hotel/BlockDialog.tsx';
import { BookingDialog } from './hotel/BookingDialog.tsx';
import { GuestDialog } from './hotel/GuestDialog.tsx';
import { NewBooking } from './hotel/NewBooking.tsx';

export interface NewPreset { roomId?: string; from?: string; to?: string; guest?: GuestDto }
export interface BlockPreset { roomId?: string; from?: string; entry?: CalendarEntry }
type Open =
  | { kind: 'booking'; id: string }
  | { kind: 'new'; preset: NewPreset }
  | { kind: 'guest'; id: string | null }
  | { kind: 'block'; preset: BlockPreset };

interface Data {
  /** Zähler: erhöht sich nach jeder Änderung, Seiten laden dann neu */
  rev: number;
  bump: () => void;
  openBooking: (id: string) => void;
  newBooking: (preset?: NewPreset) => void;
  openGuest: (id: string | null) => void;
  openBlock: (preset: BlockPreset) => void;
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
  }), [rev, push]);
  const close = (i: number) => setStack((s) => s.filter((_, j) => j !== i));
  return (
    <Ctx.Provider value={value}>
      {children}
      {stack.map((o, i) => {
        const onClose = () => close(i);
        if (o.kind === 'booking') return <BookingDialog key={i} id={o.id} onClose={onClose} />;
        if (o.kind === 'new') return <NewBooking key={i} preset={o.preset} onClose={onClose} />;
        if (o.kind === 'guest') return <GuestDialog key={i} id={o.id} onClose={onClose} />;
        return <BlockDialog key={i} preset={o.preset} onClose={onClose} />;
      })}
    </Ctx.Provider>
  );
}
