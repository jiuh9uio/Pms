import { useState } from 'react';
import { CHART_DEFAULTS, PAYMENT_METHODS_BILLING, accountingSettingsInput, type AccountingSettings, type InvoiceListRow } from '../../../src/shared/billing.js';
import { formatMoney, todayBerlin } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { InvoiceStatus } from '../billing/InvoiceDialog.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { Button, Dialog, Field, LoadState, PageHeader, useLoad, useToast } from '../ui.tsx';
import { useAuth } from '../App.tsx';

const STATUS: [string, string][] = [['archive', 'Alle Rechnungen'], ['open', 'Offen'], ['paid', 'Bezahlt'], ['cancelled', 'Storniert'], ['draft', 'Entwürfe']];
/** Freie Rechnungen: Kostenvoranschläge und Entwürfe gehören zum Alltag und stehen deshalb vorn */
const STATUS_FREE: [string, string][] = [['', 'Alle'], ['estimate', 'Kostenvoranschläge'], ['draft', 'Rechnungsentwürfe'], ['open', 'Offen'], ['paid', 'Bezahlt'], ['cancelled', 'Storniert']];

/**
 * Rechnungsarchiv mit Suche, Filtern, Summen und PDF – in zwei Ansichten:
 * hotel = Rechnungen zu Reservierungen; free = freie Rechnungen und Kostenvoranschläge (ohne Reservierung).
 */
