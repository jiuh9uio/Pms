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
  const [v, setV] = useState({ bookingRoomId: '', name: 'Restaurant', amount: '', taxRateId: '', food: '', drinks: '' });
  // seit 1.1.2026: Speisen 7 %, Getränke 19 % – getrennt erfassen, wenn beide Sätze angelegt sind
  const foodRate = rates.find((r) => r.ratePercent === 7 && /speis/i.test(r.name)) ?? rates.find((r) => r.ratePercent === 7);
  const drinkRate = rates.find((r) => r.ratePercent === 19);
  const split = !!foodRate && !!drinkRate;
  // Steuersatz für Leistungen vorwählen (Einstellungen → Steuersätze); änderbar
  const svc = rates.find((r) => r.defaultFor === 'services')?.id ?? '';
  useEffect(() => { if (svc && !v.taxRateId) setV((x) => ({ ...x, taxRateId: svc })); }, [svc]);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const val = (x: string) => (x.trim() ? parseMoney(x) : 0);
  const food = val(v.food), drinks = val(v.drinks);
  const cents = split ? food + drinks : parseMoney(v.amount);
  const room = rooms.data?.find((r) => r.bookingRoomId === v.bookingRoomId);
  const ok = !!v.bookingRoomId && !!v.name.trim() && (split
    ? Number.isInteger(food) && Number.isInteger(drinks) && food >= 0 && drinks >= 0 && food + drinks > 0
    : Number.isInteger(cents) && cents > 0 && !!v.taxRateId);
  const save = async () => {
    setBusy(true); setFail(null);
    try {
      let room = '';
      if (split) {
        if (food > 0) room = (await api<{ room: string }>('POST', '/restaurant/room-charge', { bookingRoomId: v.bookingRoomId, name: `${v.name} – Speisen`, amountCents: food, taxRateId: foodRate!.id })).room;
        if (drinks > 0) room = (await api<{ room: string }>('POST', '/restaurant/room-charge', { bookingRoomId: v.bookingRoomId, name: `${v.name} – Getränke`, amountCents: drinks, taxRateId: drinkRate!.id })).room;
      } else room = (await api<{ room: string }>('POST', '/restaurant/room-charge', { bookingRoomId: v.bookingRoomId, name: v.name, amountCents: cents, taxRateId: v.taxRateId })).room;
      toast(`${formatMoney(cents)} auf Zimmer ${room} geschrieben`); onClose();
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
          {split ? <>
            <Field label="Speisen (7 %, brutto)"><input inputMode="decimal" value={v.food} placeholder="z. B. 28,50" onChange={(e) => setV({ ...v, food: e.target.value })} /></Field>
            <Field label="Getränke (19 %, brutto)"><input inputMode="decimal" value={v.drinks} placeholder="z. B. 10,00" onChange={(e) => setV({ ...v, drinks: e.target.value })} /></Field>
          </> : <>
            <Field label="Betrag (brutto)"><input inputMode="decimal" value={v.amount} placeholder="z. B. 38,50" onChange={(e) => setV({ ...v, amount: e.target.value })} /></Field>
            <Field label="Umsatzsteuer" wide><select value={v.taxRateId} onChange={(e) => setV({ ...v, taxRateId: e.target.value })}>
              <option value="">bitte wählen …</option>{rates.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.ratePercent.toLocaleString('de-DE')} %)</option>)}</select></Field>
          </>}
        </div>
        {room && <p className="muted small">Erscheint in der Reservierung {room.bookingNumber} von {room.guest} unter „Frühstück und Leistungen“ und kommt mit auf die Zimmerrechnung. {split ? 'Speisen und Getränke werden als zwei Posten gebucht (7 % / 19 %).' : 'Speisen (7 %) und Getränke (19 %) bitte als zwei Einträge buchen.'}</p>}
        {fail && <p className="notice danger" role="alert">{fail}</p>}
      </>}
    </Dialog>
  );
}
