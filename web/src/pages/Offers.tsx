import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { addDays, formatMoney, moneyInput, parseMoney, todayBerlin } from '../../../src/shared/hotel.js';
import {
  AREA_LABEL, OFFER_AREAS, OFFER_STATE_LABEL, OFFER_UNITS, TALK_KINDS, TALK_KIND_LABEL, UNIT_LABEL, groupItems, lineTotal, offerItemInput, offerTemplateInput, quantityFor,
  type CatalogReturn, type OfferArea, type OfferDocumentDto, type OfferDto, type OfferItemDto, type OfferListRow, type OfferState, type OfferTalk, type OfferTemplateDto, type OfferTimeline, type OfferUnit, type TalkKind, type TalkStep,
} from '../../../src/shared/offers.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { DepositPanel } from '../billing/DepositPanel.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { MailDialog } from '../hotel/MailDialog.tsx';
import { Badge, Button, Dialog, Field, LoadState, PageHeader, useLoad, useTabs, useToast } from '../ui.tsx';
import { OfferLayoutCard } from './OfferLayoutCard.tsx';
import { OfferWizard } from './OfferWizard.tsx';
import { QuestionPicker } from './QuestionPicker.tsx';

const TONE: Record<OfferState, 'neutral' | 'accent' | 'ok' | 'danger' | 'warn'> = { draft: 'neutral', sent: 'accent', accepted: 'ok', declined: 'danger', expired: 'warn', asked: 'accent', answered: 'warn' };
const TABS = [['angebote', 'Angebote'], ['leistungen', 'Leistungen'], ['vorlagen', 'Vorlagen'], ['dokumente', 'AGB & Dokumente'], ['gestaltung', 'Gestaltung']] as const;

/** Angebote für Tagungen, Feiern und Gruppen: aus Vorlagen zusammenstellen, als PDF mit AGB versenden, Annahme festhalten. */
export function Offers() {
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const { current, bar } = useTabs(isAdmin ? TABS : TABS.slice(0, 1));
  return (
    <>
      <PageHeader title="Angebote" sub="Tagungen, Feiern und Gruppen – aus Vorlagen zusammenstellen, als PDF mit AGB versenden, Annahme festhalten" />
      {isAdmin && bar}
      {current === 'angebote' && <OfferList />}
      {current === 'leistungen' && isAdmin && <ItemsAdmin />}
      {current === 'vorlagen' && isAdmin && <TemplatesAdmin />}
      {current === 'dokumente' && isAdmin && <DocumentsAdmin />}
      {current === 'gestaltung' && isAdmin && <OfferLayoutCard />}
    </>
  );
}