export function Invoices({ scope = 'hotel' }: { scope?: 'hotel' | 'free' }) {
  const isFree = scope === 'free';
  const { rev, bump, openInvoice, openBooking } = useData();
  const toast = useToast();
  const today = todayBerlin();
  const [f, setF] = useState({ status: isFree ? '' : 'archive', q: '', from: '', to: '', serviceFrom: '', serviceTo: '', method: '' });
  const [more, setMore] = useState(false);
  const [from, setFrom] = useState(today.slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const params = new URLSearchParams({ scope });
  for (const [k, v] of Object.entries(f)) if (v.trim()) params.set(k, v.trim());
  const { data, error } = useLoad(() => api<InvoiceListRow[]>('GET', '/invoices?' + params), [params.toString(), rev]);
  const sum = (k: 'grossCents' | 'paidCents' | 'openCents') => (data ?? []).filter((i) => i.status !== 'draft').reduce((s, i) => s + i[k], 0);
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const [creating, setCreating] = useState(false);
  const [accounts, setAccounts] = useState(false);
  const { user } = useAuth();
  const free = async (estimate = false) => {
    if (creating) return;
    setCreating(true);
    try {
      const r = await api<{ id: string }>('POST', '/invoices', { include: 'none' });
      if (estimate) await api('POST', `/invoices/${r.id}/estimate`);
      bump(); openInvoice(r.id);
    }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setCreating(false);
  };
  const filtered = !!(f.from || f.to || f.serviceFrom || f.serviceTo || f.method);
  return (
    <>
      <PageHeader title={isFree ? 'Freie Rechnungen & Kostenvoranschläge' : 'Hotelrechnungen'}
        sub={isFree ? 'Rechnungen und Kostenvoranschläge ohne Reservierung – z. B. Getränkelieferung, Raummiete, Außer-Haus-Verkauf' : 'Rechnungen und Stornobelege zu Reservierungen – suchen, filtern, ansehen, drucken, versenden'}
        actions={isFree ? <><Button variant="primary" busy={creating} onClick={() => void free(true)} title="Empfänger und Positionen frei eintragen; PDF mit der Überschrift „Kostenvoranschlag“ und eigener Nummer. Später wird daraus mit einem Klick die Rechnung.">+ Kostenvoranschlag</Button><Button onClick={() => void free()}>+ Freie Rechnung</Button></> : <a className="btn" href="/freie-rechnungen">Freie Rechnungen & Kostenvoranschläge</a>} />
      <div className="filters">
        <div className="segmented" role="radiogroup" aria-label="Status">
          {(isFree ? STATUS_FREE : STATUS).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={f.status === k} className={f.status === k ? 'on' : ''} onClick={() => set({ status: k })}>{l}</button>)}
        </div>
        <input type="search" placeholder={isFree ? 'Nummer, Name, Firma …' : 'Rechnungsnummer, Gast, Firma, Reservierungsnummer …'} value={f.q} onChange={(e) => set({ q: e.target.value })} aria-label="Suche" />
        <Button onClick={() => setMore(!more)} aria-expanded={more}>{more ? 'Weniger Filter' : `Weitere Filter${filtered ? ' (aktiv)' : ''}`}</Button>
      </div>
      {more && (
        <div className="filters card">
          <label className="inlinelabel">Rechnungsdatum von <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} /></label>
          <label className="inlinelabel">bis <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} /></label>
          <label className="inlinelabel">Leistungszeitraum von <input type="date" value={f.serviceFrom} onChange={(e) => set({ serviceFrom: e.target.value })} /></label>
          <label className="inlinelabel">bis <input type="date" value={f.serviceTo} onChange={(e) => set({ serviceTo: e.target.value })} /></label>
          <label className="inlinelabel">Zahlungsart <select value={f.method} onChange={(e) => set({ method: e.target.value })}><option value="">alle</option>{PAYMENT_METHODS_BILLING.map((m) => <option key={m}>{m}</option>)}</select></label>
          {filtered && <Button onClick={() => set({ from: '', to: '', serviceFrom: '', serviceTo: '', method: '' })}>Filter zurücksetzen</Button>}
        </div>
      )}
      <LoadState error={error} loading={!data} />
      {data && (data.length === 0 ? <p className="muted">{isFree ? 'Hier ist noch nichts. Oben mit „+ Kostenvoranschlag“ oder „+ Freie Rechnung“ beginnen.' : 'Keine Rechnungen gefunden. Rechnungen entstehen in der Reservierung über „Bezahlen / Abrechnen“. Freie Rechnungen und Kostenvoranschläge stehen in einem eigenen Bereich.'}</p> : (
        <div className="tablewrap card flush"><table>
          <thead><tr><th>Nummer</th><th>Datum</th><th>Empfänger</th><th className="hide-sm">Leistung</th>{!isFree && <th className="hide-sm">Reservierung</th>}<th>Status</th><th className="num">Betrag</th><th className="num hide-sm">Bezahlt</th><th className="num">Offen</th><th /></tr></thead>
          <tbody>{data.map((i) => (
            <tr key={i.id} className="rowlink" tabIndex={0} onClick={() => openInvoice(i.id)} onKeyDown={(e) => { if (e.key === 'Enter') openInvoice(i.id); }}>
              <td className="strong nowrap">{i.number ?? i.estimateNumber ?? 'Entwurf'}{!i.number && i.estimateNumber && <><br /><small className="muted">Kostenvoranschlag</small></>}</td><td className="nowrap">{i.issueDate ? deDate(i.issueDate) : '–'}</td>
              <td>{i.recipientCompany || i.recipientName}{i.recipientCompany && i.recipientName && <><br /><small>{i.recipientName}</small></>}</td>
              <td className="hide-sm nowrap">{i.serviceFrom ? `${deDate(i.serviceFrom)}${i.serviceTo && i.serviceTo !== i.serviceFrom ? ` – ${deDate(i.serviceTo)}` : ''}` : '–'}</td>
              {!isFree && <td className="hide-sm">{i.bookingId ? <button type="button" className="linkbtn" onClick={(e) => { e.stopPropagation(); openBooking(i.bookingId!); }}>{i.bookingNumber}</button> : '–'}</td>}
              <td><InvoiceStatus inv={i} /></td>
              <td className="num">{formatMoney(i.grossCents)}</td><td className="num hide-sm">{i.status === 'draft' ? '–' : formatMoney(i.paidCents)}</td><td className="num">{i.openCents ? formatMoney(i.openCents) : '–'}</td>
              <td className="nowrap">{i.status !== 'draft' && <a className="linkbtn" href={`/api/v1/invoices/${i.id}/pdf`} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>PDF</a>}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={3}>{data.length} {data.length === 1 ? 'Eintrag' : 'Einträge'}{data.length >= 500 ? ' (höchstens 500 – bitte Filter eingrenzen)' : ''}</td><td className="hide-sm" />{!isFree && <td className="hide-sm" />}<td />
            <td className="num">{formatMoney(sum('grossCents'))}</td><td className="num hide-sm">{formatMoney(sum('paidCents'))}</td><td className="num">{formatMoney(sum('openCents'))}</td><td /></tr></tfoot>
        </table></div>
      ))}
      <p className="muted small">Ausgestellte Rechnungen lassen sich nicht ändern oder löschen; eine Korrektur erfolgt durch einen Stornobeleg (nur Administrator) und eine neue Rechnung. Das PDF wird beim Ausstellen gespeichert und danach unverändert ausgegeben. In den Summen zählen Stornobelege mit negativem Betrag.</p>
      <section className="card">
        <h2>Export für die Buchhaltung</h2>
        <p className="muted small">Der Export enthält immer <b>alle</b> ausgestellten Rechnungen – Hotelrechnungen und freie Rechnungen zusammen.</p>
        <p className="muted">CSV-Dateien (Semikolon, deutsche Zahlen) mit allen ausgestellten Rechnungen und Stornobelegen inkl. Netto und Umsatzsteuer je Satz sowie allen Zahlungen. Die <b>Buchungsliste</b> enthält dieselben Vorgänge als Buchungen mit Soll- und Haben-Konto (Konten einstellbar). Ein DATEV-Importformat ist noch nicht enthalten.</p>
        <div className="filters">
          <label className="inlinelabel">von <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="inlinelabel">bis <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <a className="btn" href={`/api/v1/invoices/export.csv?from=${from}&to=${to}`}>Rechnungen (CSV)</a>
          <a className="btn" href={`/api/v1/payments/export.csv?from=${from}&to=${to}`}>Zahlungen (CSV)</a>
          <a className="btn primary" href={`/api/v1/accounting/export.csv?from=${from}&to=${to}`}>Buchungsliste für den Steuerberater (CSV)</a>
          {user.role === 'admin' && <Button onClick={() => setAccounts(true)}>Konten einstellen</Button>}
        </div>
        <p className="muted small">Die Konten sind ein Vorschlag (übliche Konten im SKR03 bzw. SKR04) und <b>nicht geprüft</b> – bitte mit dem Steuerberater abstimmen, bevor die Liste verwendet wird.</p>
        {accounts && <AccountsDialog onClose={() => setAccounts(false)} />}
      </section>
    </>
  );
}

const ACCT_FIELDS: [keyof Omit<AccountingSettings, 'chart' | 'revenue'>, string][] = [
  ['receivables', 'Forderungen (Rechnungen an Gäste/Firmen)'], ['cash', 'Kasse (Bar)'], ['bank', 'Bank (Überweisung)'], ['card', 'Karte (EC/Kreditkarte, z. B. Geldtransit)'],
  ['paypal', 'PayPal'], ['voucher', 'Gutschein'],
];
/** Kontenzuordnung für die Buchungsliste (Administrator). */
function AccountsDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { data, error } = useLoad(() => api<AccountingSettings>('GET', '/settings/accounting'));
  const [v, setV] = useState<AccountingSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const cur = v ?? data ?? null;
  if (!cur) return <Dialog title="Konten für die Buchungsliste" onClose={onClose}><LoadState error={error} loading /></Dialog>;
  const save = async () => {
    const p = accountingSettingsInput.safeParse(cur);
    if (!p.success) { toast(p.error.issues[0]?.message ?? 'Bitte Eingaben prüfen', 'error'); return; }
    setBusy(true);
    try { await api('PUT', '/settings/accounting', p.data); toast('Konten gespeichert'); onClose(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  return (
    <Dialog title="Konten für die Buchungsliste" onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={busy} onClick={() => void save()}>Speichern</Button></>}>
      <p className="notice warn small">Vorschläge ohne Gewähr – bitte jedes Konto mit dem Steuerberater abstimmen.</p>
      <div className="formgrid">
        <Field label="Kontenrahmen"><select value={cur.chart} onChange={(e) => { const c = e.target.value as AccountingSettings['chart']; setV(c === 'eigen' ? { ...cur, chart: c } : { ...CHART_DEFAULTS[c] }); }}>
          <option value="SKR03">SKR03 (Vorschlag laden)</option><option value="SKR04">SKR04 (Vorschlag laden)</option><option value="eigen">eigene Konten</option></select></Field>
        {ACCT_FIELDS.map(([k, label]) => <Field key={k} label={label}><input inputMode="numeric" value={cur[k]} onChange={(e) => setV({ ...cur, chart: 'eigen', [k]: e.target.value })} /></Field>)}
        {Object.keys(cur.revenue).sort((a, b) => Number(a) - Number(b)).map((r) => (
          <Field key={r} label={`Erlöse ${r} % USt`}><input inputMode="numeric" value={cur.revenue[r]} onChange={(e) => setV({ ...cur, chart: 'eigen', revenue: { ...cur.revenue, [r]: e.target.value } })} /></Field>
        ))}
      </div>
    </Dialog>
  );
}
