import { useState } from 'react';
import { formatMoney, moneyInput, parseMoney, todayBerlin } from '../../../src/shared/hotel.js';
import {
  TEXT_POS, TEXT_POS_LABEL, VOUCHER_STATUS_LABEL, voucherInput, voucherInvoiceInput, voucherNumberingInput,
  type TextPos, type VoucherDto, type VoucherOverviewDto,
} from '../../../src/shared/vouchers.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { MailDialog } from '../hotel/MailDialog.tsx';
import { Badge, Button, Dialog, Field, LoadState, PageHeader, useLoad, useSubmit, useTabs, useToast } from '../ui.tsx';

const TONE = { active: 'ok', redeemed: 'neutral', cancelled: 'danger' } as const;

/** Gutscheine: anlegen (Nummer automatisch, Geschenkkarten-Nr. aus der Kasse), als PDF mit Motiv drucken, per E-Mail senden, Rechnung mit Porto. */
export function Vouchers() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const [rev, setRev] = useState(0);
  const reload = () => setRev((r) => r + 1);
  const { data, error } = useLoad(() => api<VoucherOverviewDto>('GET', '/vouchers'), [rev]);
  const { current, bar } = useTabs([['liste', 'Gutscheine'], ['motive', 'Motive'], ...(isAdmin ? [['einstellungen', 'Nummern & Porto'] as const] : [])] as const);
  const [open, setOpen] = useState<VoucherDto | 'new' | null>(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const list = (data?.vouchers ?? []).filter((v) => (!status || v.status === status)
    && (!q.trim() || [v.number, v.recipientName, v.buyerName, v.buyerCompany, v.posCardNo].join(' ').toLowerCase().includes(q.trim().toLowerCase())));
  const sum = list.filter((v) => v.status === 'active').reduce((s, v) => s + v.valueCents, 0);
  return (
    <>
      <PageHeader title="Gutscheine" sub="Geschenkkarten aus der Kasse festhalten, gestalten, per E-Mail senden und abrechnen"
        actions={<Button variant="primary" onClick={() => setOpen('new')}>Neuer Gutschein</Button>} />
      {bar}
      <LoadState error={error} loading={!data} />
      {data && current === 'liste' && (
        <>
          <div className="filters">
            <input type="search" placeholder="Nummer, Name, Käufer, Kartennummer …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Suche" />
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
              <option value="active">gültige</option><option value="redeemed">eingelöste</option><option value="cancelled">stornierte</option><option value="">alle</option>
            </select>
            {status === 'active' && list.length > 0 && <span className="muted small">{list.length} gültig · zusammen {formatMoney(sum)}</span>}
          </div>
          {list.length === 0 ? <p className="muted">{data.vouchers.length ? 'Keine Gutscheine für diese Auswahl.' : 'Noch keine Gutscheine – oben rechts „Neuer Gutschein“.'}</p> : (
            <div className="card flush tablewrap"><table>
              <thead><tr><th>Nr.</th><th className="num">Wert</th><th>für</th><th className="hide-sm">Käufer</th><th className="hide-sm">gültig bis</th><th>Status</th><th className="hide-sm">Rechnung</th><th className="hide-sm">E-Mail</th></tr></thead>
              <tbody>{list.map((v) => (
                <tr key={v.id} className="rowlink" tabIndex={0} onClick={() => setOpen(v)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(v); }}>
                  <td><b>{v.number}</b>{v.posCardNo && <><br /><small className="muted">Karte {v.posCardNo}</small></>}</td>
                  <td className="num">{formatMoney(v.valueCents)}</td>
                  <td>{v.recipientName || '–'}</td>
                  <td className="hide-sm">{v.buyerCompany || v.buyerName || '–'}</td>
                  <td className="hide-sm">{v.validUntil ? deDate(v.validUntil) : '–'}</td>
                  <td><Badge tone={TONE[v.status]}>{VOUCHER_STATUS_LABEL[v.status]}</Badge></td>
                  <td className="hide-sm">{v.invoiceId ? (v.invoiceNumber ?? 'Entwurf') : '–'}</td>
                  <td className="hide-sm">{v.sentAt ? deDate(v.sentAt.slice(0, 10)) : '–'}</td>
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

type Form = Record<'number' | 'pin' | 'posCardNo' | 'value' | 'issuedOn' | 'validUntil' | 'buyerName' | 'buyerCompany' | 'buyerStreet' | 'buyerZip' | 'buyerCity' | 'buyerCountry' | 'buyerEmail' | 'recipientName' | 'message' | 'designId' | 'note', string>;

function VoucherDialog({ voucher: v, data, isAdmin, onClose, onChanged }: { voucher: VoucherDto | null; data: VoucherOverviewDto; isAdmin: boolean; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const { openInvoice } = useData();
  const today = todayBerlin();
  const [f, setF] = useState<Form>(() => ({
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
  const s = useSubmit(voucherInput, async (d) => {
    if (v) await api('PUT', `/vouchers/${v.id}`, { ...d, version: v.version });
    else await api('POST', '/vouchers', d);
    toast(v ? 'Gutschein gespeichert' : `Gutschein ${d.number} angelegt`);
    onChanged(); onClose();
  });
  const save = () => void s.submit({ ...f, valueCents: f.value.trim() === '' ? NaN : parseMoney(f.value) });
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
        <h3 className="wide first">Gutschein</h3>
        <Field label="Gutscheinnummer (intern)" error={s.errors.number} hint={v ? undefined : 'automatisch fortlaufend – bei Bedarf ändern'}><input value={f.number} onChange={set('number')} disabled={locked} /></Field>
        <Field label="Wert" error={s.errors.valueCents}><span className="moneyin"><input inputMode="decimal" value={f.value} onChange={set('value')} placeholder="50,00" autoFocus={!v} disabled={locked} /><span>€</span></span></Field>
        <Field label="Geschenkkarten-Nr. aus der Kasse" error={s.errors.posCardNo} hint="steht auf dem Gutschein – damit öffnet die Kasse die Karte"><input value={f.posCardNo} onChange={set('posCardNo')} disabled={locked} /></Field>
        <Field label="Ausgestellt am" error={s.errors.issuedOn}><input type="date" value={f.issuedOn} onChange={set('issuedOn')} disabled={locked} /></Field>
        <Field label="Gültig bis" error={s.errors.validUntil} hint="leer = ohne Datum auf dem Gutschein"><input type="date" value={f.validUntil} onChange={set('validUntil')} disabled={locked} /></Field>

        <h3 className="wide">Für wen?</h3>
        <Field label="Beschenkte Person" error={s.errors.recipientName} hint="steht auf dem Gutschein („für …“)"><input value={f.recipientName} onChange={set('recipientName')} disabled={locked} /></Field>
        <Field label="Motiv" hint={data.designs.length ? undefined : 'Motive unter dem Reiter „Motive“ hochladen'}>
          <select value={f.designId} onChange={set('designId')} disabled={locked}><option value="">schlicht (ohne Motiv)</option>{data.designs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        </Field>
        <Field label="Gruß auf dem Gutschein" error={s.errors.message} wide hint="freiwillig, z. B. „Alles Gute zum Geburtstag!“"><textarea rows={2} value={f.message} onChange={set('message')} disabled={locked} /></Field>

        <h3 className="wide">Käufer <small className="muted inl">für Rechnung und E-Mail</small></h3>
        <Field label="Name" error={s.errors.buyerName}><input value={f.buyerName} onChange={set('buyerName')} disabled={locked} /></Field>
        <Field label="Firma" error={s.errors.buyerCompany}><input value={f.buyerCompany} onChange={set('buyerCompany')} disabled={locked} /></Field>
        <Field label="Straße" error={s.errors.buyerStreet} wide><input value={f.buyerStreet} onChange={set('buyerStreet')} disabled={locked} /></Field>
        <Field label="PLZ" error={s.errors.buyerZip}><input value={f.buyerZip} onChange={set('buyerZip')} disabled={locked} /></Field>
        <Field label="Ort" error={s.errors.buyerCity}><input value={f.buyerCity} onChange={set('buyerCity')} disabled={locked} /></Field>
        <Field label="E-Mail" error={s.errors.buyerEmail} wide><input type="email" value={f.buyerEmail} onChange={set('buyerEmail')} disabled={locked} /></Field>
        <Field label="Notiz (intern)" error={s.errors.note} wide><input value={f.note} onChange={set('note')} disabled={locked} /></Field>
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
      <section className="card">
        <h2>Motiv hochladen</h2>
        <p className="muted small">Ein Bild im <b>Querformat</b> (z. B. 2100 × 1480 Pixel, DIN A5 quer), JPG oder PNG, höchstens 5 MB. Es füllt den ganzen Gutschein; Wert, Name, Gruß und Nummern stehen in einem hellen Feld darauf – lassen Sie dafür im Motiv eine ruhige Fläche frei.</p>
        <div className="formgrid">
          <Field label="Name des Motivs" hint="z. B. Weihnachten, Geburtstag, Neutral"><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Textfeld"><select value={pos} onChange={(e) => setPos(e.target.value as TextPos)}>{TEXT_POS.map((p) => <option key={p} value={p}>{TEXT_POS_LABEL[p]}</option>)}</select></Field>
          <label className="btn wide vc-upload">{busy ? 'Wird hochgeladen …' : 'Bild auswählen und hochladen'}<input type="file" accept="image/png,image/jpeg" hidden disabled={busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
        </div>
      </section>
      {data.designs.length === 0 ? <p className="muted">Noch keine Motive – ohne Motiv wird der Gutschein schlicht mit Rahmen und Logo gedruckt.</p> : (
        <div className="vc-designs">
          {data.designs.map((d) => (
            <section key={d.id} className="card vc-design">
              <img src={`/api/v1/voucher-designs/${d.id}/image`} alt={`Motiv ${d.name}`} loading="lazy" />
              <b>{d.name}</b>
              <select value={d.textPos} aria-label="Lage des Textfelds" onChange={(e) => void setDesignPos(d.id, e.target.value as TextPos)}>{TEXT_POS.map((p) => <option key={p} value={p}>{TEXT_POS_LABEL[p]}</option>)}</select>
              <div className="vc-design-actions">
                <a className="btn" href={`/api/v1/voucher-designs/${d.id}/preview`} target="_blank" rel="noopener">Vorschau</a>
                {isAdmin && <Button variant="danger" onClick={() => void remove(d.id, d.name)}>Löschen</Button>}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

function NumberingCard({ data, onSaved }: { data: VoucherOverviewDto; onSaved: () => void }) {
  const toast = useToast();
  const n = data.numbering;
  const [v, setV] = useState({ prefix: n.prefix, start: String(n.start), digits: String(n.digits), validYears: String(n.validYears), postage: n.postageCents ? moneyInput(n.postageCents) : '' });
  const s = useSubmit(voucherNumberingInput, async (d) => { await api('PUT', '/voucher-numbering', d); toast('Gespeichert'); onSaved(); });
  const example = `${v.prefix}${String(Number(v.start) || 1).padStart(Number(v.digits) || 1, '0')}`;
  return (
    <section className="card">
      <h2>Gutscheinnummern, Gültigkeit und Porto</h2>
      <p className="muted small">Die nächste Nummer ist immer die höchste schon vergebene + 1 (mindestens der Startwert). Nächste Nummer zurzeit: <b>{data.nextNumber}</b>.</p>
      <form className="formgrid" onSubmit={(e) => { e.preventDefault(); void s.submit({ prefix: v.prefix, start: Number(v.start), digits: Number(v.digits), validYears: Number(v.validYears), postageCents: v.postage.trim() === '' ? 0 : parseMoney(v.postage) }); }} noValidate>
        <Field label="Kürzel" error={s.errors.prefix} hint="z. B. SH- (darf leer sein)"><input value={v.prefix} onChange={(e) => setV({ ...v, prefix: e.target.value })} /></Field>
        <Field label="Startwert" error={s.errors.start} hint={`Beispiel: ${example}`}><input inputMode="numeric" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} /></Field>
        <Field label="Stellen" error={s.errors.digits} hint="mit führenden Nullen auffüllen"><select value={v.digits} onChange={(e) => setV({ ...v, digits: e.target.value })}>{[1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d}</option>)}</select></Field>
        <Field label="Gültigkeit vorschlagen" error={s.errors.validYears} hint="bis zum Jahresende nach … Jahren (eigene Vorgabe, rechtlich bitte selbst prüfen)">
          <select value={v.validYears} onChange={(e) => setV({ ...v, validYears: e.target.value })}><option value="0">kein Datum</option>{[1, 2, 3, 4, 5].map((y) => <option key={y} value={y}>{y} {y === 1 ? 'Jahr' : 'Jahre'}</option>)}</select>
        </Field>
        <Field label="Porto (Vorschlag für die Rechnung)" error={s.errors.postageCents}><span className="moneyin"><input inputMode="decimal" value={v.postage} onChange={(e) => setV({ ...v, postage: e.target.value })} placeholder="0,00" /><span>€</span></span></Field>
        <div className="wide"><Button type="submit" variant="primary" busy={s.busy}>Speichern</Button></div>
      </form>
    </section>
  );
}