function OfferList() {
  const { rev } = useData();
  const [params, setParams] = useSearchParams();
  const [state, setState] = useState('open');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(params.get('neu') === '1');
  const [openId, setOpenId] = useState<string | null>(params.get('angebot'));
  const [wizard, setWizard] = useState(false);
  const { data, error } = useLoad(() => api<OfferListRow[]>('GET', `/offers?state=${state}&q=${encodeURIComponent(q.trim())}`), [state, q, rev]);
  const prefill = { customerName: params.get('name') ?? '', email: params.get('email') ?? '', phone: params.get('phone') ?? '', eventDate: params.get('datum') ?? '', persons: params.get('personen') ?? '' };
  return (
    <>
      <div className="filters">
        <select value={state} onChange={(e) => setState(e.target.value)} aria-label="Stand">
          <option value="open">offen (Entwurf, versendet, abgelaufen)</option><option value="accepted">angenommen</option><option value="declined">abgelehnt</option><option value="all">alle</option>
        </select>
        <input type="search" placeholder="Nummer, Kunde, Titel …" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Suche" />
        <Button variant="primary" onClick={() => setWizard(true)} title="Geführt wie bei der Zimmerbuchung: Anlass, Daten, Leistungen Schritt für Schritt – z. B. bei der Absprache am Tisch">Absprache Schritt für Schritt</Button>
        <Button onClick={() => setCreating(true)}>Neues Angebot</Button>
      </div>
      <LoadState error={error} loading={!data} />
      {data && (data.length === 0 ? <p className="muted card">Keine Angebote.</p> : (
        <div className="tablewrap card flush"><table>
          <thead><tr><th>Nummer</th><th>Kunde</th><th>Termin</th><th className="num">Pers.</th><th className="num">Betrag</th><th>Stand</th></tr></thead>
          <tbody>{data.map((o) => (
            <tr key={o.id} className="rowlink" tabIndex={0} onClick={() => setOpenId(o.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(o.id); }}>
              <td className="nowrap"><b>{o.number}</b><br /><small className="muted">{o.title || AREA_LABEL[o.area]}</small></td>
              <td>{o.customer}<br /><small className="muted">{o.email}</small></td>
              <td className="nowrap">{o.eventDate ? deDate(o.eventDate) : '–'}{o.eventEnd && o.eventEnd !== o.eventDate ? ` – ${deDate(o.eventEnd)}` : ''}</td>
              <td className="num">{o.persons}</td>
              <td className="num">{o.mode === 'questions' ? <small className="muted">nur Fragen</small> : formatMoney(o.totalCents)}</td>
              <td><Badge tone={TONE[o.state]}>{OFFER_STATE_LABEL[o.state]}</Badge>{o.state === 'expired' && <><br /><small className="muted">nachfassen</small></>}{o.state === 'answered' && <><br /><small className="muted">Angebot erstellen</small></>}
                {o.state === 'sent' && o.validUntil && <><br /><small className="muted">gültig bis {deDate(o.validUntil)}</small></>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ))}
      {creating && <NewOfferDialog prefill={prefill} onClose={() => { setCreating(false); if (params.get('neu')) { const p = new URLSearchParams(params); ['neu', 'name', 'email', 'phone', 'datum', 'personen'].forEach((k) => p.delete(k)); setParams(p, { replace: true }); } }} onCreated={(id) => { setCreating(false); setOpenId(id); }} />}
      {wizard && <OfferWizard onClose={() => setWizard(false)} onCreated={(id) => { setWizard(false); setOpenId(id); }} />}
      {openId && <OfferEditor id={openId} onClose={() => setOpenId(null)} />}
    </>
  );
}

function NewOfferDialog({ prefill, onClose, onCreated }: { prefill: { customerName: string; email: string; phone: string; eventDate: string; persons: string }; onClose: () => void; onCreated: (id: string) => void }) {
  const { bump } = useData();
  const tpls = useLoad(() => api<OfferTemplateDto[]>('GET', '/offer-templates')).data;
  const [mode, setMode] = useState<'offer' | 'questions'>('offer');
  const [v, setV] = useState({ templateId: '', customerCompany: '', customerName: prefill.customerName, email: prefill.email, phone: prefill.phone, eventDate: /^\d{4}-\d{2}-\d{2}$/.test(prefill.eventDate) ? prefill.eventDate : '', eventEnd: '', persons: prefill.persons || '10' });
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const create = async () => {
    setBusy(true); setFail(null);
    try {
      const r = await api<{ id: string }>('POST', '/offers', { ...v, mode, templateId: v.templateId || null, eventDate: v.eventDate || null, eventEnd: v.eventEnd || null, persons: Number(v.persons) || 0, area: 'both' });
      bump(); onCreated(r.id);
    } catch (e) { const err = e as { message?: string; fields?: Record<string, string> }; setFail(Object.values(err.fields ?? {}).join(' · ') || err.message || 'Fehler'); }
    setBusy(false);
  };
  const set = (k: keyof typeof v, x: string) => setV({ ...v, [k]: x });
  return (
    <Dialog title={mode === 'questions' ? 'Neue Rückfrage an den Kunden' : 'Neues Angebot'} onClose={onClose} size="lg" footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={busy} onClick={() => void create()}>{mode === 'questions' ? 'Fragen vorbereiten' : 'Angebot anlegen'}</Button></>}>
      <div className="modepick" role="radiogroup" aria-label="Was möchten Sie senden?">
        <button type="button" role="radio" aria-checked={mode === 'questions'} className={mode === 'questions' ? 'on' : ''} onClick={() => setMode('questions')}>
          <b>Erst Fragen stellen</b><small>Fragenkatalog ohne Leistungen und Preise – der Kunde antwortet online oder per E-Mail; danach machen Sie daraus das Angebot.</small></button>
        <button type="button" role="radio" aria-checked={mode === 'offer'} className={mode === 'offer' ? 'on' : ''} onClick={() => setMode('offer')}>
          <b>Direkt ein Angebot</b><small>Leistungen mit Preisen als PDF, mit AGB und Annahme über den Link.</small></button>
      </div>
      <Field label="Anlass (Vorlage)" hint={mode === 'questions' ? 'übernimmt den Fragenkatalog; Leistungen stehen schon bereit, wenn Sie später das Angebot erstellen' : 'z. B. Tagung – bestimmt Texte, Fragen und den passenden Produktkatalog'}><select value={v.templateId} onChange={(e) => set('templateId', e.target.value)}>
        <option value="">ohne Vorlage (leer)</option>{(tpls ?? []).filter((t) => t.active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
      <div className="formgrid">
        <Field label="Firma"><input value={v.customerCompany} onChange={(e) => set('customerCompany', e.target.value)} /></Field>
        <Field label="Name (Ansprechpartner)"><input value={v.customerName} onChange={(e) => set('customerName', e.target.value)} /></Field>
        <Field label="E-Mail"><input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Telefon"><input value={v.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        <Field label="Termin (Beginn)"><input type="date" value={v.eventDate} onChange={(e) => set('eventDate', e.target.value)} /></Field>
        <Field label="bis (bei mehreren Tagen)"><input type="date" value={v.eventEnd} min={v.eventDate || undefined} onChange={(e) => set('eventEnd', e.target.value)} /></Field>
        <Field label="Personen"><input inputMode="numeric" value={v.persons} onChange={(e) => set('persons', e.target.value)} /></Field>
      </div>
      {fail && <p className="notice danger" role="alert">{fail}</p>}
      <p className="muted small">{mode === 'questions' ? 'Die Fragen lassen sich danach noch anpassen. ' : ''}Die Leistungen der Vorlage werden mit passender Menge übernommen (z. B. pro Person und Tag = Personen × Tage) und lassen sich danach anpassen.</p>
    </Dialog>
  );
}

type LineDraft = { itemId: string | null; description: string; detail: string; unit: OfferUnit; quantity: string; price: string; tax: string };
const toDraftLine = (l: OfferDto['lines'][number]): LineDraft => ({ itemId: l.itemId, description: l.description, detail: l.detail, unit: l.unit, quantity: String(l.quantity).replace('.', ','), price: moneyInput(l.unitPriceCents), tax: String(l.taxRatePercent) });
const qty = (s: string) => Number(s.replace(',', '.'));

function OfferEditor({ id, onClose }: { id: string; onClose: () => void }) {
  const { rev, bump, newBooking } = useData();
  const isAdmin = useAuth().user.role === 'admin';
  const toast = useToast();
  const { data: o, error } = useLoad(() => api<OfferDto>('GET', `/offers/${id}`), [id, rev]);
  const items = useLoad(() => api<OfferItemDto[]>('GET', '/offer-items')).data ?? [];
  const docs = useLoad(() => api<OfferDocumentDto[]>('GET', '/offer-documents')).data ?? [];
  const tpls = useLoad(() => api<OfferTemplateDto[]>('GET', '/offer-templates')).data ?? [];
  /** gewählter Produktkatalog (Vorlage) – Vorgabe: die Vorlage des Angebots */
  const [catalogId, setCatalogId] = useState<string | null>(null);
  const [v, setV] = useState<(Omit<OfferDto, 'lines'> & { lines: LineDraft[]; questionsText: string }) | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [mail, setMail] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [askAlso, setAskAlso] = useState(false);
  const [catMail, setCatMail] = useState(false);
  const [catReturn, setCatReturn] = useState(false);
  const [config, setConfig] = useState(false);
  useEffect(() => { if (o) { setV({ ...o, lines: o.lines.map(toDraftLine), questionsText: o.questions.join('\n') }); setDirty(false); } }, [o]);
  if (!o || !v) return <Dialog title="Angebot" onClose={onClose}><LoadState error={error} loading /></Dialog>;
  const locked = o.status === 'accepted' || o.status === 'declined';
  // „nur Fragen“: ohne Leistungen, Preise, PDF und Annahme
  const q = v.mode === 'questions';
  const ch = (p: Partial<typeof v>) => { setV({ ...v, ...p }); setDirty(true); };
  const qList = v.questionsText.split('\n').map((x) => x.trim()).filter(Boolean);
  const setQ = (list: string[]) => ch({ questionsText: list.join('\n') });
  const setLine = (i: number, p: Partial<LineDraft>) => ch({ lines: v.lines.map((l, k) => (k === i ? { ...l, ...p } : l)) });
  const totalOf = (l: LineDraft) => { const q = qty(l.quantity), c = parseMoney(l.price); return Number.isFinite(q) && Number.isFinite(c) ? lineTotal(q, c) : 0; };
  const total = v.lines.reduce((s, l) => s + totalOf(l), 0);
  const addItem = (itemId: string) => {
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    ch({ lines: [...v.lines, { itemId: it.id, description: it.name, detail: it.description, unit: it.unit, quantity: String(quantityFor(it.unit, v.persons, v.eventDate, v.eventEnd)).replace('.', ','), price: moneyInput(it.priceCents), tax: String(it.taxRatePercent) }] });
  };
  const catTpl = tpls.find((t) => t.id === (catalogId ?? o.templateId ?? ''));
  const catQuery = catTpl ? `?katalog=${catTpl.id}` : '';
  const catItems = (catTpl?.items ?? []).map((c) => items.find((x) => x.id === c.itemId && x.active)).filter((x): x is OfferItemDto => !!x);
  const recalc = () => ch({ lines: v.lines.map((l) => (l.unit === 'flat' ? l : { ...l, quantity: String(quantityFor(l.unit, v.persons, v.eventDate, v.eventEnd)) })) });
  const save = async (quiet = false) => {
    setBusy('save');
    try {
      const r = await api<{ backToDraft: boolean }>('PUT', `/offers/${id}`, {
        area: v.area, mode: v.mode, customerCompany: v.customerCompany, customerName: v.customerName, email: v.email, phone: v.phone, street: v.street, zip: v.zip, city: v.city,
        eventDate: v.eventDate || null, eventEnd: v.eventEnd || null, persons: v.persons, title: v.title, intro: v.intro, closing: v.closing,
        questions: v.questionsText.split('\n').map((x) => x.trim()).filter(Boolean), validUntil: v.validUntil || null, depositPercent: v.depositPercent, documentIds: v.documentIds, notes: v.notes,
        lines: v.lines.map((l) => ({ itemId: l.itemId, description: l.description, detail: l.detail, unit: l.unit, quantity: qty(l.quantity), unitPriceCents: parseMoney(l.price), taxRatePercent: Number(l.tax.replace(',', '.')) })),
        version: o.version,
      });
      if (!quiet) toast(r.backToDraft ? 'Gespeichert – das Angebot ist wieder ein Entwurf und muss neu versendet werden' : 'Gespeichert');
      setDirty(false); bump(); setBusy(null); return true;
    } catch (e) { const err = e as { message?: string; fields?: Record<string, string> }; toast(Object.values(err.fields ?? {}).join(' · ') || err.message || 'Fehler', 'error'); setBusy(null); return false; }
  };
  const decline = async () => {
    if (!window.confirm(`${q ? `Rückfrage ${o.number}: Der Kunde hat kein Interesse – so vermerken?` : `Angebot ${o.number} als abgelehnt markieren?`}${dirty ? ' Ihre Änderungen werden vorher gespeichert.' : ''}`)) return;
    if (dirty && !(await save(true))) return;
    try { await api('POST', `/offers/${id}/decline`); toast('Als abgelehnt markiert'); bump(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const makeOffer = async () => {
    if (dirty && !(await save(true))) return;
    if (!window.confirm('Jetzt aus den Fragen ein Angebot mit Leistungen machen? Die Antworten bleiben sichtbar; der bisherige Link zum Beantworten gilt dann nicht mehr.')) return;
    try { await api('POST', `/offers/${id}/to-offer`); toast('Jetzt Leistungen eintragen und das Angebot senden'); bump(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const openCatalog = async () => { if (dirty && !(await save(true))) return; window.open(`/api/v1/offers/${id}/catalog/pdf${catQuery}`, '_blank', 'noopener'); };
  const startCatMail = async () => { if (dirty && !(await save(true))) return; setCatMail(true); };
  /** Rückmeldung aus dem Katalog übernehmen: angekreuzte Leistungen als Zeilen (noch nicht gespeichert), Personen, Notiz */
  const applyReturn = (r: { itemIds: string[]; persons: number | null; note: string }) => {
    const persons = r.persons ?? v.persons;
    const add = r.itemIds.filter((iid) => !v.lines.some((l) => l.itemId === iid)).map((iid) => items.find((x) => x.id === iid)).filter((x): x is OfferItemDto => !!x)
      .map((it): LineDraft => ({ itemId: it.id, description: it.name, detail: it.description, unit: it.unit, quantity: String(quantityFor(it.unit, persons, v.eventDate, v.eventEnd)).replace('.', ','), price: moneyInput(it.priceCents), tax: String(it.taxRatePercent) }));
    ch({ persons, lines: [...v.lines, ...add], notes: r.note ? [v.notes, r.note].filter(Boolean).join('\n\n') : v.notes });
    toast(`${add.length} Leistung(en) übernommen${r.persons && r.persons !== v.persons ? ' – Personenzahl geändert: bei Bedarf „Mengen neu berechnen“' : ''} – bitte prüfen und speichern`);
  };
  const openPdf = async () => { if (dirty && !(await save(true))) return; window.open(`/api/v1/offers/${id}/pdf`, '_blank', 'noopener'); };
  const startMail = async () => { if (dirty && !(await save(true))) return; setMail(true); };
  // Annahme hält die gespeicherte Fassung fest – ungespeicherte Änderungen deshalb zuerst speichern
  const startAccept = async () => { if (dirty && !(await save(true))) return; setAccepting(true); };
  const expired = !locked && !!v.validUntil && v.validUntil < todayBerlin();
  const hotelBooking = () => {
    const [first, ...rest] = (o.customerName || o.customerCompany).split(' ');
    newBooking({ from: o.eventDate ?? undefined, to: o.eventEnd && o.eventEnd !== o.eventDate ? o.eventEnd : o.eventDate ? addDays(o.eventDate, 1) : undefined, source: 'E-Mail',
      draft: { firstName: rest.length ? first : '', lastName: rest.length ? rest.join(' ') : first ?? '', email: o.email, phone: o.phone }, notes: `Aus Angebot ${o.number}${o.title ? ` (${o.title})` : ''}`,
      onCreated: (bid) => { void api('POST', `/offers/${id}/link-reservation`, { bookingId: bid }).then(bump); } });
  };
  const tableReservation = async () => {
    const time = window.prompt('Uhrzeit der Tischreservierung (HH:MM):', '18:00');
    if (!time || !/^\d{2}:\d{2}$/.test(time) || !o.eventDate) { if (!o.eventDate) toast('Im Angebot fehlt der Termin', 'error'); return; }
    try {
      const r = await api<{ id: string }>('POST', '/restaurant/reservations', { date: o.eventDate, time, durationMin: 240, persons: o.persons, name: o.customerCompany || o.customerName, phone: o.phone, note: `Angebot ${o.number}${o.title ? ` – ${o.title}` : ''}`, tableId: null });
      await api('POST', `/offers/${id}/link-reservation`, { tableReservationId: r.id });
      toast('Tischreservierung angelegt – Tisch im Restaurant zuweisen'); bump();
    } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const f = (k: 'customerCompany' | 'customerName' | 'email' | 'phone' | 'street' | 'zip' | 'city' | 'title', label: string, type = 'text') =>
    <Field label={label}><input type={type} value={v[k]} disabled={locked} onChange={(e) => ch({ [k]: e.target.value } as Partial<typeof v>)} /></Field>;
  return (
    <Dialog title={<>{q ? 'Rückfrage' : 'Angebot'} {o.number} <Badge tone={TONE[o.state]}>{OFFER_STATE_LABEL[o.state]}</Badge></>} onClose={() => { if (!dirty || window.confirm('Ungespeicherte Änderungen verwerfen?')) onClose(); }} size="xl"
      footer={<>
        {!q && <span className="left total">Gesamt <b>{formatMoney(total)}</b></span>}
        {!q && <Button onClick={() => void openPdf()}>PDF ansehen</Button>}
        {(!locked || dirty) && <Button busy={busy === 'save'} disabled={!dirty} onClick={() => void save()}>{locked ? 'Notiz speichern' : 'Speichern'}</Button>}
        {!locked && !(q && o.answers) && <Button variant={q && o.status === 'draft' ? 'primary' : undefined} onClick={() => void startMail()}>{o.status === 'sent' ? 'Erneut senden' : q ? 'Fragen per E-Mail senden' : 'Per E-Mail senden'}</Button>}
        {/* Annehmen/Ablehnen erst, wenn der Kunde etwas bekommen hat */}
        {!locked && !q && o.status === 'sent' && <Button variant="primary" busy={busy === 'save'} onClick={() => void startAccept()}>Angenommen …</Button>}
        {!locked && q && o.status === 'sent' && <Button variant="primary" onClick={() => void makeOffer()}>Angebot erstellen</Button>}
        {!locked && o.status === 'sent' && <Button variant="danger" onClick={() => void decline()}>{q ? 'Kein Interesse' : 'Abgelehnt'}</Button>}
      </>}>
      {!locked && o.status === 'draft' && (
        <div className="segmented modeswitch" role="radiogroup" aria-label="Art">
          <button type="button" role="radio" aria-checked={q} className={q ? 'on' : ''} onClick={() => !q && ch({ mode: 'questions' })}>Nur Fragen stellen</button>
          <button type="button" role="radio" aria-checked={!q} className={!q ? 'on' : ''} onClick={() => q && ch({ mode: 'offer', validUntil: v.validUntil ?? addDays(todayBerlin(), 14) })}>Angebot mit Leistungen</button>
        </div>
      )}
      {q && o.status === 'draft' && <p className="muted small">Der Kunde bekommt eine E-Mail mit Ihren Fragen und einem Link, über den er sie direkt beantworten kann (oder er antwortet per E-Mail). Leistungen und Preise kommen erst ins Angebot danach.</p>}
      {o.answers && (
        <section className="card answers">
          <h3 className="first">Antworten von {o.answers.name} <small className="muted">– online am {new Date(o.answers.at).toLocaleString('de-DE')}</small></h3>
          <dl>{o.answers.items.map((x, i) => <div key={i}><dt>{x.q}</dt><dd>{x.a || <span className="muted">– keine Angabe –</span>}</dd></div>)}</dl>
        </section>
      )}
      <OfferThread offer={o} onAccept={!locked && !q && o.status === 'sent' ? () => void startAccept() : undefined} />
      {o.talk && (
        <section className="card answers">
          <h3 className="first">Absprache{o.talk.template ? ` – ${o.talk.template}` : ''} <small className="muted">– am {new Date(o.talk.at).toLocaleString('de-DE')} von {o.talk.by}</small></h3>
          <dl>{o.talk.steps.map((x, i) => <div key={i}><dt>{x.title}</dt><dd>{x.answers.join(', ')}{x.text && <span className="tk-text">{x.text}</span>}{!x.answers.length && !x.text && <span className="muted">– keine Angabe –</span>}</dd></div>)}</dl>
          <div className="btnrow"><Button onClick={() => printTalk(o, o.talk!)}>Absprache-Zettel drucken</Button></div>
        </section>
      )}
      {o.status === 'accepted' && <p className="notice small">Angenommen am {new Date(o.acceptedAt!).toLocaleString('de-DE')} von <b>{o.acceptedBy}</b> ({({ online: 'online über den Link', email: 'per E-Mail', telefon: 'telefonisch', persoenlich: 'persönlich', schriftlich: 'schriftlich' } as Record<string, string>)[o.acceptedMethod] ?? o.acceptedMethod}). Prüfwert der angenommenen Fassung: <code className="wrapcode">{o.acceptedHash.slice(0, 16)}…</code></p>}
      {expired && <p className="notice warn small">„Gültig bis“ ({new Date(`${v.validUntil}T12:00:00`).toLocaleDateString('de-DE')}) liegt in der Vergangenheit. Zum Versenden bitte ein neues Datum eintragen und speichern{o.status === 'sent' ? ' – online annehmen kann der Kunde es so nicht mehr' : ''}.</p>}
      {o.status === 'sent' && (q
        ? <p className="notice small">Fragen gesendet am {new Date(o.sentAt!).toLocaleString('de-DE')} an {o.sentTo}. {o.answers ? 'Die Antworten sind da – mit „Angebot erstellen“ geht es weiter.' : 'Sobald der Kunde online antwortet, steht es hier und im Übergabebuch. Antwortet er per E-Mail, kommt die Antwort in den Posteingang.'}</p>
        : <p className="notice small">Versendet am {new Date(o.sentAt!).toLocaleString('de-DE')} an {o.sentTo}. Änderungen am Inhalt machen es wieder zum Entwurf; der bisherige Link zur Annahme gilt dann nicht mehr. Die interne Notiz lässt sich ohne Folgen ändern.</p>)}
      {o.status === 'accepted' && (
        <section className="card">
          <h3 className="first">Nach der Annahme</h3>
          <div className="btnrow">
            {!o.bookingId ? <Button onClick={hotelBooking}>Hotelreservierung anlegen</Button> : <span className="muted small">Hotelreservierung verknüpft ✓</span>}
            {!o.tableReservationId ? <Button onClick={() => void tableReservation()}>Tischreservierung anlegen</Button> : <span className="muted small">Tischreservierung verknüpft ✓</span>}
          </div>
          <h3>Anzahlung</h3>
          <DepositPanel kind="offer" refId={o.id} base={`/offers/${o.id}`} suggestCents={Math.round((o.totalCents * o.depositPercent) / 100)} latestDue={o.eventDate ?? ''} />
        </section>
      )}
      <div className="formgrid cols3">
        {f('customerCompany', 'Firma')}{f('customerName', 'Ansprechpartner')}{f('email', 'E-Mail', 'email')}
        {f('phone', 'Telefon')}{f('street', 'Straße')}
        <Field label="PLZ / Ort"><div className="inlinerow"><input style={{ maxWidth: 90 }} value={v.zip} disabled={locked} onChange={(e) => ch({ zip: e.target.value })} /><input value={v.city} disabled={locked} onChange={(e) => ch({ city: e.target.value })} /></div></Field>
        <Field label="Termin"><input type="date" value={v.eventDate ?? ''} disabled={locked} onChange={(e) => ch({ eventDate: e.target.value || null })} /></Field>
        <Field label="bis"><input type="date" value={v.eventEnd ?? ''} disabled={locked} onChange={(e) => ch({ eventEnd: e.target.value || null })} /></Field>
        <Field label="Personen"><input inputMode="numeric" value={String(v.persons)} disabled={locked} onChange={(e) => ch({ persons: Number(e.target.value) || 0 })} /></Field>
        {f('title', 'Titel (z. B. Tagung Muster GmbH)')}
        {!q && <Field label="Gültig bis"><input type="date" value={v.validUntil ?? ''} disabled={locked} onChange={(e) => ch({ validUntil: e.target.value || null })} /></Field>}
        {!q && <Field label="Anzahlung nach Annahme (%)"><input inputMode="numeric" value={String(v.depositPercent)} disabled={locked} onChange={(e) => ch({ depositPercent: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} /></Field>}
      </div>
      {q && <><h3>Fragen an den Kunden</h3><QuestionPicker selected={qList} onChange={setQ} disabled={locked} isAdmin={isAdmin} /></>}
      {!q && <>
      <Field label="Einleitung" wide><textarea rows={3} value={v.intro} disabled={locked} onChange={(e) => ch({ intro: e.target.value })} /></Field>
      <h3>Leistungen</h3>
      <div className="tablewrap"><table className="lines offerlines">
        <thead><tr><th>Leistung</th><th>Abrechnung</th><th className="num">Menge</th><th className="num">Einzelpreis</th><th className="num">USt %</th><th className="num">Gesamt</th><th /></tr></thead>
        <tbody>{v.lines.map((l, i) => (
          <tr key={i}>
            <td><input value={l.description} disabled={locked} onChange={(e) => setLine(i, { description: e.target.value })} aria-label="Bezeichnung" /><input className="small" placeholder="Beschreibung (optional)" value={l.detail} disabled={locked} onChange={(e) => setLine(i, { detail: e.target.value })} aria-label="Beschreibung" /></td>
            <td><select value={l.unit} disabled={locked} onChange={(e) => setLine(i, { unit: e.target.value as OfferUnit })} aria-label="Abrechnung">{OFFER_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select></td>
            <td className="num"><input inputMode="decimal" className="numinput" value={l.quantity} disabled={locked} onChange={(e) => setLine(i, { quantity: e.target.value })} aria-label="Menge" /></td>
            <td className="num"><input inputMode="decimal" className="numinput" value={l.price} disabled={locked} onChange={(e) => setLine(i, { price: e.target.value })} aria-label="Einzelpreis" /></td>
            <td className="num"><input inputMode="decimal" className="numinput small" value={l.tax} disabled={locked} onChange={(e) => setLine(i, { tax: e.target.value })} aria-label="Umsatzsteuer" /></td>
            <td className="num nowrap">{formatMoney(totalOf(l))}</td>
            <td>{!locked && <button type="button" className="iconbtn" aria-label="Zeile entfernen" onClick={() => ch({ lines: v.lines.filter((_, k) => k !== i) })}>✕</button>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {!locked && tpls.some((t) => t.active && t.items.length) && (
        <div className="oc-quick">
          <label className="inlinelabel">Produktkatalog <select value={catalogId ?? o.templateId ?? ''} onChange={(e) => setCatalogId(e.target.value)} aria-label="Produktkatalog">
            <option value="">– keiner –</option>{tpls.filter((t) => t.active && t.items.length).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          {catItems.length > 0 && <div className="oc-chips">{catItems.map((x) => (
            <button type="button" key={x.id} className={`chip${v.lines.some((l) => l.itemId === x.id) ? ' on' : ''}`} title={v.lines.some((l) => l.itemId === x.id) ? 'steht schon im Angebot – noch einmal hinzufügen' : x.description || undefined} onClick={() => addItem(x.id)}>{v.lines.some((l) => l.itemId === x.id) ? '✓' : '+'} {x.name} <small className="muted">{formatMoney(x.priceCents)} {UNIT_LABEL[x.unit]}</small></button>
          ))}</div>}
          {catTpl && catItems.length > 0 && <div className="oc-send">
            <span className="muted small">Wie beim Auto: Schritt für Schritt anklicken, die Summe läuft mit.</span>
            <Button variant="primary" onClick={() => setConfig(true)}>Konfigurator öffnen</Button>
          </div>}
          {catTpl && catItems.length > 0 && <div className="oc-send">
            <span className="muted small">Erst den Katalog schicken? Der Kunde kreuzt im PDF an und schickt es zurück.</span>
            <Button onClick={() => void startCatMail()}>Katalog an Kunden schicken</Button>
            <Button onClick={() => void openCatalog()}>Katalog ansehen</Button>
            <Button onClick={() => setCatReturn(true)}>Antwort des Kunden übernehmen …</Button>
          </div>}
        </div>
      )}
      {!locked && <div className="btnrow">
        <select value="" onChange={(e) => { addItem(e.target.value); e.target.value = ''; }} aria-label="Leistung aus dem Katalog hinzufügen">
          <option value="">+ Leistung aus allen Leistungen …</option>
          {catItems.length > 0 && <optgroup label={`Katalog ${catTpl?.name ?? ''}`}>{catItems.map((x) => <option key={x.id} value={x.id}>{x.name} · {formatMoney(x.priceCents)} {UNIT_LABEL[x.unit]}</option>)}</optgroup>}
          <optgroup label="Alle Leistungen">{items.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.name} · {formatMoney(x.priceCents)} {UNIT_LABEL[x.unit]}</option>)}</optgroup>
        </select>
        <Button onClick={() => ch({ lines: [...v.lines, { itemId: null, description: '', detail: '', unit: 'flat', quantity: '1', price: '', tax: '19' }] })}>+ Freie Zeile</Button>
        <Button onClick={recalc} title="Mengen aus Personen, Tagen und Nächten neu berechnen (pauschale Zeilen bleiben)">Mengen neu berechnen</Button>
      </div>}
      <label className="check askalso"><input type="checkbox" checked={askAlso || qList.length > 0} disabled={locked}
        onChange={(e) => { if (e.target.checked) setAskAlso(true); else if (!qList.length || window.confirm('Die ausgewählten Fragen aus dem Angebot entfernen?')) { setAskAlso(false); setQ([]); } }} />
        <span>Fragen mitstellen<small>Fragen aus dem Katalog anklicken – sie stehen im Angebot und in der E-Mail</small></span></label>
      {(askAlso || qList.length > 0) && <QuestionPicker selected={qList} onChange={setQ} disabled={locked} isAdmin={isAdmin} />}
      </>}
      <Field label="Schlusstext" wide><textarea rows={2} value={v.closing} disabled={locked} onChange={(e) => ch({ closing: e.target.value })} /></Field>
      {!q && <Field label="Anlagen (werden mit der E-Mail versendet)" wide>
        <div className="radiolist">{docs.filter((d) => d.active || v.documentIds.includes(d.id)).map((d) => (
          <label key={d.id} className="check"><input type="checkbox" disabled={locked} checked={v.documentIds.includes(d.id)} onChange={(e) => ch({ documentIds: e.target.checked ? [...v.documentIds, d.id] : v.documentIds.filter((x) => x !== d.id) })} /><span>{d.name} <small className="muted">({d.fileName})</small></span></label>
        ))}{docs.length === 0 && <span className="muted small">Noch keine AGB hochgeladen (Angebote → AGB & Dokumente, Administrator).</span>}</div>
      </Field>}
      <Field label="Interne Notiz (erscheint nicht im Angebot)" wide><textarea rows={2} value={v.notes} onChange={(e) => ch({ notes: e.target.value })} /></Field>
      {mail && <MailDialog path={`/offers/${id}/mail`} title={q ? `Fragen zu ${o.number} senden` : `Angebot ${o.number} senden`} sendLabel="Senden" onClose={() => setMail(false)} onSent={bump}
        intro={<p className="muted small">{q ? 'Die E-Mail enthält Ihre Fragen und einen Link zum Beantworten – ohne Anhang.' : 'Angehängt werden das Angebot als PDF und die gewählten Anlagen. Danach gilt das Angebot als versendet.'}</p>} />}
      {catMail && catTpl && <MailDialog path={`/offers/${id}/catalog/mail${catQuery}`} title={`Leistungskatalog „${catTpl.name}“ senden`} sendLabel="Katalog senden" onClose={() => setCatMail(false)}
        attachmentNote="– der Kunde kreuzt darin an und schickt es zurück"
        intro={<p className="muted small">Das Angebot bleibt ein Entwurf. Was schon im Angebot steht, ist im Katalog bereits angekreuzt.{catTpl.catalogPrices ? ' Preise werden gezeigt.' : ' Ohne Preise (einstellbar in der Vorlage).'}</p>} />}
      {catReturn && catTpl && <CatalogReturnDialog offerId={id} offerNumber={o.number} catalogName={catTpl.name} items={catItems} persons={v.persons} inOffer={v.lines.map((l) => l.itemId).filter((x): x is string => !!x)}
        onApply={applyReturn} onClose={() => setCatReturn(false)} />}
      {config && catTpl && <ConfiguratorDialog catalogName={catTpl.name} items={catItems} lines={v.lines} persons={v.persons} from={v.eventDate} to={v.eventEnd}
        onApply={(lines) => { ch({ lines }); toast('Leistungen übernommen – bitte prüfen und speichern'); }} onClose={() => setConfig(false)} />}
      {accepting && <AcceptDialog offer={o} onClose={() => setAccepting(false)} />}
    </Dialog>
  );
}

/** Verlauf wie ein Chat: oben die Kurzinfo (Stand), darunter gesendete E-Mails (rechts), Antworten des Kunden (links) und Ereignisse */
function OfferThread({ offer: o, onAccept }: { offer: OfferDto; onAccept?: () => void }) {
  const { rev, bump } = useData();
  const toast = useToast();
  const { data } = useLoad(() => api<OfferTimeline>('GET', `/offers/${o.id}/timeline`), [o.id, rev]);
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const when = (iso: string) => new Date(iso).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
  const day = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  const outs = data.entries.filter((e) => e.dir === 'out'), ins = data.entries.filter((e) => e.dir === 'in');
  const lastOut = outs[outs.length - 1], lastIn = ins[ins.length - 1];
  const waiting = !!lastOut && (!lastIn || lastIn.at < lastOut.at) && o.status !== 'accepted' && o.status !== 'declined';
  const hint = o.status === 'accepted' || o.status === 'declined' ? null : lastIn?.hint ?? null;
  const act = async (path: string, body: unknown, msg: string) => { try { await api('POST', `/offers/${o.id}/timeline/${path}`, body); toast(msg); bump(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); } };
  return (
    <section className="card ot-card">
      <div className="ot-info">
        <Badge tone={TONE[o.state]}>{o.status === 'accepted' ? 'bestätigt' : o.status === 'declined' ? 'abgelehnt' : 'noch nicht bestätigt'}</Badge>
        {lastOut && <span>{lastOut.title} am {day(lastOut.at)}</span>}
        {lastIn && <span>Antwort vom Kunden am {day(lastIn.at)}</span>}
        {waiting && <span className="muted">wartet auf Antwort</span>}
        {!lastOut && !lastIn && <span className="muted">noch nichts gesendet</span>}
        <span className="ot-code" title="Dieses Kennzeichen steht im Betreff jeder E-Mail zu diesem Angebot. Antwortet der Kunde darauf, wird die Antwort hier automatisch zugeordnet.">Kennzeichen {data.code}</span>
        <button type="button" className="linkbtn" onClick={() => setOpen(!open)}>{open ? 'Verlauf ausblenden' : `Verlauf zeigen (${data.entries.length})`}</button>
      </div>
      {hint === 'accept' && <p className="notice small">Die letzte Antwort <b>klingt nach einer Zusage</b> – bitte lesen und prüfen. {onAccept && <Button onClick={onAccept}>Als angenommen vermerken …</Button>}</p>}
      {hint === 'decline' && <p className="notice warn small">Die letzte Antwort <b>klingt nach einer Absage</b> – bitte lesen und prüfen.</p>}
      {data.candidates.length > 0 && <div className="ot-cand">
        <span className="muted small">Im Posteingang von dieser Adresse, noch nicht zugeordnet:</span>
        {data.candidates.map((c) => <div key={c.inboxMailId}><span>{when(c.at)} · {c.subject || '(ohne Betreff)'}</span><Button onClick={() => void act('assign', { inboxMailId: c.inboxMailId }, 'E-Mail zugeordnet')}>Zuordnen</Button></div>)}
      </div>}
      {open && <ol className="ot-list">{data.entries.map((e) => (
        <li key={e.id} className={`ot-${e.dir}`}>
          <div className="ot-bubble">
            <div className="ot-head"><b>{e.title}</b><small>{when(e.at)}{e.by ? ` · ${e.by}` : ''}</small></div>
            {e.subject && <div className="ot-subject">{e.subject}</div>}
            {e.hint && <div className="ot-hint">{e.hint === 'accept' ? 'klingt nach Zusage – bitte prüfen' : 'klingt nach Absage – bitte prüfen'}</div>}
            {e.text && (e.text.length > 280 ? <details><summary>{e.text.slice(0, 200).trim()} … <u>ganz lesen</u></summary><div className="ot-text">{e.text}</div></details> : <div className="ot-text">{e.text}</div>)}
            {e.removable && <button type="button" className="linkbtn small" onClick={() => { if (window.confirm('Diese E-Mail gehört nicht zu diesem Angebot? Die Zuordnung wird gelöst; die E-Mail bleibt im Posteingang.')) void act('remove', { eventId: e.id }, 'Zuordnung gelöst'); }}>gehört nicht hierher</button>}
          </div>
        </li>
      ))}</ol>}
    </section>
  );
}

/** Konfigurator: Leistungen des Katalogs Schritt für Schritt (je Gruppe) anklicken, Menge anpassen, Summe läuft mit */
function ConfiguratorDialog({ catalogName, items, lines, persons, from, to, onApply, onClose }: {
  catalogName: string; items: OfferItemDto[]; lines: LineDraft[]; persons: number; from: string | null; to: string | null;
  onApply: (lines: LineDraft[]) => void; onClose: () => void;
}) {
  const groups = groupItems(items);
  const suggest = (it: OfferItemDto) => String(quantityFor(it.unit, persons, from, to)).replace('.', ',');
  // Auswahl: Leistungs-ID → Menge (Text); Vorgabe: was schon im Angebot steht
  const [sel, setSel] = useState<Record<string, string>>(() => Object.fromEntries(items.flatMap((it) => { const l = lines.find((x) => x.itemId === it.id); return l ? [[it.id, l.quantity]] : []; })));
  const [step, setStep] = useState(0);
  const last = step === groups.length;
  // Preis: der im Angebot schon angepasste Preis gilt weiter, sonst der Katalogpreis
  const priceOf = (it: OfferItemDto) => { const l = lines.find((x) => x.itemId === it.id); const c = l ? parseMoney(l.price) : NaN; return Number.isFinite(c) ? c : it.priceCents; };
  const sumOf = (it: OfferItemDto) => { const n = qty(sel[it.id] ?? ''); return Number.isFinite(n) ? lineTotal(n, priceOf(it)) : 0; };
  const chosen = items.filter((it) => it.id in sel);
  const total = chosen.reduce((s, it) => s + sumOf(it), 0);
  const other = lines.filter((l) => !l.itemId || !items.some((it) => it.id === l.itemId));
  const otherTotal = other.reduce((s, l) => { const n = qty(l.quantity), c = parseMoney(l.price); return s + (Number.isFinite(n) && Number.isFinite(c) ? lineTotal(n, c) : 0); }, 0);
  const toggle = (it: OfferItemDto) => setSel((s) => { const n = { ...s }; if (it.id in n) delete n[it.id]; else n[it.id] = suggest(it); return n; });
  const apply = () => {
    const bad = chosen.find((it) => { const n = qty(sel[it.id] ?? ''); return !Number.isFinite(n) || n < 0; });
    if (bad) { window.alert(`Bitte bei „${bad.name}“ eine Menge eintragen.`); return; }
    const used = new Set<string>();
    // bestehende Zeilen behalten (mit angepasstem Text/Preis), Menge übernehmen; abgewählte Katalog-Leistungen entfernen; neue anhängen
    const kept = lines.flatMap((l): LineDraft[] => {
      const it = l.itemId ? items.find((x) => x.id === l.itemId) : undefined;
      if (!it) return [l];
      if (!(it.id in sel) || used.has(it.id)) return [];
      used.add(it.id);
      return [{ ...l, quantity: sel[it.id]! }];
    });
    const added = chosen.filter((it) => !used.has(it.id)).map((it): LineDraft => ({ itemId: it.id, description: it.name, detail: it.description, unit: it.unit, quantity: sel[it.id]!, price: moneyInput(it.priceCents), tax: String(it.taxRatePercent) }));
    onApply([...kept, ...added]);
    onClose();
  };
  const g = groups[step];
  return (
    <Dialog title={`Konfigurator – ${catalogName}`} onClose={onClose} size="xl"
      footer={<>
        <span className="left total">Summe <b>{formatMoney(total + otherTotal)}</b>{otherTotal !== 0 && <small className="muted"> (davon {formatMoney(otherTotal)} weitere Zeilen im Angebot)</small>}</span>
        {step > 0 && <Button onClick={() => setStep(step - 1)}>Zurück</Button>}
        {!last ? <Button variant="primary" onClick={() => setStep(step + 1)}>Weiter</Button> : <Button variant="primary" onClick={apply}>Ins Angebot übernehmen</Button>}
      </>}>
      <ol className="cfg-steps">
        {groups.map((x, i) => { const n = x.items.filter((it) => it.id in sel).length; return (
          <li key={x.name}><button type="button" className={i === step ? 'on' : n ? 'done' : ''} onClick={() => setStep(i)}><span>{i + 1}</span>{x.name}{n > 0 && <small>{n}</small>}</button></li>
        ); })}
        <li><button type="button" className={last ? 'on' : ''} onClick={() => setStep(groups.length)}><span>✓</span>Übersicht</button></li>
      </ol>
      <p className="muted small">Für {persons} {persons === 1 ? 'Person' : 'Personen'}{from ? `, ${new Date(`${from}T12:00:00`).toLocaleDateString('de-DE')}${to && to !== from ? ` bis ${new Date(`${to}T12:00:00`).toLocaleDateString('de-DE')}` : ''}` : ''}. Die Menge wird vorgeschlagen und lässt sich ändern.</p>
      {g && <div className="cfg-grid">{g.items.map((it) => { const on = it.id in sel; return (
        <div key={it.id} className={`cfg-card${on ? ' on' : ''}`}>
          <button type="button" className="cfg-pick" aria-pressed={on} onClick={() => toggle(it)}>
            <span className="cfg-box" aria-hidden="true">{on ? '✓' : ''}</span>
            <span className="cfg-name">{it.name}{it.description && <small>{it.description}</small>}</span>
            <span className="cfg-price">{formatMoney(priceOf(it))}<small>{UNIT_LABEL[it.unit]}</small></span>
          </button>
          {on && <div className="cfg-qty"><label>Menge <input inputMode="decimal" className="numinput" value={sel[it.id]} onChange={(e) => setSel({ ...sel, [it.id]: e.target.value })} aria-label={`Menge ${it.name}`} /></label><b>{formatMoney(sumOf(it))}</b></div>}
        </div>
      ); })}</div>}
      {last && (chosen.length === 0 ? <p className="muted">Noch nichts ausgewählt.</p> : (
        <div className="tablewrap"><table><thead><tr><th>Leistung</th><th className="num">Menge</th><th className="num">Einzelpreis</th><th className="num">Gesamt</th></tr></thead>
          <tbody>
            {groups.map((x) => x.items.filter((it) => it.id in sel).map((it) => <tr key={it.id}><td><b>{it.name}</b> <small className="muted">{x.name}</small></td><td className="num">{sel[it.id]}</td><td className="num">{formatMoney(priceOf(it))} <small className="muted">{UNIT_LABEL[it.unit]}</small></td><td className="num">{formatMoney(sumOf(it))}</td></tr>))}
            {other.length > 0 && <tr><td colSpan={3} className="muted">Weitere Zeilen im Angebot ({other.length}) – bleiben unverändert</td><td className="num">{formatMoney(otherTotal)}</td></tr>}
          </tbody></table></div>
      ))}
    </Dialog>
  );
}

/** Rückmeldung zum Katalog: zurückgeschicktes PDF einlesen oder von Hand ankreuzen (bei Ausdruck, E-Mail-Text, Telefon) */
function CatalogReturnDialog({ offerId, offerNumber, catalogName, items, persons, inOffer, onApply, onClose }: {
  offerId: string; offerNumber: string; catalogName: string; items: OfferItemDto[]; persons: number; inOffer: string[];
  onApply: (r: { itemIds: string[]; persons: number | null; note: string }) => void; onClose: () => void;
}) {
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>([]);
  const [read, setRead] = useState<CatalogReturn | null>(null);
  const [takePersons, setTakePersons] = useState(true);
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/offers/${offerId}/catalog/read`, { method: 'POST', credentials: 'same-origin', body: file, headers: { 'Content-Type': 'application/octet-stream' } });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? `Fehler ${res.status}`);
      const r = j as CatalogReturn;
      setRead(r); setPicked(r.itemIds.filter((x) => items.some((i) => i.id === x)));
      toast(`${r.itemIds.length} angekreuzte Leistung(en) gefunden`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  const newPersons = read?.persons && read.persons !== persons ? read.persons : null;
  const apply = () => {
    const parts = read ? [
      `Rückmeldung zum Katalog „${catalogName}“ (${new Date().toLocaleDateString('de-DE')})`,
      read.name && `Name: ${read.name}`, read.date && `Wunschtermin: ${read.date}`, read.persons && `Personen: ${read.persons}`, read.remarks && `Wünsche: ${read.remarks}`,
    ].filter(Boolean) : [];
    onApply({ itemIds: picked, persons: newPersons && takePersons ? newPersons : null, note: parts.join('\n') });
    onClose();
  };
  return (
    <Dialog title={`Antwort zum Katalog „${catalogName}“`} onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" disabled={!picked.length && !read} onClick={apply}>Ins Angebot übernehmen</Button></>}>
      <div className="oc-ret-file">
        <label className={`btn${busy ? ' disabled' : ''}`}>Zurückgeschicktes PDF einlesen …<input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} /></label>
        <span className="muted small">Hat der Kunde ausgedruckt, per Hand angekreuzt oder einfach geschrieben? Dann unten selbst ankreuzen.</span>
      </div>
      {read && <div className="oc-ret-info">
        {read.warnings.map((w) => <p key={w} className="notice warn small">{w}</p>)}
        <dl>
          {read.name && <div><dt>Name</dt><dd>{read.name}</dd></div>}
          {read.date && <div><dt>Wunschtermin</dt><dd>{read.date} <small className="muted">(bitte im Angebot selbst eintragen)</small></dd></div>}
          {read.persons && <div><dt>Personen</dt><dd>{read.persons}</dd></div>}
          {read.remarks && <div><dt>Wünsche</dt><dd className="prewrap">{read.remarks}</dd></div>}
        </dl>
        {newPersons && <label className="check"><input type="checkbox" checked={takePersons} onChange={(e) => setTakePersons(e.target.checked)} /><span>Personenzahl auf {newPersons} ändern (bisher {persons})</span></label>}
        <p className="muted small">Die Angaben kommen in die interne Notiz{read.itemIds.length ? ', die angekreuzten Leistungen ins Angebot' : ''}. Bei {offerNumber} wird erst mit „Speichern“ etwas geändert.</p>
      </div>}
      <h3>Leistungen{read ? ' – vom Kunden angekreuzt' : ''}</h3>
      <div className="radiolist">{items.map((it) => (
        <label key={it.id} className="check"><input type="checkbox" checked={picked.includes(it.id)} onChange={(e) => setPicked(e.target.checked ? [...picked, it.id] : picked.filter((x) => x !== it.id))} />
          <span>{it.name} <small className="muted">{formatMoney(it.priceCents)} {UNIT_LABEL[it.unit]}{inOffer.includes(it.id) ? ' · steht schon im Angebot' : ''}</small></span></label>
      ))}</div>
    </Dialog>
  );
}

function AcceptDialog({ offer: o, onClose }: { offer: OfferDto; onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const [v, setV] = useState({ method: 'email', name: o.customerName || o.customerCompany, note: '' });
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try { await api('POST', `/offers/${o.id}/accept`, v); toast(`Angebot ${o.number} angenommen`); bump(); onClose(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  return (
    <Dialog title={`Annahme von ${o.number} festhalten`} onClose={onClose} footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={busy} disabled={!v.name.trim()} onClick={() => void go()}>Als angenommen speichern</Button></>}>
      <p className="muted small">Für Annahmen per E-Mail, Telefon, persönlich oder unterschrieben zurück. (Online über den Link nimmt der Kunde selbst an.) Festgehalten wird die {o.status === 'sent' ? 'versendete' : 'aktuelle'} Fassung des Angebots.</p>
      <div className="formgrid">
        <Field label="Wie angenommen?"><select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
          <option value="email">per E-Mail</option><option value="telefon">telefonisch</option><option value="persoenlich">persönlich</option><option value="schriftlich">unterschrieben zurück</option></select></Field>
        <Field label="Von wem?"><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Notiz" wide><input value={v.note} placeholder="z. B. E-Mail vom 12.03., 18:40 Uhr" onChange={(e) => setV({ ...v, note: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

// ---------- Verwaltung (Administrator) ----------
function ItemsAdmin() {
  const { rev } = useData();
  const { data, error } = useLoad(() => api<OfferItemDto[]>('GET', '/offer-items'), [rev]);
  const [edit, setEdit] = useState<OfferItemDto | 'new' | null>(null);
  return (
    <section className="card">
      <div className="cardhead"><h2>Leistungen (Katalog)</h2><div className="actions"><Button variant="primary" onClick={() => setEdit('new')}>Leistung anlegen</Button></div></div>
      <p className="muted small">Preise sind Bruttopreise (inkl. Umsatzsteuer). Bitte den passenden Steuersatz je Leistung eintragen (z. B. 7 % Übernachtung, 19 % Getränke) – im Zweifel mit dem Steuerberater klären.</p>
      <LoadState error={error} loading={!data} />
      {data && (data.length === 0 ? <p className="muted">Noch keine Leistungen.</p> : (
        <div className="tablewrap"><table><thead><tr><th>Leistung</th><th>Gruppe</th><th>Abrechnung</th><th className="num">Preis</th><th className="num">USt</th><th>Bereich</th></tr></thead>
          <tbody>{data.map((i) => <tr key={i.id} className={`rowlink${i.active ? '' : ' faded'}`} onClick={() => setEdit(i)}><td><b>{i.name}</b>{i.description && <><br /><small className="muted">{i.description}</small></>}</td><td>{i.group || <span className="muted">–</span>}</td><td>{UNIT_LABEL[i.unit]}</td><td className="num">{formatMoney(i.priceCents)}</td><td className="num">{i.taxRatePercent} %</td><td>{AREA_LABEL[i.area]}</td></tr>)}</tbody></table></div>
      ))}
      {edit && <ItemDialog item={edit === 'new' ? null : edit} groups={[...new Set((data ?? []).map((i) => i.group).filter(Boolean))]} onClose={() => setEdit(null)} />}
    </section>
  );
}
function ItemDialog({ item, groups, onClose }: { item: OfferItemDto | null; groups: string[]; onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const [v, setV] = useState({ name: item?.name ?? '', description: item?.description ?? '', unit: item?.unit ?? 'person' as OfferUnit, price: item ? moneyInput(item.priceCents) : '', tax: String(item?.taxRatePercent ?? 19), area: item?.area ?? 'both' as OfferArea, group: item?.group ?? '', sort: String(item?.sort ?? 0), active: item?.active ?? true });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const p = offerItemInput.safeParse({ ...v, priceCents: parseMoney(v.price), taxRatePercent: Number(v.tax.replace(',', '.')), sort: Number(v.sort) || 0 });
    if (!p.success) { toast(p.error.issues[0]?.message ?? 'Bitte Eingaben prüfen', 'error'); return; }
    setBusy(true);
    try { await api(item ? 'PUT' : 'POST', item ? `/offer-items/${item.id}` : '/offer-items', item ? { ...p.data, version: item.version } : p.data); toast('Gespeichert'); bump(); onClose(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  return (
    <Dialog title={item ? 'Leistung bearbeiten' : 'Leistung anlegen'} onClose={onClose} footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={busy} onClick={() => void save()}>Speichern</Button></>}>
      <div className="formgrid">
        <Field label="Bezeichnung" wide><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="z. B. Tagungspauschale ganztags" /></Field>
        <Field label="Beschreibung (erscheint im Angebot)" wide><input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="z. B. Raum, Technik, 2 Kaffeepausen, Mittagessen" /></Field>
        <Field label="Abrechnung"><select value={v.unit} onChange={(e) => setV({ ...v, unit: e.target.value as OfferUnit })}>{OFFER_UNITS.map((u) => <option key={u} value={u}>{UNIT_LABEL[u]}</option>)}</select></Field>
        <Field label="Preis (brutto)"><input inputMode="decimal" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} /></Field>
        <Field label="USt %"><input inputMode="decimal" value={v.tax} onChange={(e) => setV({ ...v, tax: e.target.value })} /></Field>
        <Field label="Bereich"><select value={v.area} onChange={(e) => setV({ ...v, area: e.target.value as OfferArea })}>{OFFER_AREAS.map((a) => <option key={a} value={a}>{AREA_LABEL[a]}</option>)}</select></Field>
        <Field label="Gruppe (Schritt im Konfigurator)" hint="z. B. Raum, Verpflegung, Technik, Extras"><input list="oc-groups" value={v.group} onChange={(e) => setV({ ...v, group: e.target.value })} /><datalist id="oc-groups">{groups.map((g) => <option key={g} value={g} />)}</datalist></Field>
        <Field label="Reihenfolge"><input inputMode="numeric" value={v.sort} onChange={(e) => setV({ ...v, sort: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /><span>In Benutzung</span></label>
      </div>
    </Dialog>
  );
}

function TemplatesAdmin() {
  const { rev } = useData();
  const { data, error } = useLoad(() => api<OfferTemplateDto[]>('GET', '/offer-templates'), [rev]);
  const [edit, setEdit] = useState<OfferTemplateDto | 'new' | null>(null);
  return (
    <section className="card">
      <div className="cardhead"><h2>Vorlagen</h2><div className="actions"><Button variant="primary" onClick={() => setEdit('new')}>Vorlage anlegen</Button></div></div>
      <p className="muted small">Eine Vorlage steht für eine Art von Anlass (z. B. Tagung, Hochzeit, Geburtstag) und enthält Titel, Texte, den Fragenkatalog, ihren eigenen Produktkatalog (welche Leistungen dazu passen und welche gleich ins Angebot kommen), Gültigkeit, Anzahlung und die Anlagen (z. B. AGB). Die Mustervorlagen enthalten noch keine Leistungen und Preise – bitte ergänzen.</p>
      <LoadState error={error} loading={!data} />
      {data && <ul className="plain">{data.map((t) => <li key={t.id} className={`rowlink${t.active ? '' : ' faded'}`} onClick={() => setEdit(t)}><span><b>{t.name}</b> <small className="muted">{AREA_LABEL[t.area]} · {t.items.length} Leistungen · {t.questions.length} Fragen · gültig {t.validDays} Tage{t.depositPercent ? ` · Anzahlung ${t.depositPercent} %` : ''}</small></span></li>)}</ul>}
      {edit && <TemplateDialog tpl={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </section>
  );
}
function TemplateDialog({ tpl, onClose }: { tpl: OfferTemplateDto | null; onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const items = useLoad(() => api<OfferItemDto[]>('GET', '/offer-items')).data ?? [];
  const docs = useLoad(() => api<OfferDocumentDto[]>('GET', '/offer-documents')).data ?? [];
  const [v, setV] = useState({
    name: tpl?.name ?? '', area: tpl?.area ?? 'both' as OfferArea, title: tpl?.title ?? '', intro: tpl?.intro ?? '', closing: tpl?.closing ?? '',
    questions: (tpl?.questions ?? []).join('\n'), catalog: (tpl?.items ?? []).map((x) => ({ itemId: x.itemId, preselect: x.preselect !== false, quantity: x.quantity ?? null })), validDays: String(tpl?.validDays ?? 14), depositPercent: String(tpl?.depositPercent ?? 0),
    documentIds: tpl?.documentIds ?? [], sort: String(tpl?.sort ?? 0), active: tpl?.active ?? true, catalogPrices: tpl?.catalogPrices ?? false,
    talkSteps: (tpl?.talkSteps ?? []) as TalkStep[],
  });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const p = offerTemplateInput.safeParse({ ...v, questions: v.questions.split('\n').map((x) => x.trim()).filter(Boolean), items: v.catalog,
      validDays: Number(v.validDays) || 0, depositPercent: Number(v.depositPercent) || 0, sort: Number(v.sort) || 0 });
    if (!p.success) { toast(p.error.issues[0]?.message ?? 'Bitte Eingaben prüfen', 'error'); return; }
    setBusy(true);
    try { await api(tpl ? 'PUT' : 'POST', tpl ? `/offer-templates/${tpl.id}` : '/offer-templates', tpl ? { ...p.data, version: tpl.version } : p.data); toast('Vorlage gespeichert'); bump(); onClose(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  const toggle = (list: string[], id: string, on: boolean) => (on ? [...list, id] : list.filter((x) => x !== id));
  return (
    <Dialog title={tpl ? `Vorlage „${tpl.name}“` : 'Vorlage anlegen'} onClose={onClose} size="lg" footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={busy} onClick={() => void save()}>Speichern</Button></>}>
      <div className="formgrid cols3">
        <Field label="Name"><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Bereich"><select value={v.area} onChange={(e) => setV({ ...v, area: e.target.value as OfferArea })}>{OFFER_AREAS.map((a) => <option key={a} value={a}>{AREA_LABEL[a]}</option>)}</select></Field>
        <Field label="Titel im Angebot"><input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} /></Field>
        <Field label="Gültig (Tage)"><input inputMode="numeric" value={v.validDays} onChange={(e) => setV({ ...v, validDays: e.target.value })} /></Field>
        <Field label="Anzahlung nach Annahme (%)"><input inputMode="numeric" value={v.depositPercent} onChange={(e) => setV({ ...v, depositPercent: e.target.value })} /></Field>
        <Field label="Reihenfolge"><input inputMode="numeric" value={v.sort} onChange={(e) => setV({ ...v, sort: e.target.value })} /></Field>
      </div>
      <Field label="Einleitung" wide><textarea rows={3} value={v.intro} onChange={(e) => setV({ ...v, intro: e.target.value })} /></Field>
      <Field label="Fragenkatalog (eine Frage je Zeile)" wide><textarea rows={6} value={v.questions} onChange={(e) => setV({ ...v, questions: e.target.value })} /></Field>
      <Field label="Schlusstext" wide><textarea rows={2} value={v.closing} onChange={(e) => setV({ ...v, closing: e.target.value })} /></Field>
      <Field label="Produktkatalog dieser Vorlage" wide hint="„im Katalog“: wird beim Angebot mit dieser Vorlage zur schnellen Auswahl angeboten. „gleich ins Angebot“: steht beim Anlegen schon drin.">
        <div className="oc-cat">
          {items.filter((i) => i.active || v.catalog.some((c) => c.itemId === i.id)).map((i) => {
            const c = v.catalog.find((x) => x.itemId === i.id);
            const setC = (next: { in: boolean; pre: boolean }) => setV({ ...v, catalog: next.in ? (c ? v.catalog.map((x) => (x.itemId === i.id ? { ...x, preselect: next.pre } : x)) : [...v.catalog, { itemId: i.id, preselect: next.pre, quantity: null }]) : v.catalog.filter((x) => x.itemId !== i.id) });
            return (
              <div key={i.id} className={c ? 'on' : ''}>
                <span>{i.name} <small className="muted">{formatMoney(i.priceCents)} {UNIT_LABEL[i.unit]}</small></span>
                <label className="check"><input type="checkbox" checked={!!c} onChange={(e) => setC({ in: e.target.checked, pre: false })} /><span>im Katalog</span></label>
                <label className="check"><input type="checkbox" checked={!!c?.preselect} disabled={!c} onChange={(e) => setC({ in: true, pre: e.target.checked })} /><span>gleich ins Angebot</span></label>
              </div>
            );
          })}
          {items.length === 0 && <span className="muted small">Erst unter „Leistungen“ Leistungen anlegen.</span>}
        </div>
        <label className="check"><input type="checkbox" checked={v.catalogPrices} onChange={(e) => setV({ ...v, catalogPrices: e.target.checked })} /><span>Preise im Katalog für den Kunden zeigen<small>gilt für den Katalog zum Ankreuzen, den der Kunde per E-Mail bekommt</small></span></label>
      </Field>
      <Field label="Absprache am Tisch – Schritte" wide hint="Eigene Schritte mit Antworten zum Antippen, z. B. „Essen: à la carte / kleines Menü / Buffet“. Mit Leistung = kommt mit Preis ins Angebot; ohne = nur eine Angabe. Ohne Schritte nutzt die Absprache die Gruppen des Produktkatalogs.">
        <TalkStepsEditor steps={v.talkSteps} items={items} onChange={(talkSteps) => setV({ ...v, talkSteps })} />
      </Field>
      <Field label="Anlagen" wide><div className="radiolist">{docs.filter((d) => d.active || v.documentIds.includes(d.id)).map((d) => <label key={d.id} className="check"><input type="checkbox" checked={v.documentIds.includes(d.id)} onChange={(e) => setV({ ...v, documentIds: toggle(v.documentIds, d.id, e.target.checked) })} /><span>{d.name}{!d.active && <small className="muted"> (ausgeblendet – wird nicht mehr übernommen)</small>}</span></label>)}{docs.length === 0 && <span className="muted small">Noch keine Dokumente hochgeladen.</span>}</div></Field>
      <label className="check"><input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} /><span>In Benutzung</span></label>
    </Dialog>
  );
}

/** Schritte der Absprache einer Vorlage bearbeiten: Titel, Art, Antworten (mit oder ohne Leistung), Reihenfolge */
function TalkStepsEditor({ steps, items, onChange }: { steps: TalkStep[]; items: OfferItemDto[]; onChange: (s: TalkStep[]) => void }) {
  const setStep = (i: number, p: Partial<TalkStep>) => onChange(steps.map((s, k) => (k === i ? { ...s, ...p } : s)));
  const move = (i: number, d: number) => { const n = [...steps]; const [x] = n.splice(i, 1); n.splice(i + d, 0, x!); onChange(n); };
  return (
    <div className="tk-edit">
      {steps.map((s, i) => (
        <div key={i} className="tk-step">
          <div className="tk-head">
            <b>{i + 1}.</b>
            <input value={s.title} placeholder="Schritt, z. B. Essen" onChange={(e) => setStep(i, { title: e.target.value })} aria-label={`Schritt ${i + 1} Titel`} />
            <select value={s.kind} onChange={(e) => setStep(i, { kind: e.target.value as TalkKind })} aria-label={`Schritt ${i + 1} Art`}>{TALK_KINDS.map((k) => <option key={k} value={k}>{TALK_KIND_LABEL[k]}</option>)}</select>
            <button type="button" className="iconbtn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="nach oben">↑</button>
            <button type="button" className="iconbtn" disabled={i === steps.length - 1} onClick={() => move(i, 1)} aria-label="nach unten">↓</button>
            <button type="button" className="iconbtn" onClick={() => { if (window.confirm(`Schritt „${s.title || i + 1}“ entfernen?`)) onChange(steps.filter((_, k) => k !== i)); }} aria-label="Schritt entfernen">✕</button>
          </div>
          <input className="small" value={s.hint} placeholder="Hinweis für den Mitarbeiter (optional), z. B. „nach Allergien fragen“" onChange={(e) => setStep(i, { hint: e.target.value })} aria-label={`Schritt ${i + 1} Hinweis`} />
          {s.kind !== 'text' && <>
            {s.options.map((o, k) => (
              <div key={k} className="tk-opt">
                <input value={o.label} placeholder="Antwort, z. B. à la carte" onChange={(e) => setStep(i, { options: s.options.map((x, n) => (n === k ? { ...x, label: e.target.value } : x)) })} aria-label={`Schritt ${i + 1} Antwort ${k + 1}`} />
                <select value={o.itemId ?? ''} aria-label={`Schritt ${i + 1} Antwort ${k + 1} Leistung`} onChange={(e) => { const it = items.find((x) => x.id === e.target.value); setStep(i, { options: s.options.map((x, n) => (n === k ? { label: x.label || it?.name || '', itemId: e.target.value || null } : x)) }); }}>
                  <option value="">– ohne Preis (nur Angabe) –</option>
                  {items.filter((x) => x.active || x.id === o.itemId).map((x) => <option key={x.id} value={x.id}>{x.name} · {formatMoney(x.priceCents)} {UNIT_LABEL[x.unit]}</option>)}
                </select>
                <button type="button" className="iconbtn" onClick={() => setStep(i, { options: s.options.filter((_, n) => n !== k) })} aria-label="Antwort entfernen">✕</button>
              </div>
            ))}
            <div><Button onClick={() => setStep(i, { options: [...s.options, { label: '', itemId: null }] })}>+ Antwort</Button></div>
          </>}
        </div>
      ))}
      <div><Button onClick={() => onChange([...steps, { title: '', hint: '', kind: 'single', options: [] }])}>+ Schritt</Button></div>
    </div>
  );
}

/** Absprache-Zettel drucken (eigenes Fenster, A4) */
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function printTalk(o: OfferDto, t: OfferTalk) {
  const w = window.open('', '_blank');
  if (!w) return;
  const when = o.eventDate ? `${deDate(o.eventDate)}${o.eventEnd && o.eventEnd !== o.eventDate ? ` – ${deDate(o.eventEnd)}` : ''}` : 'noch offen';
  w.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Absprache ${esc(o.number)}</title><style>
    body{font:14px/1.45 Arial,Helvetica,sans-serif;color:#111;margin:18mm}h1{font-size:20px;margin:0 0 4px}p.sub{color:#555;margin:0 0 14px}
    table{border-collapse:collapse;width:100%}td{border-top:1px solid #ccc;padding:8px 6px;vertical-align:top}td:first-child{width:32%;font-weight:bold}
    .txt{white-space:pre-wrap;color:#333}.foot{margin-top:18px;color:#555;font-size:12px}</style></head><body>
    <h1>Absprache${t.template ? ` – ${esc(t.template)}` : ''}</h1>
    <p class="sub">${esc(o.customer)} · ${o.persons} ${o.persons === 1 ? 'Person' : 'Personen'} · Termin: ${esc(when)}${o.phone ? ` · Tel. ${esc(o.phone)}` : ''}</p>
    <table>${t.steps.map((s) => `<tr><td>${esc(s.title)}</td><td>${s.answers.map(esc).join(', ') || (s.text ? '' : '–')}${s.text ? `<div class="txt">${esc(s.text)}</div>` : ''}</td></tr>`).join('')}</table>
    <p class="foot">Aufgenommen am ${new Date(t.at).toLocaleString('de-DE')} von ${esc(t.by)} · Angebot ${esc(o.number)} (Entwurf – keine verbindliche Zusage)</p>
    </body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

function DocumentsAdmin() {
  const { rev, bump } = useData();
  const toast = useToast();
  const { data, error } = useLoad(() => api<OfferDocumentDto[]>('GET', '/offer-documents'), [rev]);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const upload = async (file: File) => {
    setBusy(true);
    try {
      const res = await fetch('/api/v1/offer-documents', { method: 'POST', credentials: 'same-origin', body: file,
        headers: { 'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), 'x-doc-name': encodeURIComponent(name || file.name.replace(/\.pdf$/i, '')) } });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error(j?.error?.message ?? `Fehler ${res.status}`);
      toast('Dokument hochgeladen'); setName(''); bump();
    } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  const setActive = async (d: OfferDocumentDto, active: boolean) => {
    try { await api('POST', `/offer-documents/${d.id}/active`, { active }); bump(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  return (
    <section className="card">
      <h2>AGB & Dokumente</h2>
      <p className="muted small">PDF-Dateien, die mit Angeboten versendet werden (z. B. AGB Hotel, AGB Veranstaltungen, Stornobedingungen). Eine neue Fassung bitte neu hochladen und die alte ausblenden – so bleibt nachvollziehbar, welche Fassung ein Kunde bekommen hat. Den Inhalt Ihrer AGB sollte ein Anwalt oder die DEHOGA-Beratung prüfen.</p>
      <div className="filters">
        <input placeholder="Bezeichnung, z. B. AGB Hotel 2027" value={name} onChange={(e) => setName(e.target.value)} />
        <label className={`btn${busy ? ' disabled' : ''}`}>PDF hochladen …<input type="file" accept="application/pdf,.pdf" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ''; }} /></label>
      </div>
      <LoadState error={error} loading={!data} />
      {data && <ul className="plain">{data.map((d) => (
        <li key={d.id} className={d.active ? undefined : 'faded'}>
          <span><b>{d.name}</b> <small className="muted">{d.fileName} · {Math.ceil(d.sizeBytes / 1024)} kB · {new Date(d.createdAt).toLocaleDateString('de-DE')} von {d.uploadedBy}</small></span>
          <span className="right"><a className="btn" href={`/api/v1/offer-documents/${d.id}/file`} target="_blank" rel="noopener">Ansehen</a> <Button onClick={() => void setActive(d, !d.active)}>{d.active ? 'Ausblenden' : 'Wieder anzeigen'}</Button></span>
        </li>
      ))}</ul>}
    </section>
  );
}
