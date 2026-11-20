import { useState } from 'react';
import { formatMoney, moneyInput, parseMoney, todayBerlin } from '../../../src/shared/hotel.js';
import {
  yearlyNumber, PAY_METHODS, TEXT_POS, TEXT_POS_LABEL, VOUCHER_STATUS_LABEL, voucherInput, voucherInvoiceInput, voucherNumberingInput,
  type TextPos, type VoucherDto, type VoucherOverviewDto,
} from '../../../src/shared/vouchers.js';
import { api } from '../api.ts';
import { CustomerPicker } from '../CustomerPicker.tsx';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { MailDialog } from '../hotel/MailDialog.tsx';
import { DESIGN_PRESETS, type DesignPreset } from '../../../src/shared/voucherPresets.js';
import { LayoutPreview, VoucherDesignEditor } from './VoucherDesignEditor.tsx';
import { Badge, Button, Dialog, Field, LoadState, PageHeader, useLoad, useSubmit, useTabs, useToast } from '../ui.tsx';

const TONE = { active: 'ok', redeemed: 'neutral', cancelled: 'danger' } as const;

/** Gutscheine: anlegen (Nummer automatisch, Geschenkkarten-Nr. aus der Kasse), als PDF mit Motiv drucken, per E-Mail senden, Rechnung mit Porto. */
export function Vouchers() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [rev, setRev] = useState(0);
  const reload = () => setRev((r) => r + 1);
  const { data, error } = useLoad(() => api<VoucherOverviewDto>('GET', '/vouchers'), [rev]);
  const { current, bar } = useTabs([['liste', 'Gutscheinbuch'], ['motive', 'Motive'], ...(isAdmin ? [['einstellungen', 'Nummern & Porto'] as const] : [])] as const);
  const [open, setOpen] = useState<VoucherDto | 'new' | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [month, setMonth] = useState('');
  const list = (data?.vouchers ?? []).filter((v) => (!status || v.status === status) && (!month || v.issuedOn.startsWith(month))
    && (!q.trim() || [v.number, v.recipientName, v.buyerName, v.buyerCompany, v.posCardNo, v.cashier, v.payMethod].join(' ').toLowerCase().includes(q.trim().toLowerCase())));
  /** Gutscheinbuch als CSV (Excel) – zum Ablegen oder für den Steuerberater */
  const csv = () => {
    const esc = (x: string) => `"${x.replace(/"/g, '""')}"`;
    const rows = [['interne Nr.', 'Datum', 'Kassennummer', 'Wert', 'Zahlungsart', 'kassiert von', 'für', 'Käufer', 'Status', 'eingelöst am', 'eingelöst von', 'gültig bis', 'Rechnung'],
      ...list.map((v) => [v.number, deDate(v.issuedOn), v.posCardNo, (v.valueCents / 100).toFixed(2).replace('.', ','), v.payMethod, v.cashier, v.recipientName, v.buyerCompany || v.buyerName,
        VOUCHER_STATUS_LABEL[v.status], v.redeemedAt ? deDate(v.redeemedAt.slice(0, 10)) : '', v.redeemedBy ?? '', v.validUntil ? deDate(v.validUntil) : '', v.invoiceNumber ?? (v.invoiceId ? 'Entwurf' : '')])];
    const blob = new Blob(['\ufeff' + rows.map((r) => r.map((c) => esc(String(c))).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `Gutscheinbuch${month ? `-${month}` : ''}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const sum = list.filter((v) => v.status === 'active').reduce((s, v) => s + v.valueCents, 0);
  return (
    <>
      <PageHeader title="Gutscheine" sub="Das Gutscheinbuch: jeder verkaufte Gutschein mit Nummer, Wert, Zahlungsart und wer kassiert hat"
        actions={<Button variant="primary" onClick={() => setOpen('new')}>Neuer Gutschein</Button>} />
      {bar}
      <LoadState error={error} loading={!data} />
      {data && current === 'liste' && (
        <>
          <div className="filters">
            <input type="search" placeholder="Kassennummer, interne Nr., Name, Käufer …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Suche" />
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="active">gültige</option><option value="redeemed">eingelöste</option><option value="cancelled">stornierte</option><option value="">alle</option>
            </select>
            <select value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Monat">
              <option value="">alle Monate</option>
              {[...new Set((data.vouchers).map((v) => v.issuedOn.slice(0, 7)))].sort().reverse().map((m) => <option key={m} value={m}>{['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'][Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}</option>)}
            </select>
            <Button onClick={csv} disabled={!list.length}>Liste als Excel (CSV)</Button>
            {list.length > 0 && <span className="muted small">{list.length} {list.length === 1 ? 'Gutschein' : 'Gutscheine'} · zusammen {formatMoney(list.reduce((t, v) => t + v.valueCents, 0))}{status === 'active' ? ' noch offen' : ''}</span>}
          </div>
          {list.length === 0 ? <p className="muted">{data.vouchers.length ? 'Keine Gutscheine für diese Auswahl.' : 'Noch keine Gutscheine – oben rechts „Neuer Gutschein“.'}</p> : (
            <div className="card flush tablewrap"><table>
              <thead><tr><th>Nr.</th><th>Datum</th><th>Kassennummer</th><th className="num">Wert</th><th className="hide-sm">Zahlung</th><th className="hide-sm">kassiert von</th><th className="hide-sm">für / Käufer</th><th>Status</th><th className="hide-sm">Rechnung</th></tr></thead>
              <tbody>{list.map((v) => (
                <tr key={v.id} className="rowlink" tabIndex={0} onClick={() => setOpen(v)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(v); }}>
                  <td><b>{v.number}</b></td>
                  <td className="nowrap">{deDate(v.issuedOn)}</td>
                  <td>{v.posCardNo || '–'}</td>
                  <td className="num">{formatMoney(v.valueCents)}</td>
                  <td className="hide-sm">{v.payMethod || '–'}</td>
                  <td className="hide-sm">{v.cashier || '–'}</td>
                  <td className="hide-sm">{v.recipientName || v.buyerCompany || v.buyerName || '–'}</td>
                  <td><Badge tone={TONE[v.status]}>{VOUCHER_STATUS_LABEL[v.status]}</Badge>{v.redeemedAt && <><br /><small className="muted">{deDate(v.redeemedAt.slice(0, 10))}{v.redeemedBy ? ` · ${v.redeemedBy}` : ''}</small></>}</td>
                  <td className="hide-sm">{v.invoiceId ? (v.invoiceNumber ?? 'Entwurf') : '–'}</td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
        </>
      )}
      {data && current === 'motive' && <Designs data={data} isAdmin={isAdmin} onChange={reload} />}
      {data && current === 'einstellungen' && isAdmin && <NumberingCard data={data} onSaved={reload} />}
      {open && data && <VoucherDialog voucher={open === 'new' ? null : open} data={data} isAdmin={isAdmin} onClose={() => setOpen(null)} onChanged={reload} />}
    </>
  );
}

type Form = Record<'payMethod' | 'cashier' | 'number' | 'pin' | 'posCardNo' | 'value' | 'issuedOn' | 'validUntil' | 'buyerName' | 'buyerCompany' | 'buyerStreet' | 'buyerZip' | 'buyerCity' | 'buyerCountry' | 'buyerEmail' | 'recipientName' | 'message' | 'designId' | 'note', string>;

function VoucherDialog({ voucher: v, data, isAdmin, onClose, onChanged }: { voucher: VoucherDto | null; data: VoucherOverviewDto; isAdmin: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { openInvoice } = useData();
  const today = todayBerlin();
  const { user } = useAuth();
  const [more, setMore] = useState(!!v);
  const [numberTouched, setNumberTouched] = useState(false);
  const [f, setF] = useState<Form>(() => ({
    payMethod: v?.payMethod ?? 'Bar', cashier: v ? v.cashier : user.name,
    number: v?.number ?? data.nextNumber, pin: '', posCardNo: v?.posCardNo ?? '', value: v ? moneyInput(v.valueCents) : '',
    issuedOn: v?.issuedOn ?? today, validUntil: v ? v.validUntil ?? '' : data.suggestedValidUntil,
    buyerName: v?.buyerName ?? '', buyerCompany: v?.buyerCompany ?? '', buyerStreet: v?.buyerStreet ?? '', buyerZip: v?.buyerZip ?? '', buyerCity: v?.buyerCity ?? '',
    buyerCountry: v?.buyerCountry ?? 'Deutschland', buyerEmail: v?.buyerEmail ?? '', recipientName: v?.recipientName ?? '', message: v?.message ?? '',
    designId: v?.designId ?? data.designs[0]?.id ?? '', note: v?.note ?? '',
  }));
  const [mail, setMail] = useState(false);
  const [invoice, setInvoice] = useState(false);
  const [busy, setBusy] = useState('');
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const locked = v?.status === 'cancelled';
  // Neuer Gutschein: Rechnungsentwurf gleich mit anlegen (Gutschein 0 %, bei Postversand Versandkosten)
  const [inv, setInv] = useState({ create: false, post: false, postage: data.numbering.postageCents ? moneyInput(data.numbering.postageCents) : '', postageTax: '19' });
  const [invError, setInvError] = useState('');
  const s = useSubmit(voucherInput, async (d) => {
    if (v) { await api('PUT', `/vouchers/${v.id}`, { ...d, version: v.version }); toast('Gutschein gespeichert'); onChanged(); onClose(); return; }
    const created = await api<{ id: string; number: string }>('POST', '/vouchers', d);
    if (!inv.create) { toast(`Gutschein ${d.number} angelegt`); onChanged(); onClose(); return; }
    try {
      const postage = inv.post && inv.postage.trim() ? parseMoney(inv.postage) : 0;
      const r = await api<{ invoiceId: string }>('POST', `/vouchers/${created.id}/invoice`, { valueTaxPercent: 0, postageCents: Number.isNaN(postage) ? 0 : postage, postageTaxPercent: Number(inv.postageTax) });
      toast(`Gutschein ${d.number} angelegt – Rechnungsentwurf bitte prüfen und ausstellen`);
      onChanged(); onClose(); openInvoice(r.invoiceId);
    } catch (e) {
      toast(`Gutschein ${d.number} ist angelegt, die Rechnung aber nicht: ${e instanceof Error ? e.message : 'Fehler'} – bitte im Gutschein „Rechnung schreiben“.`, 'error');
      onChanged(); onClose();
    }
  });
  const save = () => {
    setInvError('');
    if (!v && inv.create && !f.buyerName.trim() && !f.buyerCompany.trim()) { setMore(true); setInvError('Für die Rechnung bitte Name oder Firma des Käufers eintragen – oder „Rechnung gewünscht“ abwählen.'); return; }
    if (!v && inv.create && inv.post && inv.postage.trim() && Number.isNaN(parseMoney(inv.postage))) { setInvError('Bitte die Versandkosten als Betrag eintragen, z. B. 2,50'); return; }
    void s.submit({ ...f, valueCents: f.value.trim() === '' ? NaN : parseMoney(f.value) });
  };
  const status = async (to: 'redeemed' | 'cancelled' | 'active') => {
    if (!v) return;
    if (to === 'cancelled' && !window.confirm(`Gutschein ${v.number} stornieren? Er bleibt in der Liste (als storniert) erhalten und lässt sich nicht mehr drucken oder senden.`)) return;
    setBusy(to);
    try { await api('POST', `/vouchers/${v.id}/status`, { status: to, version: v.version }); toast(`Gutschein ${VOUCHER_STATUS_LABEL[to]}`); onChanged(); onClose(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy('');
  };
  return (
    <Dialog title={v ? `Gutschein ${v.number}` : 'Neuer Gutschein'} onClose={onClose} size="lg"
      footer={<>
        {v && !locked && <span className="left vc-actions">
          <a className="btn" href={`/api/v1/vouchers/${v.id}/pdf`} target="_blank" rel="noopener">Ansehen / Drucken</a>
          <Button onClick={() => setMail(true)}>Per E-Mail senden</Button>
          {v.invoiceId && v.invoiceStatus !== 'cancelled' ? <Button onClick={() => openInvoice(v.invoiceId!)}>Rechnung {v.invoiceNumber ?? '(Entwurf)'} öffnen</Button> : <Button onClick={() => setInvoice(true)}>Rechnung schreiben</Button>}
        </span>}
        <Button onClick={onClose}>Schließen</Button>
        {!locked && <Button variant="primary" busy={s.busy} onClick={save}>{v ? 'Speichern' : 'Gutschein anlegen'}</Button>}
      </>}>
      {locked && <p className="notice warn">Dieser Gutschein ist storniert.</p>}
      {v?.status === 'redeemed' && <p className="notice">Als eingelöst markiert.</p>}
      <form className="formgrid" onSubmit={(e) => { e.preventDefault(); save(); }} noValidate>
        <h3 className="wide first">Eintrag ins Gutscheinbuch</h3>
        <Field label="Gutscheinnummer intern" error={s.errors.number} hint={v ? undefined : 'wird automatisch weitergezählt'}><input value={f.number} onChange={(e) => { setNumberTouched(true); set('number')(e); }} disabled={locked} /></Field>
        <Field label="Kassennummer" error={s.errors.posCardNo} hint="Nummer der Geschenkkarte aus der Kasse"><input value={f.posCardNo} onChange={set('posCardNo')} disabled={locked} autoFocus={!v} /></Field>
        <Field label="Wert" error={s.errors.valueCents}><span className="moneyin"><input inputMode="decimal" value={f.value} onChange={set('value')} placeholder="50,00" disabled={locked} /><span>€</span></span></Field>
        <Field label="Bezahlt mit" error={s.errors.payMethod}><select value={PAY_METHODS.includes(f.payMethod) || !f.payMethod ? f.payMethod : 'sonstiges'} onChange={set('payMethod')} disabled={locked}>{!v?.payMethod && v && <option value="">–</option>}{PAY_METHODS.map((m) => <option key={m}>{m}</option>)}</select></Field>
        <Field label="Kassiert von" error={s.errors.cashier}><input value={f.cashier} list="vc-cashiers" onChange={set('cashier')} disabled={locked} /></Field>
        <datalist id="vc-cashiers">{data.cashiers.map((c) => <option key={c} value={c} />)}</datalist>
        <Field label="Datum" error={s.errors.issuedOn}><input type="date" value={f.issuedOn} disabled={locked} onChange={(e) => {
          const d = e.target.value; const yearChanged = d.slice(0, 4) !== f.issuedOn.slice(0, 4);
          setF({ ...f, issuedOn: d });
          // anderes Jahr: Nummer im Jahresformat neu vorschlagen (z. B. Nachtrag aus dem Vorjahr)
          if (!v && !numberTouched && yearChanged && /^\d{4}-\d{2}-\d{2}$/.test(d)) void api<{ number: string }>('GET', `/vouchers/next-number?date=${d}`).then((r) => setF((cur) => ({ ...cur, number: r.number }))).catch(() => {});
        }} /></Field>
        {v?.status === 'redeemed' && v.redeemedAt && <p className="wide muted small">Eingelöst am {deDate(v.redeemedAt.slice(0, 10))}{v.redeemedBy ? ` – eingetragen von ${v.redeemedBy}` : ''}.</p>}
        {!v && <label className="check wide"><input type="checkbox" checked={inv.create} onChange={(e) => { setInv({ ...inv, create: e.target.checked }); if (e.target.checked) setMore(true); }} />
          <span>Rechnung gewünscht<small>z. B. für Firmen oder bei Postversand – dann entsteht ein Rechnungsentwurf (Gutschein 0 %, ggf. Versandkosten). Käufer bitte unten eintragen.</small></span></label>}
        {!more && <button type="button" className="linkbtn wide" onClick={() => setMore(true)}>+ Weitere Angaben: Gültigkeit, beschenkte Person, Gruß, Motiv, Käufer …</button>}
        {more && <>
        <h3 className="wide">Gutschein</h3>
        <Field label="Gültig bis" error={s.errors.validUntil} hint="leer = ohne Datum auf dem Gutschein"><input type="date" value={f.validUntil} onChange={set('validUntil')} disabled={locked} /></Field>

        <h3 className="wide">Für wen?</h3>
        <Field label="Beschenkte Person" error={s.errors.recipientName} hint="steht auf dem Gutschein („für …“)"><input value={f.recipientName} onChange={set('recipientName')} disabled={locked} /></Field>
        <Field label="Motiv" hint={data.designs.length ? undefined : 'Motive unter dem Reiter „Motive“ hochladen'}>
          <select value={f.designId} onChange={set('designId')} disabled={locked}><option value="">schlicht (ohne Motiv)</option>{data.designs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </Field>
        <Field label="Gruß auf dem Gutschein" error={s.errors.message} wide hint="freiwillig, z. B. „Alles Gute zum Geburtstag!“"><textarea rows={2} value={f.message} onChange={set('message')} disabled={locked} /></Field>

        <h3 className="wide">Käufer <small className="muted inl">für Rechnung und E-Mail</small></h3>
        <div className="wide"><CustomerPicker disabled={locked} onPick={(c) => setF((x) => ({ ...x, buyerName: c.name, buyerCompany: c.company, buyerStreet: c.street, buyerZip: c.zip, buyerCity: c.city, buyerCountry: c.country, buyerEmail: c.email }))} /></div>
        <Field label="Name" error={s.errors.buyerName}><input value={f.buyerName} onChange={set('buyerName')} disabled={locked} /></Field>
        <Field label="Firma" error={s.errors.buyerCompany}><input value={f.buyerCompany} onChange={set('buyerCompany')} disabled={locked} /></Field>
        <Field label="Straße" error={s.errors.buyerStreet} wide><input value={f.buyerStreet} onChange={set('buyerStreet')} disabled={locked} /></Field>
        <Field label="PLZ" error={s.errors.buyerZip}><input value={f.buyerZip} onChange={set('buyerZip')} disabled={locked} /></Field>
        <Field label="Ort" error={s.errors.buyerCity}><input value={f.buyerCity} onChange={set('buyerCity')} disabled={locked} /></Field>
        <Field label="E-Mail" error={s.errors.buyerEmail} wide><input type="email" value={f.buyerEmail} onChange={set('buyerEmail')} disabled={locked} /></Field>
        <Field label="Notiz (intern)" error={s.errors.note} wide><input value={f.note} onChange={set('note')} disabled={locked} /></Field>
        </>}
        {!v && (
          <>
            {inv.create && <h3 className="wide">Rechnung und Versand</h3>}
            {inv.create && (
              <>
                <div className="wide vc-ship">
                  <label className="check"><input type="radio" name="ship" checked={!inv.post} onChange={() => setInv({ ...inv, post: false })} /><span>wird übergeben oder per E-Mail geschickt</span></label>
                  <label className="check"><input type="radio" name="ship" checked={inv.post} onChange={() => setInv({ ...inv, post: true })} /><span>wird per Post verschickt</span></label>
                </div>
                {inv.post && <>
                  <Field label="Versandkosten" hint="Vorschlag aus „Nummern & Porto“"><span className="moneyin"><input inputMode="decimal" value={inv.postage} onChange={(e) => setInv({ ...inv, postage: e.target.value })} placeholder="0,00" /><span>€</span></span></Field>
                  <Field label="Steuersatz Versandkosten" hint="bitte mit dem Steuerberater klären"><select value={inv.postageTax} onChange={(e) => setInv({ ...inv, postageTax: e.target.value })}><option value="19">19 %</option><option value="7">7 %</option><option value="0">0 %</option></select></Field>
                </>}
              </>
            )}
            {invError && <p className="notice danger wide">{invError}</p>}
          </>
        )}
      </form>
      {v && (
        <div className="vc-status">
          {v.sentAt && <span className="muted small">Per E-Mail gesendet am {deDate(v.sentAt.slice(0, 10))} an {v.sentTo}. </span>}
          {v.status === 'active' && <Button busy={busy === 'redeemed'} onClick={() => void status('redeemed')}>Als eingelöst markieren</Button>}
          {v.status === 'redeemed' && <Button busy={busy === 'active'} onClick={() => void status('active')}>Doch nicht eingelöst</Button>}
          {v.status !== 'cancelled' && <Button variant="danger" busy={busy === 'cancelled'} onClick={() => void status('cancelled')}>Stornieren</Button>}
        </div>
      )}
      {mail && v && <MailDialog path={`/vouchers/${v.id}/mail`} title={`Gutschein ${v.number} per E-Mail`} attachmentNote="(der Gutschein als PDF mit Motiv und Kartennummer)" onClose={() => setMail(false)} onSent={() => { onChanged(); }} />}
      {invoice && v && <InvoiceDialog voucher={v} postageCents={data.numbering.postageCents} onClose={() => setInvoice(false)} onDone={(id) => { setInvoice(false); onChanged(); onClose(); openInvoice(id); }} />}
    </Dialog>
  );
}

function InvoiceDialog({ voucher: v, postageCents, onClose, onDone }: { voucher: VoucherDto; postageCents: number; onClose: () => void; onDone: (invoiceId: string) => void }) {
  const toast = useToast();
  const [p, setP] = useState({ valueTax: '0', postage: postageCents ? moneyInput(postageCents) : '', postageTax: '19' });
  const s = useSubmit(voucherInvoiceInput, async (d) => {
    const r = await api<{ invoiceId: string }>('POST', `/vouchers/${v.id}/invoice`, d);
    toast('Rechnungsentwurf angelegt – bitte prüfen und dann ausstellen');
    onDone(r.invoiceId);
  });
  const send = () => void s.submit({ valueTaxPercent: Number(p.valueTax), postageCents: p.postage.trim() === '' ? 0 : parseMoney(p.postage), postageTaxPercent: Number(p.postageTax) });
  return (
    <Dialog title={`Rechnung zu Gutschein ${v.number}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={s.busy} onClick={send}>Rechnungsentwurf anlegen</Button></>}>
      <p className="muted small">Es entsteht ein <b>Entwurf</b> unter Rechnungen an {v.buyerCompany || v.buyerName || '(Käufer fehlt)'}. Ausgestellt wird er erst, wenn Sie dort „Ausstellen“ drücken – vorher lässt sich alles ändern.</p>
      <div className="formgrid">
        <Field label={`Gutscheinwert ${formatMoney(v.valueCents)} – Steuersatz`} wide hint="Vorgabe ohne USt (Mehrzweckgutschein: Steuer erst bei Einlösung). Bitte mit dem Steuerberater klären.">
          <select value={p.valueTax} onChange={(e) => setP({ ...p, valueTax: e.target.value })}><option value="0">0 % – Mehrzweckgutschein</option><option value="7">7 %</option><option value="19">19 %</option></select>
        </Field>
        <Field label="Porto / Versand" error={s.errors.postageCents} hint="leer oder 0 = kein Porto"><span className="moneyin"><input inputMode="decimal" value={p.postage} onChange={(e) => setP({ ...p, postage: e.target.value })} placeholder="0,00" /><span>€</span></span></Field>
        <Field label="Steuersatz Porto"><select value={p.postageTax} onChange={(e) => setP({ ...p, postageTax: e.target.value })}><option value="19">19 %</option><option value="7">7 %</option><option value="0">0 %</option></select></Field>
      </div>
    </Dialog>
  );
}

function Designs({ data, isAdmin, onChange }: { data: VoucherOverviewDto; isAdmin: boolean; onChange: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [pos, setPos] = useState<TextPos>('right');
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<string | 'new' | null>(null);
  const [preset, setPreset] = useState<DesignPreset | null>(null);
  const logoInfo = useLoad(() => api<{ present: boolean }>('GET', '/settings/logo-info').catch(() => ({ present: false })));
  const take = async (p: DesignPreset) => {
    try { await api('POST', '/voucher-designs/editor', { name: p.name, layout: p.layout }); toast(`Design „${p.name}“ übernommen – Sie finden es unten bei Ihren Designs`); onChange(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const upload = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(png|jpeg)$/.test(file.type)) { toast('Bitte ein PNG- oder JPG-Bild wählen', 'error'); return; }
    if (file.size > 5 * 1024 * 1024) { toast('Das Bild ist zu groß (höchstens 5 MB)', 'error'); return; }
    const r = new FileReader();
    r.onload = async () => {
      setBusy(true);
      try {
        await api('POST', '/voucher-designs', { name: name.trim() || file.name.replace(/\.\w+$/, ''), mime: file.type, dataBase64: String(r.result).split(',')[1], textPos: pos });
        toast('Motiv hochgeladen'); setName(''); onChange();
      } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
      setBusy(false);
    };
    r.readAsDataURL(file);
  };
  const setDesignPos = async (id: string, textPos: TextPos) => { try { await api('PUT', `/voucher-designs/${id}`, { textPos }); onChange(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); } };
  const remove = async (id: string, n: string) => {
    if (!window.confirm(`Motiv „${n}“ löschen? Gutscheine mit diesem Motiv werden danach schlicht gedruckt.`)) return;
    try { await api('POST', `/voucher-designs/${id}/remove`); onChange(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  return (
    <>
      <section className="card vc-editorcard">
        <div><h2>Design-Editor</h2><p className="muted small">Gutschein frei gestalten: Logo, eigene Texte, Flächen, Strichcode, Hintergrundbild oder -farbe, Farbpalette – mit der Maus an den richtigen Platz ziehen.</p></div>
        <Button variant="primary" onClick={() => setEditor('new')}>Neues Design gestalten</Button>
      </section>
      <h2 className="vc-h">Vorlagen</h2>
      <p className="muted small">Fertige Designs zum Übernehmen – danach im Editor frei anpassen (Farben, Texte, Logo, eigenes Bild). Die Beispieltexte werden beim Drucken durch die echten Angaben ersetzt.</p>
      <div className="vc-presets">
        {DESIGN_PRESETS.map((p) => (
          <section key={p.key} className="card vc-preset">
            <LayoutPreview layout={p.layout} logo={!!logoInfo.data?.present} />
            <b>{p.name}</b>
            <span className="muted small">{p.description}</span>
            <div className="vc-design-actions">
              <Button variant="primary" onClick={() => void take(p)}>Übernehmen</Button>
              <Button onClick={() => setPreset(p)}>Anpassen …</Button>
            </div>
          </section>
        ))}
      </div>
      <h2 className="vc-h">Ihre Designs</h2>
      <details className="card">
        <summary><b>Nur ein Bild hochladen</b> <small className="muted">(einfaches Motiv mit festem Textfeld)</small></summary>
        <p className="muted small">Ein Bild im <b>Querformat</b> (z. B. 2100 × 1480 Pixel, DIN A5 quer), JPG oder PNG, höchstens 5 MB. Es füllt den ganzen Gutschein; Wert, Name, Gruß und Nummern stehen in einem hellen Feld darauf – lassen Sie dafür im Motiv eine ruhige Fläche frei.</p>
        <div className="formgrid">
          <Field label="Name des Motivs" hint="z. B. Weihnachten, Geburtstag, Neutral"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Textfeld"><select value={pos} onChange={(e) => setPos(e.target.value as TextPos)}>{TEXT_POS.map((p) => <option key={p} value={p}>{TEXT_POS_LABEL[p]}</option>)}</select></Field>
          <label className="btn wide vc-upload">{busy ? 'Wird hochgeladen …' : 'Bild auswählen und hochladen'}<input type="file" accept="image/png,image/jpeg" hidden disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
        </div>
      </details>
      {data.designs.length === 0 ? <p className="muted">Noch keine eigenen Designs – oben eine Vorlage übernehmen oder ein neues Design gestalten. Ohne Design wird der Gutschein schlicht mit Rahmen und Logo gedruckt.</p> : (
        <div className="vc-designs">
          {data.designs.map((d) => (
            <section key={d.id} className="card vc-design">
              <iframe className="vc-thumb" src={`/api/v1/voucher-designs/${d.id}/preview#toolbar=0&navpanes=0&view=Fit`} title={`Design ${d.name}`} loading="lazy" tabIndex={-1} />
              <b>{d.name}{d.hasLayout && <small className="muted inl"> · im Editor gestaltet</small>}</b>
              {!d.hasLayout && <select value={d.textPos} aria-label="Lage des Textfelds" onChange={(e) => void setDesignPos(d.id, e.target.value as TextPos)}>{TEXT_POS.map((p) => <option key={p} value={p}>{TEXT_POS_LABEL[p]}</option>)}</select>}
              <div className="vc-design-actions">
                <Button onClick={() => setEditor(d.id)}>Im Editor bearbeiten</Button>
                <a className="btn" href={`/api/v1/voucher-designs/${d.id}/preview`} target="_blank" rel="noopener">Vorschau</a>
                {isAdmin && <Button variant="danger" onClick={() => void remove(d.id, d.name)}>Löschen</Button>}
              </div>
            </section>
          ))}
        </div>
      )}
      {editor && <VoucherDesignEditor designId={editor === 'new' ? null : editor} onClose={() => setEditor(null)} onSaved={onChange} />}
      {preset && <VoucherDesignEditor designId={null} initial={{ name: preset.name, layout: preset.layout }} onClose={() => setPreset(null)} onSaved={onChange} />}
    </>
  );
}

function NumberingCard({ data, onSaved }: { data: VoucherOverviewDto; onSaved: () => void }) {
  const toast = useToast();
  const n = data.numbering;
  const [v, setV] = useState({ prefix: n.prefix, start: String(n.start), digits: String(n.digits), validYears: String(n.validYears), postage: n.postageCents ? moneyInput(n.postageCents) : '', barcode: n.barcode, format: n.format,
    yearStart: String(n.yearStartYear === Number(todayBerlin().slice(0, 4)) ? n.yearStart : 1) });
  const year = Number(todayBerlin().slice(0, 4));
  const s = useSubmit(voucherNumberingInput, async (d) => { await api('PUT', '/voucher-numbering', d); toast('Gespeichert'); onSaved(); });
  const example = `${v.prefix}${String(Number(v.start) || 1).padStart(Number(v.digits) || 1, '0')}`;
  return (
    <section className="card">
      <h2>Gutscheinnummern, Gültigkeit und Porto</h2>
      <p className="muted small">Die nächste Nummer ist immer die höchste schon vergebene + 1. Nächste Nummer zurzeit: <b>{data.nextNumber}</b>.</p>
      <form className="formgrid" onSubmit={(e) => { e.preventDefault(); void s.submit({ format: v.format, yearStart: Number(v.yearStart) || 1, yearStartYear: year, prefix: v.prefix, start: Number(v.start), digits: Number(v.digits), validYears: Number(v.validYears), postageCents: v.postage.trim() === '' ? 0 : parseMoney(v.postage), barcode: v.barcode }); }} noValidate>
        <div className="wide vc-ship">
          <label className="check"><input type="radio" name="fmt" checked={v.format === 'yearly'} onChange={() => setV({ ...v, format: 'yearly' })} /><span>Nummer / Jahr<small>{yearlyNumber(1, year)}, {yearlyNumber(2, year)}, {yearlyNumber(3, year)} … – ab Januar automatisch wieder {yearlyNumber(1, year + 1)}</small></span></label>
          <label className="check"><input type="radio" name="fmt" checked={v.format === 'prefix'} onChange={() => setV({ ...v, format: 'prefix' })} /><span>Kürzel + fortlaufende Zahl<small>z. B. SH-1001, SH-1002 … über alle Jahre</small></span></label>
        </div>
        {v.format === 'yearly' ? (
          <Field label={`In ${year} ab Nummer`} error={s.errors.yearStart} hint={`falls im Papierbuch für ${year} schon Gutscheine stehen – z. B. 38, dann geht es mit ${yearlyNumber(38, year)} weiter`}><input inputMode="numeric" value={v.yearStart} onChange={(e) => setV({ ...v, yearStart: e.target.value })} /></Field>
        ) : <>
        <Field label="Kürzel" error={s.errors.prefix} hint="z. B. SH- (darf leer sein)"><input value={v.prefix} onChange={(e) => setV({ ...v, prefix: e.target.value })} /></Field>
        <Field label="Startwert" error={s.errors.start} hint={`Beispiel: ${example}`}><input inputMode="numeric" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} /></Field>
        <Field label="Stellen" error={s.errors.digits} hint="mit führenden Nullen auffüllen"><select value={v.digits} onChange={(e) => setV({ ...v, digits: e.target.value })}>{[1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d}</option>)}</select></Field>
        </>}
        <Field label="Gültigkeit vorschlagen" error={s.errors.validYears} hint="bis zum Jahresende nach … Jahren (eigene Vorgabe, rechtlich bitte selbst prüfen)">
          <select value={v.validYears} onChange={(e) => setV({ ...v, validYears: e.target.value })}><option value="0">kein Datum</option>{[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y} {y === 1 ? 'Jahr' : 'Jahre'}</option>)}</select>
        </Field>
        <label className="check wide"><input type="checkbox" checked={v.barcode} onChange={(e) => setV({ ...v, barcode: e.target.checked })} /><span>Strichcode der Kassennummer auf den Gutschein drucken<small>Code 128 – lässt sich mit einem üblichen Handscanner an der Kasse einlesen (bitte einmal ausprobieren)</small></span></label>
        <Field label="Porto (Vorschlag für die Rechnung)" error={s.errors.postageCents}><span className="moneyin"><input inputMode="decimal" value={v.postage} onChange={(e) => setV({ ...v, postage: e.target.value })} placeholder="0,00" /><span>€</span></span></Field>
        <div className="wide"><Button type="submit" variant="primary" busy={s.busy}>Speichern</Button></div>
      </form>
    </section>
  );
}
