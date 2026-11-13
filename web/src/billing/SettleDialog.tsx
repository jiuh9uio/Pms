import { useEffect, useRef, useState } from 'react';
import { PAYMENT_METHODS_BILLING, type BookingBillingDto, type InvoiceDto, type TerminalProgress } from '../../../src/shared/billing.js';
import { formatMoney, isActiveStatus, moneyInput, parseMoney, todayBerlin, type BookingDto } from '../../../src/shared/hotel.js';
import type { HotelSettings } from '../../../src/shared/schemas.js';
import { ApiFailure, api } from '../api.ts';
import { useData } from '../data.tsx';
import { Button, Dialog, Field, LoadState, useLoad } from '../ui.tsx';

type Method = (typeof PAYMENT_METHODS_BILLING)[number];
type Step = { kind: 'form' } | { kind: 'working'; text: string } | { kind: 'unknown'; amountCents: number; message: string } | { kind: 'done'; lines: string[]; invoiceId: string | null };
const PHASE: Record<TerminalProgress['phase'], string> = {
  idle: 'Zahlung wird vorbereitet …', preparing: 'Zahlung wird vorbereitet …', connecting: 'Verbindung zum Terminal wird hergestellt …',
  payment: 'Zahlung läuft – der Betrag steht am Terminal, bitte den Gast dort zahlen lassen.',
};

