import { useEffect, useState } from 'react';
import { formatMoney, parseMoney } from '../../../src/shared/hotel.js';
import type { TaxRateDto } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { Button, Dialog, Field, LoadState, useLoad, useToast } from '../ui.tsx';

interface InHouseRoom { bookingRoomId: string; bookingId: string; room: string; guest: string; bookingNumber: string; to: string }

/** Restaurant: Verzehr eines Hotelgastes auf seine Zimmerrechnung schreiben. */
export function RoomChargeDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const rooms = useLoad(() => api<InHouseRoom[]>('GET', '/restaurant/in-house'));
  const rates = useLoad(() => api<TaxRateDto[]>('GET', '/tax-rates')).data?.filter((r) => r.active) ?? [];
  const [v, setV] = useState({ bookingRoomId: '', name: 'Restaurant', amount: '', taxRateId: '' });
  // Steuersatz für Leistungen vorwählen (Einstellungen → Steuersätze); änderbar
  const svc = rates.find((r) => r.defaultFor === 'services')?.id ?? '';
  useEffect(() => { if (svc && !v.taxRateId) setV((x) => ({ ...x, taxRateId: svc })); }, [svc]);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const cents = parseMoney(v.amount);
  const room = rooms.data?.find((r) => r.bookingRoomId === v.bookingRoomId);
  const ok = !!v.bookingRoomId && Number.isInteger(cents) && cents > 0 && !!v.taxRateId && !!v.name.trim();
  const save = async () => {
    setBusy(true); setFail(null);
    try {
      const r = await api<{ room: string }>('POST', '/restaurant/room-charge', { bookingRoomId: v.bookingRoomId, name: v.name, amountCents: cents, taxRateId: v.taxRateId });
      toast(`${formatMoney(cents)} auf Zimmer ${r.room} geschrieben`); onClose();
    } catch (e) { setFail(e instanceof Error ? e.message : 'Fehler'); }
    setBusy(false);
  };
  return (
    <Dialog title="Aufs Zimmer schreiben" onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={busy} disabled={!ok} onClick={() => void save()}>{ok ? `${formatMoney(cents)} aufs Zimmer` : 'Aufs Zimmer'}</Button></>}>
      {!rooms.data ? <LoadState error={rooms.error} loading /> : rooms.data.length === 0 ? <p className="notice">Gerade ist kein Hotelgast eingecheckt.</p> : <>
        <Field label="Zimmer">
          <div className="roompick">{rooms.data.map((r) => (
            <button key={r.bookingRoomId} type="button" className={v.bookingRoomId === r.bookingRoomId ? 'on' : ''} onClick={() => setV({ ...v, bookingRoomId: r.bookingRoomId })}>
              <b>{r.room}</b><small>{r.guest}</small>
            </button>
          ))}</div>
        </Field>
        <div className="formgrid">
          <Field label="Bezeichnung"><input value={v.name} maxLength={80} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
          <Field label="Betrag (brutto)"><input inputMode="decimal" value={v.amount} placeholder="z. B. 38,50" onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
          <Field label="Umsatzsteuer" wide><select value={v.taxRateId} onChange={(e) => setV({ ...v, taxRateId: e.target.value })}>
            <option value="">bitte wählen …</option>{rates.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.ratePercent.toLocaleString('de-DE')} %)</option>)}</select></Field>
        </div>
        {room && <p className="muted small">Erscheint in der Reservierung {room.bookingNumber} von {room.guest} unter „Frühstück und Leistungen“ und kommt mit auf die Zimmerrechnung. Speisen und Getränke mit unterschiedlichem Steuersatz bitte als zwei Einträge buchen.</p>}
        {fail && <p className="notice danger" role="alert">{fail}</p>}
      </>}
    </Dialog>
  );
}
