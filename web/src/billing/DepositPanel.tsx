import { useState } from 'react';
import { DEPOSIT_STATE_LABEL, type DepositDto, type DepositKind } from '../../../src/shared/deposits.js';
import { addDays, formatMoney, moneyInput, parseMoney, todayBerlin, type MailDraft } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Badge, Button, Dialog, Field, useLoad, useToast } from '../ui.tsx';

const TONE = { open: 'accent', overdue: 'danger', paid: 'ok', cancelled: 'neutral' } as const;

/**
 * Anzahlungen einer Hotel- oder Tischreservierung: Liste mit Stand und „Anzahlung anfordern“.
 * Hotel: eingegangen, sobald entsprechend gezahlt ist (Zahlung in der Reservierung buchen).
 * Restaurant: Eingang von Hand vermerken.
 */
export function DepositPanel({ kind, refId, base, suggestCents, latestDue, onPay }: {
  kind: DepositKind; refId: string; base: string; suggestCents: number; latestDue: string;
  /** Hotel: Zahlung über das Zahlungsformular der Reservierung buchen */
  onPay?: (cents: number) => void;
}) {
  const { rev, bump } = useData();
  const toast = useToast();
  const { data } = useLoad(() => api<DepositDto[]>('GET', `${base}/deposits`), [base, rev]);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const act = async (d: DepositDto, what: 'paid' | 'cancel') => {
    const note = what === 'paid' ? window.prompt(`Eingang von ${formatMoney(d.amountCents)} vermerken – Hinweis (z. B. „Überweisung 12.03.“, „bar, Kassenbon 123“):`, '') : '';
    if (what === 'paid' && note === null) return;
    if (what === 'cancel' && !window.confirm(`Anzahlung über ${formatMoney(d.amountCents)} zurückziehen? (Es wird keine E-Mail gesendet.)`)) return;
    setBusy(d.id);
    try {
      await api('POST', `${kind === 'table' ? '/restaurant' : ''}/deposits/${d.id}/${what}`, what === 'paid' ? { note } : {});
      toast(what === 'paid' ? 'Eingang vermerkt' : 'Anzahlung zurückgezogen'); bump();
    } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(null);
  };
  const live = (data ?? []).filter((d) => d.state !== 'cancelled');
  const openCents = (data ?? []).filter((d) => d.state === 'open' || d.state === 'overdue').reduce((s, d) => s + d.amountCents, 0);
  return (
    <div className="deposits">
      <div className="btnrow">
        <Button onClick={() => setAsking(true)}>Anzahlung anfordern</Button>
        {kind === 'booking' && openCents > 0 && onPay && <Button variant="primary" onClick={() => onPay(openCents)}>Anzahlung buchen · {formatMoney(openCents)}</Button>}
      </div>
      {live.length > 0 && (
        <ul className="plain compact">
          {(data ?? []).map((d) => (
            <li key={d.id} className={d.state === 'cancelled' ? 'faded' : undefined}>
              <span><b>{formatMoney(d.amountCents)}</b> bis {deDate(d.dueDate)} <Badge tone={TONE[d.state]}>{DEPOSIT_STATE_LABEL[d.state]}</Badge><br />
                <small className="muted">angefordert {deDate(d.createdAt.slice(0, 10))} von {d.createdBy}{d.mailed ? ` · E-Mail an ${d.to}` : ' · ohne E-Mail'}{d.paidAt ? ` · Eingang vermerkt von ${d.paidBy}${d.paidNote ? `: ${d.paidNote}` : ''}` : ''}{d.cancelledBy ? ` · zurückgezogen von ${d.cancelledBy}` : ''}</small></span>
              <span className="right">
                {kind === 'table' && (d.state === 'open' || d.state === 'overdue') && <Button busy={busy === d.id} onClick={() => void act(d, 'paid')}>Eingang vermerken</Button>}
                {(d.state === 'open' || d.state === 'overdue') && <Button busy={busy === d.id} onClick={() => void act(d, 'cancel')}>Zurückziehen</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      {kind === 'table' && live.length > 0 && <p className="muted small">Das Programm kassiert hier nicht: Bitte die Anzahlung wie gewohnt in der Kasse buchen und hier nur den Eingang vermerken.</p>}
      {asking && <RequestDialog kind={kind} base={base} suggestCents={suggestCents} latestDue={latestDue} onClose={() => setAsking(false)} />}
    </div>
  );
}

function RequestDialog({ kind, base, suggestCents, latestDue, onClose }: { kind: DepositKind; base: string; suggestCents: number; latestDue: string; onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const today = todayBerlin();
  const due0 = (() => { const d = addDays(today, 7); return latestDue && latestDue > today && d > latestDue ? latestDue : d; })();
  const [amount, setAmount] = useState(suggestCents > 0 ? moneyInput(suggestCents) : '');
  const [due, setDue] = useState(due0);
  const [mail, setMail] = useState<{ to: string; subject: string; text: string } | null>(null);
  const [ready, setReady] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const cents = parseMoney(amount);
  const okAmount = Number.isInteger(cents) && cents >= 100;
  const loadDraft = async () => {
    setFail(null); setBusy('draft');
    try { const d = await api<MailDraft>('GET', `${base}/deposits/draft?amountCents=${cents}&dueDate=${due}`); setMail({ to: d.to, subject: d.subject, text: d.text }); setReady(d.ready); }
    catch (e) { setFail(e instanceof Error ? e.message : 'Fehler'); }
    setBusy(null);
  };
  const save = async (send: boolean) => {
    setFail(null); setBusy(send ? 'send' : 'note');
    try {
      await api('POST', `${base}/deposits`, { amountCents: cents, dueDate: due, send, ...(send && mail ? mail : {}) });
      toast(send ? `Anzahlung über ${formatMoney(cents)} angefordert – E-Mail gesendet` : `Anzahlung über ${formatMoney(cents)} vermerkt (ohne E-Mail)`);
      bump(); onClose();
    } catch (e) { setFail(e instanceof Error ? e.message : 'Fehler'); }
    setBusy(null);
  };
  return (
    <Dialog title="Anzahlung anfordern" onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Abbrechen</Button>
        {mail ? <><Button busy={busy === 'note'} disabled={!!busy} onClick={() => void save(false)}>Nur vermerken (ohne E-Mail)</Button>
          <Button variant="primary" busy={busy === 'send'} disabled={!!busy || !ready || !mail.to} onClick={() => void save(true)}>Anfordern und senden</Button></>
          : <Button variant="primary" busy={busy === 'draft'} disabled={!okAmount || !due} onClick={() => void loadDraft()}>Weiter zur E-Mail</Button>}</>}>
      <div className="formgrid">
        <Field label="Betrag" hint={kind === 'booking' && suggestCents > 0 ? 'Vorschlag: 30 % des Gesamtbetrags, gerundet' : undefined}><input inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setMail(null); }} /></Field>
        <Field label="Zahlbar bis"><input type="date" value={due} min={today} onChange={(e) => { setDue(e.target.value); setMail(null); }} /></Field>
      </div>
      {fail && <p className="notice danger" role="alert">{fail}</p>}
      {!mail ? <p className="muted small">Im nächsten Schritt erscheint die E-Mail an den Gast zum Prüfen. Angefordert ist erst nach „Anfordern und senden“ oder „Nur vermerken“ – „Abbrechen“ ändert nichts.</p> : <>
        {!ready && <p className="notice warn small">Der E-Mail-Versand ist noch nicht eingerichtet – nur „Nur vermerken“ ist möglich.</p>}
        <div className="formgrid">
          <Field label="An" wide hint={kind === 'table' ? 'Tischreservierungen haben keine E-Mail-Adresse gespeichert – bitte eintragen' : undefined}><input type="email" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} /></Field>
          <Field label="Betreff" wide><input value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} /></Field>
          <Field label="Text" wide><textarea rows={14} value={mail.text} onChange={(e) => setMail({ ...mail, text: e.target.value })} /></Field>
        </div>
      </>}
    </Dialog>
  );
}