/** Bezahlen / Abrechnen einer Reservierung: Zusammenfassung, optional Rechnung ausstellen, Zahlungsart, Zahlung. */
export function SettleDialog({ booking, onClose }: { booking: BookingDto; onClose: () => void }) {
  const { rev, bump } = useData();
  const today = todayBerlin();
  const bill = useLoad(() => api<BookingBillingDto>('GET', `/bookings/${booking.id}/billing`), [booking.id, rev]);
  const hotel = useLoad(() => api<HotelSettings>('GET', '/settings/hotel')).data;
  const terminal = useLoad(() => api<{ ready: boolean }>('GET', '/terminal/status')).data;
  const [step, setStep] = useState<Step>({ kind: 'form' });
  const [method, setMethod] = useState<Method>('Bar');
  const [amount, setAmount] = useState<string | null>(null);
  const [given, setGiven] = useState('');
  const [wantInvoice, setWantInvoice] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  // während einer Terminalzahlung den Fortschritt abfragen
  const working = step.kind === 'working';
  useEffect(() => {
    if (!working || method !== 'Karte' || !terminal?.ready) return;
    const t = setInterval(() => {
      api<TerminalProgress>('GET', '/terminal/progress').then((p) => setStep((s) => (s.kind === 'working' ? { kind: 'working', text: PHASE[p.phase] } : s))).catch(() => {});
    }, 1000);
    return () => clearInterval(t);
  }, [working, method, terminal?.ready]);

  const d = bill.data;
  if (!d) return <Dialog title="Bezahlen / Abrechnen" onClose={onClose}><LoadState error={bill.error} loading /></Dialog>;
  const rooms = booking.rooms.filter((r) => isActiveStatus(r.status));
  const lodging = rooms.reduce((s, r) => s + r.lodgingCents, 0);
  const total = lodging + booking.chargesCents;
  const openOnInvoices = d.invoices.filter((i) => i.status === 'issued' && i.kind === 'invoice').reduce((s, i) => s + i.openCents, 0);
  const balance = Math.max(total - d.paidCents, openOnInvoices, 0);
  const arrived = rooms.some((r) => r.from <= today);
  const invoiceNow = (wantInvoice ?? arrived) && d.uninvoicedCents > 0;
  const transfer = method === 'Überweisung';
  const amountStr = amount ?? (balance > 0 ? moneyInput(balance) : '');
  const amountCents = transfer ? 0 : parseMoney(amountStr);
  const givenCents = method === 'Bar' && given.trim() ? parseMoney(given) : null;
  const change = givenCents != null && Number.isFinite(givenCents) && Number.isFinite(amountCents) ? givenCents - amountCents : null;
  const useTerminal = method === 'Karte' && !!terminal?.ready;
  const nothing = !invoiceNow && (transfer || !(amountCents > 0));

  const run = async (manualCard = false) => {
    if (running.current) return; // Schutz gegen doppeltes Auslösen
    setError(null);
    if (!transfer && amountStr.trim() && (!Number.isInteger(amountCents) || amountCents < 0)) { setError('Bitte einen gültigen Betrag eintragen'); return; }
    if (!transfer && amountCents > balance) { setError(`Es sind nur noch ${formatMoney(balance)} offen`); return; }
    if (change != null && change < 0) { setError('Der gegebene Betrag ist kleiner als der Zahlbetrag'); return; }
    running.current = true;
    const lines: string[] = [];
    let invoiceId: string | null = null;
    try {
      // Erst die Zahlung, dann die Rechnung: So steht die Zahlung schon auf der Rechnung, wenn sie ausgestellt und archiviert wird.
      if (!transfer && amountCents > 0) {
        if (useTerminal && !manualCard) {
          setStep({ kind: 'working', text: PHASE.preparing });
          const r = await api<{ message: string }>('POST', '/payments/terminal', { bookingId: booking.id, amountCents, payer: '', note: '' });
          lines.push(`${formatMoney(amountCents)}: ${r.message}`);
        } else {
          setStep({ kind: 'working', text: 'Zahlung wird gebucht …' });
          await api('POST', '/payments', { bookingId: booking.id, amountCents, method, date: today, payer: '', note: manualCard ? 'Kartenzahlung am Gerät, von Hand bestätigt' : '', givenCents });
          lines.push(`${formatMoney(amountCents)} (${method}) gebucht${change != null && change > 0 ? ` – Rückgeld ${formatMoney(change)}` : ''}`);
        }
      }
      if (invoiceNow) {
        setStep({ kind: 'working', text: 'Rechnung wird ausgestellt …' });
        const created = await api<{ id: string }>('POST', '/invoices', { bookingId: booking.id, include: 'all' });
        invoiceId = created.id;
        try {
          const draft = await api<InvoiceDto>('GET', `/invoices/${created.id}`);
          const issued = await api<InvoiceDto>('POST', `/invoices/${created.id}/issue`, { version: draft.version });
          lines.push(`Rechnung ${issued.number} über ${formatMoney(issued.grossCents)} ausgestellt`);
        } catch (e) {
          // Ausstellen nicht möglich (z. B. fehlen Angaben in den Einstellungen): den eben angelegten Entwurf wieder entfernen
          await api('POST', `/invoices/${created.id}/remove`).catch(() => {});
          throw lines.length ? new Error(`Die Zahlung ist gebucht, die Rechnung konnte aber nicht ausgestellt werden: ${e instanceof Error ? e.message : 'Fehler'}`) : e;
        }
      }
      if (transfer) lines.push('Zahlung per Überweisung: bleibt offen, bis der Zahlungseingang gebucht wird');
      bump();
      setStep({ kind: 'done', lines, invoiceId });
    } catch (e) {
      bump();
      if (e instanceof ApiFailure && e.code === 'terminal_unknown') setStep({ kind: 'unknown', amountCents, message: e.message });
      else { setError([...lines, e instanceof Error ? e.message : 'Fehler'].join(' · ')); setStep({ kind: 'form' }); }
    }
    running.current = false;
  };

  /** Ungeklärtes Terminalergebnis von Hand abgleichen: nach Prüfung am Gerät als Kartenzahlung buchen. */
  const confirmUnknown = async (amountOfCard: number) => {
    if (running.current) return;
    running.current = true;
    try {
      await api('POST', '/payments', { bookingId: booking.id, amountCents: amountOfCard, method: 'Karte', date: today, payer: '', note: 'Terminalergebnis ungeklärt – nach Prüfung am Gerät von Hand bestätigt' });
      bump();
      setStep({ kind: 'done', lines: [`${formatMoney(amountOfCard)} (Karte) nach Prüfung am Gerät gebucht`], invoiceId: null });
    } catch (e) { setError(e instanceof Error ? e.message : 'Fehler'); setStep({ kind: 'form' }); }
    running.current = false;
  };

  const title = `Bezahlen / Abrechnen · ${booking.number}`;
  if (step.kind === 'working') return (
    <Dialog title={title} onClose={() => {}}>
      <p className="notice" role="status">{step.text}</p>
      <p className="muted small">Bitte dieses Fenster geöffnet lassen und nicht erneut auslösen.</p>
    </Dialog>
  );
  if (step.kind === 'unknown') return (
    <Dialog title={title} onClose={onClose} footer={<>
      <Button onClick={() => { setStep({ kind: 'form' }); }}>Nein, nicht gezahlt</Button>
      <Button variant="primary" onClick={() => void confirmUnknown(step.amountCents)}>Ja, am Gerät gezahlt – jetzt buchen</Button>
    </>}>
      <p className="notice warn"><b>Ergebnis unbekannt – Überprüfung erforderlich.</b> {step.message}</p>
      <p>Bitte am EC-Gerät oder auf dessen Beleg nachsehen, ob die Zahlung über <b>{formatMoney(step.amountCents)}</b> durchgeführt wurde. Erst danach hier auswählen. Bitte nicht noch einmal kassieren, bevor das geklärt ist.</p>
    </Dialog>
  );
  if (step.kind === 'done') return (
    <Dialog title={title} onClose={onClose} footer={<>
      {step.invoiceId && <a className="btn" href={`/api/v1/invoices/${step.invoiceId}/pdf`} target="_blank" rel="noopener">Rechnung drucken / PDF</a>}
      <Button variant="primary" onClick={onClose}>Fertig</Button>
    </>}>
      <p className="notice"><b>Erledigt.</b></p>
      <ul>{step.lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </Dialog>
  );

  return (
    <Dialog title={title} onClose={onClose} size="lg"
      footer={<>
        <Button onClick={onClose}>Abbrechen</Button>
        {useTerminal && amountCents > 0 && <Button onClick={() => { if (window.confirm('Kartenzahlung ohne Terminal-Rückmeldung buchen? Nur verwenden, wenn die Zahlung am Gerät bereits erfolgreich war.')) void run(true); }}>Karte von Hand bestätigen</Button>}
        <Button variant="primary" disabled={nothing} onClick={() => void run()}>
          {transfer ? (invoiceNow ? 'Rechnung ausstellen (Zahlung offen)' : 'Nichts zu tun') : useTerminal ? 'Zahlung am Terminal starten' : method === 'Karte' ? 'Kartenzahlung bestätigen' : method === 'Bar' ? 'Barzahlung bestätigen' : 'Zahlung buchen'}
        </Button>
      </>}>
      <div className="split">
        <div>
          <h3 className="first">Zusammenfassung</h3>
          <table className="sums"><tbody>
            <tr><td>Übernachtung ({rooms.length} {rooms.length === 1 ? 'Zimmer' : 'Zimmer'})</td><td className="num">{formatMoney(lodging)}</td></tr>
            <tr><td>Frühstück und Leistungen</td><td className="num">{formatMoney(booking.chargesCents)}</td></tr>
            <tr className="sum"><td>Gesamt (brutto)</td><td className="num">{formatMoney(total)}</td></tr>
            <tr><td>Bereits bezahlt (inkl. Anzahlungen)</td><td className="num">{formatMoney(d.paidCents)}</td></tr>
            <tr className="sum"><td>Noch zu zahlen</td><td className="num">{formatMoney(balance)}</td></tr>
          </tbody></table>
          <h3>Rechnung</h3>
          {d.uninvoicedCents > 0 ? (
            <label className="check"><input type="checkbox" checked={invoiceNow} onChange={(e) => setWantInvoice(e.target.checked)} />
              <span>Rechnung jetzt ausstellen <small>über {formatMoney(d.uninvoicedCents)} – noch nicht berechnete Leistungen. Ohne Haken wird eine Zahlung als Anzahlung gebucht.</small></span></label>
          ) : <p className="muted">Alle Leistungen stehen bereits auf einer Rechnung{openOnInvoices > 0 ? `; darauf sind noch ${formatMoney(openOnInvoices)} offen` : ''}.</p>}
          {d.invoices.some((i) => i.status === 'draft') && <p className="notice warn">Es gibt einen Rechnungsentwurf zu dieser Reservierung. Seine Positionen gelten als berechnet – bitte den Entwurf ausstellen oder verwerfen.</p>}
        </div>
        <div>
          <h3 className="first">Zahlungsart</h3>
          <div className="segmented wrap" role="radiogroup" aria-label="Zahlungsart">
            {(['Bar', 'Karte', 'Überweisung'] as const).map((m) => <button key={m} type="button" role="radio" aria-checked={method === m} className={method === m ? 'on' : ''} onClick={() => { setMethod(m); setError(null); }}>{m === 'Karte' ? 'EC / Karte' : m}</button>)}
            <select value={['Bar', 'Karte', 'Überweisung'].includes(method) ? '' : method} onChange={(e) => e.target.value && setMethod(e.target.value as Method)} aria-label="Weitere Zahlungsart">
              <option value="">weitere …</option>{PAYMENT_METHODS_BILLING.slice(3).map((m) => <option key={m}>{m}</option>)}
            </select>
          </div>
          {transfer ? (
            <>
              <p className="muted">Es wird <b>keine Zahlung gebucht</b>. Die Rechnung bleibt offen, bis der Zahlungseingang unter „Rechnungsarchiv“ oder in der Reservierung gebucht wird.</p>
              {hotel?.iban ? <p>{[hotel.bankName, `IBAN ${hotel.iban}`, hotel.bic && `BIC ${hotel.bic}`].filter(Boolean).join(' · ')}<br /><small className="muted">Verwendungszweck: die Rechnungsnummer (steht auf der Rechnung)</small></p>
                : <p className="notice warn">In den Einstellungen ist keine Bankverbindung hinterlegt.</p>}
            </>
          ) : (
            <div className="formgrid">
              <Field label="Betrag" hint={balance > 0 ? `offen: ${formatMoney(balance)} – ein kleinerer Betrag ist eine Teilzahlung` : 'Es ist nichts mehr offen'}><input inputMode="decimal" value={amountStr} onChange={(e) => setAmount(e.target.value)} /></Field>
              {method === 'Bar' && <Field label="Gegeben (optional)" hint={change != null && change >= 0 ? `Rückgeld: ${formatMoney(change)}` : 'für die Rückgeld-Berechnung'}><input inputMode="decimal" value={given} onChange={(e) => setGiven(e.target.value)} /></Field>}
            </div>
          )}
          {method === 'Karte' && (terminal?.ready
            ? <p className="muted small">Der Betrag wird an das EC-Gerät gesendet. Gebucht wird nur bei eindeutiger Erfolgsmeldung des Geräts.</p>
            : <p className="muted small">Kein EC-Gerät angebunden: Bitte am Gerät kassieren und hier erst nach erfolgreicher Zahlung bestätigen.</p>)}
          {method === 'Bar' && <p className="muted small">Das Programm ersetzt keine Registrierkasse mit TSE. Ob Barzahlungen zusätzlich in Ihrer Kasse zu erfassen sind, klärt die Steuerberatung.</p>}
          {error && <p className="notice danger" role="alert">{error}</p>}
        </div>
      </div>
    </Dialog>
  );
}
