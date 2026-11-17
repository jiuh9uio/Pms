import { useEffect, useState } from 'react';
import { formatMoney, moneyInput, parseMoney } from '../../../src/shared/hotel.js';
import type { TaxRateDto } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Button, Dialog, Field, LoadState, useLoad, useToast } from '../ui.tsx';

interface Suggestion {
  rooms: string[]; lodgingCents: number; cancelledOn: string; noShow: boolean; policyEnabled: boolean;
  freeUntil: string | null; free: boolean; feePercent: number; feeCents: number; existingDraftOrInvoice: string | null;
}

/** Ausfallgebühr für stornierte / nicht angereiste Zimmer als Rechnungsentwurf anlegen (Vorschlag nach den Stornobedingungen). */
export function CancelFeeDialog({ bookingId, onClose }: { bookingId: string; onClose: () => void }) {
  const { bump, openInvoice } = useData();
  const toast = useToast();
  const s = useLoad(() => api<Suggestion>('GET', `/bookings/${bookingId}/cancel-fee`));
  const rates = useLoad(() => api<TaxRateDto[]>('GET', '/tax-rates')).data?.filter((r) => r.active) ?? [];
  const [amount, setAmount] = useState('');
  const [rate, setRate] = useState('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  useEffect(() => { if (s.data && s.data.feeCents > 0) setAmount(moneyInput(s.data.feeCents)); }, [s.data]);
  const cents = parseMoney(amount);
  const ok = Number.isInteger(cents) && cents > 0 && rate !== '';
  const save = async () => {
    setBusy(true); setFail(null);
    try {
      const r = await api<{ invoiceId: string }>('POST', `/bookings/${bookingId}/cancel-fee`, { amountCents: cents, taxRatePercent: Number(rate), text });
      toast('Rechnungsentwurf mit der Ausfallgebühr angelegt – bitte prüfen und ausstellen'); bump(); onClose(); openInvoice(r.invoiceId);
    } catch (e) { setFail(e instanceof Error ? e.message : 'Fehler'); }
    setBusy(false);
  };
  const d = s.data;
  return (
    <Dialog title="Ausfallgebühr berechnen" onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={busy} disabled={!ok || !!d?.existingDraftOrInvoice} onClick={() => void save()}>Rechnungsentwurf anlegen</Button></>}>
      {!d ? <LoadState error={s.error} loading /> : <>
        <ul className="plain">
          <li><span>Zimmer</span><b>{d.rooms.join(', ')}</b></li>
          <li><span>{d.noShow ? 'Nicht angereist am' : 'Storniert am'}</span><b>{deDate(d.cancelledOn)}</b></li>
          <li><span>Zimmerpreis der betroffenen Nächte</span><b>{formatMoney(d.lodgingCents)}</b></li>
          {d.policyEnabled
            ? <li><span>Stornobedingungen</span><b>{d.free ? `kostenfrei (bis ${d.freeUntil ? deDate(d.freeUntil) : '–'})` : `${d.feePercent} % = ${formatMoney(d.feeCents)}`}</b></li>
            : <li><span>Stornobedingungen</span><b>nicht eingestellt – Betrag bitte selbst eintragen</b></li>}
        </ul>
        {d.existingDraftOrInvoice && <p className="notice warn">Für diese Reservierung gibt es schon eine Ausfallgebühr ({d.existingDraftOrInvoice}).</p>}
        {d.free && d.policyEnabled && <p className="notice small">Laut Ihren Bedingungen war diese Stornierung kostenfrei. Sie können trotzdem einen Betrag eintragen, z. B. nach Absprache.</p>}
        <div className="formgrid">
          <Field label="Betrag (brutto)"><input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Umsatzsteuer"><select value={rate} onChange={(e) => setRate(e.target.value)}>
            <option value="">bitte wählen …</option>
            {rates.map((r) => <option key={r.id} value={String(r.ratePercent)}>{r.name} ({r.ratePercent.toLocaleString('de-DE')} %)</option>)}
            <option value="0">ohne Umsatzsteuer (0 %)</option>
          </select></Field>
          <Field label="Zusatz auf der Rechnung (optional)" wide><input value={text} maxLength={120} placeholder="z. B. laut Stornobedingungen in der Buchungsbestätigung" onChange={(e) => setText(e.target.value)} /></Field>
        </div>
        <p className="muted small">Es wird nur ein <b>Entwurf</b> angelegt – Sie prüfen ihn und stellen ihn wie jede Rechnung selbst aus. Ob und mit welchem Steuersatz eine Ausfallgebühr umsatzsteuerpflichtig ist, habe ich nicht geprüft – bitte mit dem Steuerberater klären.</p>
        {fail && <p className="notice danger" role="alert">{fail}</p>}
      </>}
    </Dialog>
  );
}
