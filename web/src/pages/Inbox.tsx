import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CASE_STATUSES, CASE_STATUS_LABEL, MAIL_KINDS, MAIL_KIND_LABEL, MAIL_KIND_SHORT, DEFAULT_NEXT_TEXTS, NEXT_TEXT_LABEL, nextTextsInput, replySnippetsInput, type NextTexts, type CaseDto, type CaseListRow, type CaseStatus, type ReplySnippet, type InboxCounts, type InboxMailDto, type InboxState, type InboxStatus } from '../../../src/shared/inbox.js';
import type { MailKind } from '../../../src/shared/mailextract.js';
import { tableReservationInput } from '../../../src/shared/restaurant.js';
import { hasModule } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { MailDialog } from '../hotel/MailDialog.tsx';
import { Badge, Button, Field, LoadState, PageHeader, fmtDateTime, useLoad, useSubmit, useTabs, useToast } from '../ui.tsx';

export const INBOX_TABS = [['vorgaenge', 'Vorgänge'], ['new', 'Neu'], ['done', 'Erledigt'], ['ignored', 'Ignoriert'], ['all', 'Alle'], ['vorlagen', 'Antwortvorlagen']] as const;
const tone = (k: MailKind) => (k === 'hotel' || k === 'meeting' ? 'accent' : k === 'table' || k === 'event' ? 'ok' : k === 'voucher' ? 'warn' : 'neutral');
/** „Erika Beispiel“ oder „Beispiel, Erika“ → Vor- und Nachname */
function splitName(name: string, addr: string) {
  const n = name.replace(/["']/g, '').trim();
  if (!n) return { firstName: '', lastName: addr.split('@')[0] ?? '' };
  if (n.includes(',')) { const [l, f] = n.split(',').map((x) => x.trim()); return { firstName: f ?? '', lastName: l ?? '' }; }
  const parts = n.split(/\s+/);
  return parts.length === 1 ? { firstName: '', lastName: parts[0]! } : { firstName: parts.slice(0, -1).join(' '), lastName: parts.at(-1)! };
}

/** E-Mail-Posteingang: Anfragen aus dem Geschäftspostfach sichten und als Zimmer- oder Tischreservierung übernehmen. */
export function Inbox() {
  const toast = useToast();
  const { rev, bump } = useData();
  const { current, bar } = useTabs(INBOX_TABS);
  const [busy, setBusy] = useState(false);
  const state = useLoad(() => api<InboxState>('GET', '/inbox/state'), [rev]);
  const fetchNow = async () => {
    setBusy(true);
    try { const r = await api<{ added: number }>('POST', '/inbox/fetch', {}); toast(r.added ? `${r.added} neue ${r.added === 1 ? 'Nachricht' : 'Nachrichten'}` : 'Keine neuen Nachrichten'); bump(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); bump(); }
    setBusy(false);
  };
  const st = state.data;
  return (
    <>
      <PageHeader title={current === 'vorgaenge' ? 'Vorgänge' : current === 'vorlagen' ? 'Antwortvorlagen' : 'Posteingang'} sub={st ? `${st.newCount} offen${st.lastFetchAt ? ` · zuletzt abgerufen ${fmtDateTime(st.lastFetchAt)}` : ''}${st.autoMinutes ? ` · automatisch alle ${st.autoMinutes} Min.` : ''}` : undefined}
        actions={<Button variant="primary" busy={busy} disabled={!st?.ready} onClick={() => void fetchNow()}>Jetzt abrufen</Button>} />
      {st && !st.ready && <p className="notice">Der E-Mail-Empfang ist noch nicht eingerichtet. Das geht unter Verwaltung → Einstellungen → E-Mail (nur Administrator).</p>}
      {st?.lastError && <p className="notice danger">Letzter Abruf fehlgeschlagen: {st.lastError}</p>}
      <div className={current === 'vorgaenge' || current === 'vorlagen' ? 'mc-tabs-hidden' : 'mc-tabs'}>{bar}</div>
      {current === 'vorgaenge' && !!st?.newWithoutCase && <p className="notice small">{st.newWithoutCase} neue {st.newWithoutCase === 1 ? 'E-Mail gehört' : 'E-Mails gehören'} noch zu keinem Vorgang – <a href="/email?ansicht=new">im Posteingang ansehen</a>.</p>}
      {current === 'vorgaenge' ? <CasesView /> : current === 'vorlagen' ? <><SnippetsAdmin /><NextTextsAdmin /></> : <MailsView key={current} status={current} />}
      <p className="muted small">Die Einordnung (Zimmer, Tisch, Feier, Tagung, Gutschein, allgemeine Frage, Sonstiges) und die erkannten Angaben sind Vorschläge des Programms nach festen Mustern – bitte vor dem Übernehmen mit dem Text vergleichen. Im Postfach selbst wird nichts verändert.</p>
    </>
  );
}

/** Einzelne Nachrichten nach Status (Neu, Erledigt, Ignoriert, Alle) */
function MailsView({ status }: { status: Exclude<(typeof INBOX_TABS)[number][0], 'vorgaenge' | 'vorlagen'> }) {
  const { rev } = useData();
  const current = status;
  const [kind, setKind] = useState<MailKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useLoad(() => api<InboxMailDto[]>('GET', `/inbox?status=${current}&kind=${kind}&q=${encodeURIComponent(q)}`), [current, kind, q, rev]);
  const counts = useLoad(() => api<InboxCounts>('GET', `/inbox/counts?status=${current}&q=${encodeURIComponent(q)}`), [current, q, rev]);
  return (
    <>
      <div className="kindfilter" role="group" aria-label="Nach Art filtern">
        {(['all', ...MAIL_KINDS] as const).map((k) => {
          const n = counts.data?.[k] ?? 0;
          if (k !== 'all' && k !== kind && n === 0) return null;
          return <button key={k} type="button" className={`kindchip k-${k}${kind === k ? ' on' : ''}`} aria-pressed={kind === k} title={k === 'all' ? 'Alle Arten' : MAIL_KIND_LABEL[k]}
            onClick={() => setKind(k)}>{k === 'all' ? 'Alle' : MAIL_KIND_SHORT[k]}<span className="n">{n}</span></button>;
        })}
      </div>
      {current === 'ignored' && <BlockedSenders />}
      <div className="inboxfilter">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen in Absender, Betreff, Text" aria-label="Suchen" />
      </div>
      <div className="inbox">
        <div className="inboxlist">
          <LoadState error={list.error} loading={!list.data} />
          {list.data?.length === 0 && <p className="card muted">Keine Nachrichten in dieser Ansicht.</p>}
          {list.data?.map((m) => (
            <button key={m.id} type="button" className={`card inboxitem${m.id === openId ? ' on' : ''}`} onClick={() => setOpenId(m.id)}>
              <span className="top"><b>{m.contactName || (m.viaForm ? m.contactAddr : '') || m.fromName || m.fromAddr}</b><small>{fmtDateTime(m.receivedAt)}</small></span>
              <span className="subject">{m.subject || '(ohne Betreff)'} <Badge tone={tone(m.kind)}>{MAIL_KIND_SHORT[m.kind]}</Badge>{m.status === 'done' && <> <Badge tone="ok">erledigt</Badge></>}{m.repliedAt && <> <Badge>beantwortet</Badge></>}</span>
              <small className="muted">{m.snippet}</small>
            </button>
          ))}
        </div>
        <div className="inboxdetail">{openId ? <MailDetail key={openId} id={openId} sorting onGone={() => setOpenId(null)} /> : <p className="card muted">Links eine Nachricht wählen.</p>}</div>
      </div>
    </>
  );
}

/** Ausgefilterte Absender (Reiter „Ignoriert“): Übersicht mit „aufheben“ */
function BlockedSenders() {
  const { rev, bump } = useData();
  const toast = useToast();
  const { data, reload } = useLoad(() => api<string[]>('GET', '/inbox/blocked-senders'), [rev]);
  if (!data?.length) return null;
  const off = async (entry: string) => {
    if (!window.confirm(`Filter für ${entry} aufheben? Dessen ausgefilterte E-Mails erscheinen wieder unter „Neu“.`)) return;
    try { await api('POST', '/inbox/blocked-senders/remove', { entry }); toast(`Filter für ${entry} aufgehoben`); bump(); reload(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  return (
    <details className="blk-list"><summary>Ausgefilterte Absender ({data.length})</summary>
      <p className="muted small">E-Mails dieser Absender landen beim Abruf gleich hier unter „Ignoriert“. Ein Eintrag ohne @ gilt für alle Adressen dieser Domain.</p>
      <div className="blk-chips">{data.map((e) => <span key={e} className="chip">{e} <button type="button" className="linkbtn" aria-label={`Filter für ${e} aufheben`} onClick={() => void off(e)}>aufheben</button></span>)}</div>
    </details>
  );
}

/** Anhang: gespeicherte Dateien als Download-Link, sonst nur der Name */
const AttachmentChip = ({ a }: { a: { name: string; size: number; id?: string } }) => {
  const label = <>📎 {a.name}{a.size ? ` (${Math.max(1, Math.round(a.size / 1024))} KB)` : ''}</>;
  return a.id ? <a className="msg-attlink" href={`/api/v1/inbox/attachments/${a.id}`} download={a.name}>{label}</a> : <span>{label}</span>;
};
/** Was es ist – steht in Liste und Kopf vorn, der Name daneben */
const WHAT: Record<MailKind | 'offer' | 'estimate', string> = { hotel: 'Zimmeranfrage', table: 'Tischanfrage', event: 'Feier / Veranstaltung', meeting: 'Tagung', voucher: 'Gutschein', order: 'Bestellung', question: 'Frage', other: 'Nachricht', offer: 'Angebot', estimate: 'Kostenvoranschlag' };
/** Bildzeichen je Art – in Liste, Kopf und beim Einsortieren */
const KIND_ICON: Record<MailKind | 'offer' | 'estimate', string> = { hotel: '🛏️', table: '🍽️', event: '🎉', meeting: '👥', voucher: '🎁', order: '📦', question: '❓', other: '✉️', offer: '📄', estimate: '🧾' };
/** Weg eines Vorgangs als Schritte (wie bei „Neue Reservierung“): was ist geschafft, was steht an */
function caseSteps(c: CaseDto): { label: string; state: 'done' | 'now' | 'todo' }[] {
  const closed = c.status === 'done' || c.status === 'archived';
  const answered = c.messages.some((m) => m.dir === 'out');
  const booking = c.kind === 'hotel' || c.kind === 'table' || !!c.latestLinkKind || !!c.bookingId;
  const marks = c.kind === 'order'
    ? [['Bestellung', true], ['Auftrag bestätigt', !!c.orderConfirmedAt], ['Ware da – gemeldet', !!c.orderReadyAt], ['Erledigt', closed]] as const
    : booking
    ? [['Anfrage', true], [c.kind === 'table' || c.latestLinkKind === 'table' ? 'Tisch reserviert' : 'Zimmer reserviert', !!c.latestLinkKind || !!c.bookingId], ['Bestätigung gesendet', !!c.confirmedAt || (!!c.bookingId && answered)], ['Erledigt', closed]] as const
    : [['Anfrage', true], ['Beantwortet', answered], ['Erledigt', closed]] as const;
  const firstOpen = marks.findIndex(([, ok]) => !ok);
  return marks.map(([label, ok], i) => ({ label, state: closed || ok ? 'done' : i === firstOpen ? 'now' : 'todo' }));
}
/** Stand als farbiges Abzeichen: grün = bestätigt/erledigt, blau = angelegt, gelb = wir sind dran, grau = wartet auf Kunde */
function stageOf(c: { status: string; turn: string | null; linked: boolean; confirmed: boolean }): { label: string; tone: 'ok' | 'accent' | 'warn' | 'neutral' } {
  if (c.status === 'done') return { label: 'Erledigt', tone: 'ok' };
  if (c.status === 'archived') return { label: 'Archiviert', tone: 'neutral' };
  if (c.status === 'working' && c.turn === 'ours') return { label: 'In Bearbeitung', tone: 'accent' };
  if (c.turn === 'ours') return { label: c.confirmed ? 'Neue Nachricht nach Bestätigung' : c.linked ? 'Angelegt – Bestätigung fehlt' : 'Offen – wir sind dran', tone: c.linked && !c.confirmed ? 'accent' : 'warn' };
  if (c.confirmed) return { label: 'Bestätigt', tone: 'ok' };
  if (c.linked) return { label: 'Angelegt – Bestätigung fehlt', tone: 'accent' };
  return { label: 'Wartet auf Kunde', tone: 'neutral' };
}
const initials = (name: string) => (name.replace(/<.*>/, '').trim().split(/[\s,.@]+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join('') || '?');
const shortTime = (iso: string) => { const d = new Date(iso), now = new Date(); return d.toDateString() === now.toDateString() ? d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }); };
const daysSince = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

/** Vorgänge wie in einem Messenger: links die Unterhaltungen, rechts der geöffnete Vorgang */
function CasesView() {
  const { rev, openInvoice } = useData();
  const go = useNavigate();
  const [status, setStatus] = useState<'open' | 'done' | 'archived' | 'all'>('open');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [params] = useSearchParams();
  const [openId, setOpenId] = useState<string | null>(params.get('vorgang'));
  const wanted = params.get('vorgang');
  useEffect(() => { if (wanted) setOpenId(wanted); }, [wanted]);
  const [filters, setFilters] = useState(false);
  const list = useLoad(() => api<CaseListRow[]>('GET', `/mail-cases?status=${status}&kind=${kind}&q=${encodeURIComponent(q)}${from ? `&from=${from}` : ''}`), [status, kind, q, from, rev]);
  const open = (r: CaseListRow) => { if (r.source === 'case') setOpenId(r.id); else if (r.source === 'offer') go(`/angebote?angebot=${r.id}`); else openInvoice(r.id); };
  const ours = (list.data ?? []).filter((r) => r.status === 'open' && r.turn === 'ours').length;
  return (
    <div className={`msg${openId ? ' has-open' : ''}`}>
      <aside className="msg-side">
        <div className="msg-filter">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen: Name, Nummer, Betreff" aria-label="Vorgänge suchen" />
          <div className="msg-chips">
            {([['open', 'Offen'], ['done', 'Erledigt'], ['all', 'Alle']] as const).map(([k, l]) => <button key={k} type="button" className={`kindchip${status === k ? ' on' : ''}`} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}{k === 'open' && ours > 0 && <span className="n">{ours}</span>}</button>)}
            <button type="button" className={`linkbtn msg-filtertoggle${filters || kind !== 'all' || from || status === 'archived' ? ' on' : ''}`} aria-expanded={filters} onClick={() => setFilters(!filters)}>{filters ? 'Filter ausblenden' : kind !== 'all' || from || status === 'archived' ? 'Filter aktiv' : 'Filter'}</button>
          </div>
          {filters && <div className="msg-chips msg-extra">
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kategorie">
              <option value="all">Alle Arten</option>
              {MAIL_KINDS.map((k) => <option key={k} value={k}>{MAIL_KIND_LABEL[k]}</option>)}
              <option value="offer">Angebot</option><option value="estimate">Kostenvoranschlag</option>
            </select>
            <label className="msg-from" title="Nur Vorgänge mit Aktivität seit diesem Tag">seit <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Aktivität seit" /></label>
            <button type="button" className={`kindchip${status === 'archived' ? ' on' : ''}`} aria-pressed={status === 'archived'} onClick={() => setStatus(status === 'archived' ? 'open' : 'archived')}>Archiv</button>
            {(kind !== 'all' || from || status === 'archived') && <button type="button" className="linkbtn" onClick={() => { setKind('all'); setFrom(''); if (status === 'archived') setStatus('open'); }}>zurücksetzen</button>}
          </div>}
        </div>
        <div className="msg-list">
          <LoadState error={list.error} loading={!list.data} />
          {list.data?.length === 0 && <p className="muted small msg-empty">Keine Vorgänge in dieser Ansicht. Ein Vorgang entsteht, wenn Sie eine E-Mail im Posteingang einsortieren („In Vorgänge verschieben“).</p>}
          {list.data?.map((r) => {
            const waiting = (r.status === 'open' || r.status === 'working') && r.turn === 'ours';
            return (
              <button key={`${r.source}-${r.id}`} type="button" className={`msg-item mk-${r.kind}${r.source === 'case' && r.id === openId ? ' on' : ''}${waiting ? ' ours' : ''}${r.status === 'done' ? ' done' : ''}`} onClick={() => open(r)}>
                <span className={`msg-avatar k-${r.kind}`} aria-hidden>{KIND_ICON[r.kind]}</span>
                <span className="msg-main">
                  <span className="msg-top"><b>{WHAT[r.kind]}</b><small>{shortTime(r.lastAt)}</small></span>
                  <span className="msg-sub">{r.contact || r.title} · {r.number}{r.source !== 'case' && ' ›'}</span>
                  <span className="msg-snip">{r.turn === 'theirs' && 'Sie: '}{r.snippet || r.title}</span>
                </span>
                {r.unread > 0 ? <span className="msg-unread" title={`${r.unread} neue ${r.unread === 1 ? 'Nachricht' : 'Nachrichten'}`} aria-label={`${r.unread} neu`}>{r.unread}</span> : r.source === 'case' && r.status === 'open' && r.confirmed && !waiting ? <span className="msg-dot ok" title="Bestätigt" aria-label="bestätigt" /> : waiting && <span className="msg-dot" title="Wir sind dran" aria-label="wir sind dran" />}
              </button>
            );
          })}
        </div>
      </aside>
      <section className="msg-pane">{openId ? <CaseDetail key={openId} id={openId} onBack={() => setOpenId(null)} /> : <div className="msg-none"><p className="muted">Links einen Vorgang wählen.</p></div>}</section>
    </div>
  );
}

/** Was steht als Nächstes an? – aus Stand, Kategorie und dem, was schon angelegt wurde */
function nextStep(c: CaseDto, by: NextTexts): { text: string; tone: 'warn' | 'neutral' | 'ok' } {
  if (c.status === 'done' || c.status === 'archived') return { text: c.status === 'archived' ? 'Archiviert – nichts zu tun.' : 'Erledigt – nichts zu tun.', tone: 'ok' };
  const last = c.messages[c.messages.length - 1];
  if (c.bookingId && !c.latestInboxMailId) return { text: `E-Mail zur Reservierung ${c.bookingNumber ?? ''} aus dem Hotelbereich gesendet. Antwortet der Gast, erscheint seine Nachricht hier.`, tone: 'neutral' };
  if (c.kind === 'order') {
    if (c.turn === 'ours' && c.orderConfirmedAt) return { text: 'Der Kunde hat zur Bestellung noch einmal geschrieben – bitte lesen und antworten.', tone: 'warn' };
    if (c.orderReadyAt) return { text: `„Ware ist da“ gemeldet am ${new Date(c.orderReadyAt).toLocaleDateString('de-DE')}. Nach der Abholung als erledigt markieren.`, tone: 'ok' };
    if (c.orderConfirmedAt) return { text: `Auftrag bestätigt am ${new Date(c.orderConfirmedAt).toLocaleDateString('de-DE')}. Ware beschaffen – sobald sie da ist, unten „Ware ist da“ senden.`, tone: 'neutral' };
  }
  if (c.confirmedAt && c.turn === 'theirs') return { text: `Bestätigung gesendet am ${new Date(c.confirmedAt).toLocaleDateString('de-DE')}. Bitte noch prüfen, ob in der Reservierung alles stimmt – dann als erledigt markieren.`, tone: 'ok' };
  if (c.confirmedAt && c.turn === 'ours') return { text: 'Der Kunde hat nach der Bestätigung noch einmal geschrieben – bitte lesen und antworten.', tone: 'warn' };
  if (c.turn === 'theirs') { const d = last ? daysSince(last.at) : 0; return { text: `Warten auf die Antwort des Kunden${d >= 1 ? ` – seit ${d} ${d === 1 ? 'Tag' : 'Tagen'}` : ''}.${d >= 3 ? ' Vielleicht nachfragen?' : ''}`, tone: 'neutral' }; }
  if (c.latestLinkKind === 'booking') return { text: by.bookingMade, tone: 'warn' };
  if (c.latestLinkKind === 'table') return { text: by.tableMade, tone: 'warn' };
  return { text: by[c.kind], tone: 'warn' };
}

function CaseDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { rev, bump } = useData();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api<CaseDto>('GET', `/mail-cases/${id}`), [id, rev]);
  const [reply, setReply] = useState<false | string>(false);
  const [moreSet, setMore] = useState<boolean | null>(null);
  const snippets = useLoad(() => api<ReplySnippet[]>('GET', '/reply-snippets')).data ?? [];
  const texts = useLoad(() => api<NextTexts>('GET', '/case-next-texts')).data ?? DEFAULT_NEXT_TEXTS;
  const { openBooking } = useData();
  const [opts, setOpts] = useState(false);
  if (!data) return <LoadState error={error} loading />;
  const act = async (method: 'PATCH' | 'POST', path: string, body: unknown, msg: string) => { try { await api(method, `/mail-cases/${id}${path}`, body); toast(msg); bump(); reload(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); } };
  const next = nextStep(data, texts);
  // Zimmer- und Tischanfragen: die Übernahme steht gleich offen, solange nichts angelegt ist und wir am Zug sind
  const more = moreSet ?? (data.turn === 'ours' && !data.latestLinkKind && (data.kind === 'hotel' || data.kind === 'table') && data.status !== 'done' && data.status !== 'archived');
  /** Nachricht gehört nicht hierher: lösen, in einen anderen Vorgang verschieben oder als eigenen Vorgang abtrennen */
  const relocate = async (inboxMailId: string) => {
    const a = window.prompt('Diese E-Mail gehört nicht zu diesem Vorgang?\n\n• Vorgangsnummer eintippen (z. B. V-2026-0007) = dorthin verschieben\n• „neu“ = eigener, neuer Vorgang\n• leer lassen = nur aus diesem Vorgang lösen (bleibt im Posteingang)', '');
    if (a === null) return;
    const t = a.trim();
    if (!t) return act('POST', '/remove', { inboxMailId }, 'Zuordnung gelöst');
    if (t.toLowerCase() === 'neu') return act('POST', '/split', { inboxMailId }, 'Als eigener Vorgang abgetrennt');
    return act('POST', '/move', { inboxMailId, number: t }, `Nach ${t.toUpperCase()} verschoben`);
  };
  const merge = async () => {
    const t = window.prompt(`Diesen Vorgang (${data.number}) mit einem anderen zusammenführen?\n\nAlle Nachrichten wandern in den anderen Vorgang; ${data.number} bleibt leer im Archiv.\n\nNummer des Zielvorgangs:`, '');
    if (!t?.trim()) return;
    try { await api('POST', `/mail-cases/${id}/merge`, { number: t.trim() }); toast(`Mit ${t.trim().toUpperCase()} zusammengeführt`); bump(); onBack(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  // Bestellung: erst die Auftragsbestätigung, dann die Nachricht „Ware ist da“
  const orderNext = data.kind !== 'order' || data.status === 'done' || data.status === 'archived' ? null : !data.orderConfirmedAt ? 'confirm' : !data.orderReadyAt ? 'ready' : null;
  const stage = data.kind === 'order' && data.status !== 'done' && data.status !== 'archived' && data.turn !== 'ours' && data.orderConfirmedAt
    ? (data.orderReadyAt ? { label: 'Ware da – wartet auf Abholung', tone: 'ok' as const } : { label: 'Bestätigt – Ware wird beschafft', tone: 'accent' as const })
    : stageOf({ status: data.status, turn: data.turn, linked: !!data.latestLinkKind, confirmed: !!data.confirmedAt });
  const fit = snippets.filter((x) => x.active && (x.kind === data.kind || x.kind === 'all'));
  const ins = data.messages.filter((x) => x.dir === 'in').length;
  return (
    <>
      <header className="msg-head">
        <button type="button" className="iconbtn msg-back" onClick={onBack} aria-label="Zurück zur Liste">‹</button>
        <span className={`msg-avatar k-${data.kind}`} aria-hidden>{KIND_ICON[data.kind]}</span>
        <div className="msg-who">
          <b>{WHAT[data.kind]} <Badge tone={stage.tone}>{stage.label}</Badge></b>
          <small>{data.contactName ? `${data.contactName} · ` : ''}{data.contactAddr} · {data.number}</small>
        </div>
        {data.status !== 'done' && data.status !== 'archived' && <Button variant="primary" onClick={() => void act('PATCH', '', { status: 'done' }, 'Vorgang erledigt')}>Erledigt</Button>}
        <button type="button" className="iconbtn" aria-label="Weitere Einstellungen zum Vorgang" aria-expanded={opts} title="Art, Stand, Zusammenführen" onClick={() => setOpts(!opts)}>⋯</button>
      </header>
      {opts && <div className="msg-opts">
        <label>Art <select value={data.kind} onChange={(e) => void act('PATCH', '', { kind: e.target.value }, 'Kategorie geändert')} aria-label="Kategorie des Vorgangs">{MAIL_KINDS.map((k) => <option key={k} value={k}>{MAIL_KIND_LABEL[k]}</option>)}</select></label>
        <label>Stand <select value={data.status} onChange={(e) => void act('PATCH', '', { status: e.target.value }, `Stand: ${CASE_STATUS_LABEL[e.target.value as CaseStatus]}`)} aria-label="Stand des Vorgangs">{CASE_STATUSES.map((k) => <option key={k} value={k}>{CASE_STATUS_LABEL[k]}</option>)}</select></label>
        <button type="button" className="linkbtn" onClick={() => void merge()}>Mit anderem Vorgang zusammenführen …</button>
      </div>}
      <ol className="cs-steps" aria-label="Stand des Vorgangs">{caseSteps(data).map((st, i) => (
        <li key={st.label} className={st.state} aria-current={st.state === 'now' ? 'step' : undefined}><span className="cs-num">{st.state === 'done' ? '✓' : i + 1}</span><span className="cs-label">{st.label}</span></li>
      ))}</ol>
      <div className={`msg-next t-${next.tone}`}><span><b>Als Nächstes:</b> {next.text}</span>
        {data.bookingId && <button type="button" className="linkbtn" onClick={() => openBooking(data.bookingId!)}>Reservierung {data.bookingNumber} öffnen</button>}
      </div>
      {data.candidates.length > 0 && <div className="ot-cand msg-cand">
        <span className="muted small">Im Posteingang von dieser Adresse, noch keinem Vorgang zugeordnet:</span>
        {data.candidates.map((c) => <div key={c.inboxMailId}><span>{fmtDateTime(c.at)} · {c.subject || '(ohne Betreff)'}</span><Button onClick={() => void act('POST', '/assign', { inboxMailId: c.inboxMailId }, 'E-Mail zugeordnet')}>Zuordnen</Button></div>)}
      </div>}
      <ol className="msg-chat">{data.messages.map((m) => (
        <li key={m.id} className={m.dir === 'out' ? 'me' : 'them'}>
          <div className="msg-bubble">
            {m.text.length > 500 ? <details><summary>{m.text.slice(0, 380).trim()} … <u>ganz lesen</u></summary><div className="ot-text">{m.text}</div></details> : <div className="ot-text">{m.text || <span className="muted">(kein Text)</span>}</div>}
            <small>{m.dir === 'out' ? m.who.split(' → ')[0] : 'Kunde'} · {fmtDateTime(m.at)}{m.inboxMailId && <> · <button type="button" className="linkbtn" onClick={() => void relocate(m.inboxMailId!)}>gehört nicht hierher</button></>}</small>
            {m.attachments.length > 0 && <div className="msg-att" title="Anklicken lädt den Anhang herunter">{m.attachments.map((a, i) => <AttachmentChip key={i} a={a} />)}{m.attachments.some((a) => !a.id) && <small className="muted">ohne Link: bitte im E-Mail-Programm öffnen</small>}</div>}
          </div>
        </li>
      ))}</ol>
      {data.latestInboxMailId && (
        <footer className="msg-foot">
          {fit.length > 0 && <div className="msg-sugg"><span className="muted small">Antwortvorschläge:</span>{fit.map((x) => <button key={x.id} type="button" className="chip" onClick={() => setReply(`reply&vorlage=${encodeURIComponent(x.id)}`)}>{x.title}</button>)}</div>}
          {data.latestLinkKind && !data.confirmedAt && <Button variant="primary" onClick={() => setReply('confirm')}>Bestätigung senden</Button>}
          {orderNext === 'confirm' && <Button variant="primary" onClick={() => setReply('order_confirm')}>Auftragsbestätigung senden</Button>}
          {orderNext === 'ready' && <Button variant="primary" onClick={() => setReply('order_ready')}>Ware ist da – Kunden benachrichtigen</Button>}
          <Button variant={(data.latestLinkKind && !data.confirmedAt) || orderNext ? undefined : 'primary'} onClick={() => setReply('reply')}>Frei antworten</Button>
          <Button onClick={() => setMore(!more)}>{more ? 'Übernehmen / absagen ausblenden' : 'Übernehmen / absagen …'}</Button>
        </footer>
      )}
      {!data.latestInboxMailId && data.bookingId && <footer className="msg-foot"><span className="muted small">Weitere E-Mails an den Gast senden Sie aus der Reservierung – sie erscheinen dann hier. Antwortet der Gast, können Sie auch von hier aus antworten.</span></footer>}
      {reply && data.latestInboxMailId && <MailDialog path={`/inbox/${reply === 'confirm' && data.linkedInboxMailId ? data.linkedInboxMailId : data.latestInboxMailId}/mail?template=${reply}`} title={`${reply === 'confirm' ? 'Bestätigung senden' : reply === 'order_confirm' ? 'Auftragsbestätigung senden' : reply === 'order_ready' ? 'Ware ist da – Kunden benachrichtigen' : 'Antworten'} – ${data.number}`} onClose={() => setReply(false)} onSent={() => { bump(); reload(); }}
        intro={<p className="muted small">{reply === 'order_confirm' && 'Bitte Artikel, Menge, Preis und Termin im Text eintragen – das Programm kennt die Bestellung nicht. '}{reply === 'order_ready' && 'Bitte eintragen, wann abgeholt werden kann. '}Die Vorgangsnummer {data.number} wird beim Senden automatisch in den Betreff gesetzt.</p>} />}
      {more && data.latestInboxMailId && <div className="msg-more"><MailDetail key={data.latestInboxMailId} id={data.latestInboxMailId} inCase onGone={() => { bump(); reload(); }} /></div>}
    </>
  );
}

/** Antwortvorlagen (Administrator): eigene Textbausteine je Kategorie – erscheinen im Vorgang als Antwortvorschläge */
function SnippetsAdmin() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api<ReplySnippet[]>('GET', '/reply-snippets'));
  const [items, setItems] = useState<ReplySnippet[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setItems(data); }, [data]);
  if (user.role !== 'admin') return <p className="notice">Antwortvorlagen pflegt der Administrator.</p>;
  if (!items) return <LoadState error={error} loading />;
  const set = (i: number, p: Partial<ReplySnippet>) => setItems(items.map((x, k) => (k === i ? { ...x, ...p } : x)));
  const save = async () => {
    const p = replySnippetsInput.safeParse({ items });
    if (!p.success) { toast(p.error.issues[0]?.message ?? 'Bitte Eingaben prüfen', 'error'); return; }
    setBusy(true);
    try { await api('PUT', '/reply-snippets', p.data); toast('Antwortvorlagen gespeichert'); reload(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  return (
    <section className="card">
      <p className="muted small">Diese Texte schlägt das Programm im Vorgang als Antwort vor – passend zur Kategorie. <code>{'{anrede}'}</code> wird zu „Guten Tag Frau/Herr …,“ und <code>{'{haus}'}</code> zum Namen Ihres Hauses. Die Grußformel mit Ihrer Anschrift hängt das Programm automatisch an. Vor dem Senden lässt sich jeder Text noch ändern.</p>
      <div className="sn-list">{items.map((x, i) => (
        <div key={x.id} className={`sn-item${x.active ? '' : ' off'}`}>
          <div className="sn-head">
            <select value={x.kind} onChange={(e) => set(i, { kind: e.target.value as ReplySnippet['kind'] })} aria-label={`Vorlage ${i + 1} Kategorie`}>
              <option value="all">Alle Kategorien</option>{MAIL_KINDS.map((k) => <option key={k} value={k}>{MAIL_KIND_LABEL[k]}</option>)}
            </select>
            <input value={x.title} placeholder="Name des Vorschlags" onChange={(e) => set(i, { title: e.target.value })} aria-label={`Vorlage ${i + 1} Name`} />
            <label className="check"><input type="checkbox" checked={x.active} onChange={(e) => set(i, { active: e.target.checked })} /><span>anbieten</span></label>
            <button type="button" className="iconbtn" aria-label="Vorlage entfernen" onClick={() => { if (window.confirm(`Vorlage „${x.title}“ entfernen?`)) setItems(items.filter((_, k) => k !== i)); }}>✕</button>
          </div>
          <textarea rows={5} value={x.text} onChange={(e) => set(i, { text: e.target.value })} aria-label={`Vorlage ${i + 1} Text`} />
        </div>
      ))}</div>
      <div className="formactions">
        <Button onClick={() => setItems([...items, { id: `eigen-${Date.now().toString(36)}`, kind: 'all', title: '', text: '{anrede}\n\n', active: true }])}>+ Vorlage</Button>
        <Button variant="primary" busy={busy} onClick={() => void save()}>Speichern</Button>
      </div>
    </section>
  );
}

/** Hinweis „Als Nächstes“ im Vorgang (Administrator): je Kategorie ein eigener Text */
function NextTextsAdmin() {
  const { user } = useAuth();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api<NextTexts>('GET', '/case-next-texts'));
  const [v, setV] = useState<NextTexts | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setV(data); }, [data]);
  if (user.role !== 'admin') return null;
  if (!v) return <LoadState error={error} loading />;
  const save = async () => {
    const p = nextTextsInput.safeParse(v);
    if (!p.success) { toast(p.error.issues[0]?.message ?? 'Bitte Eingaben prüfen', 'error'); return; }
    setBusy(true);
    try { await api('PUT', '/case-next-texts', p.data); toast('Hinweise gespeichert'); reload(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  return (
    <section className="card">
      <h2>Hinweis „Als Nächstes“</h2>
      <p className="muted small">Dieser Satz steht im Vorgang oben, solange Sie am Zug sind – je nach Kategorie. So können Sie Ihren Mitarbeitern den Ablauf in Ihrem Haus vorgeben. Die übrigen Hinweise (z. B. „Warten auf die Antwort des Kunden“) ergeben sich aus dem Stand und sind fest.</p>
      <div className="nx-list">{(Object.keys(NEXT_TEXT_LABEL) as (keyof NextTexts)[]).map((k) => (
        <label key={k} className="nx-row"><span>{NEXT_TEXT_LABEL[k]}</span>
          <textarea rows={2} maxLength={300} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></label>
      ))}</div>
      <div className="formactions">
        <Button onClick={() => { if (window.confirm('Alle Hinweise auf die mitgelieferten Texte zurücksetzen? (Gilt erst nach „Speichern“.)')) setV(DEFAULT_NEXT_TEXTS); }}>Vorgabe wiederherstellen</Button>
        <Button variant="primary" busy={busy} onClick={() => void save()}>Speichern</Button>
      </div>
    </section>
  );
}

/** sorting = Ansicht im Posteingang: Nachrichten ohne Vorgang werden hier nur einsortiert (Kategorie wählen → Vorgang); bearbeitet wird im Vorgang */
function MailDetail({ id, onGone, sorting = false, inCase = false }: { id: string; onGone: () => void; sorting?: boolean; inCase?: boolean }) {
  const go = useNavigate();
  const [pick, setPick] = useState<MailKind | null>(null);
  const [moving, setMoving] = useState(false);
  const { user } = useAuth();
  const toast = useToast();
  const { bump, newBooking, openBooking, openInvoice } = useData();
  const { data, error, reload } = useLoad(() => api<InboxMailDto>('GET', `/inbox/${id}`), [id]);
  const [h, setH] = useState({ from: '', to: '' });
  const [t, setT] = useState({ date: '', time: '', persons: '', name: '', phone: '', note: '' });
  const [mail, setMail] = useState<'reply' | 'confirm' | 'decline' | null>(null);
  useEffect(() => {
    if (!data) return;
    const x = { ...data.extract, dates: data.extract.dates ?? [] };
    setH({ from: x.from ?? x.dates[0] ?? '', to: x.to ?? '' });
    setT({ date: x.dates[0] ?? '', time: x.time ?? '', persons: x.persons ? String(x.persons + (x.children ?? 0)) : '', name: data.contactName ?? (data.fromName || data.fromAddr), phone: x.phone, note: `Per E-Mail: ${data.subject}`.slice(0, 200) });
  }, [data]);
  const patch = async (body: object, msg?: string) => {
    try { await api('PATCH', `/inbox/${id}`, body); if (msg) toast(msg); bump(); reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const f = useSubmit(tableReservationInput, async (d) => {
    const r = await api<{ id: string }>('POST', '/restaurant/reservations', d);
    await patch({ status: 'done', linkKind: 'table', linkId: r.id }, `Tisch für ${d.name} am ${deDate(d.date)} reserviert`);
  });
  if (!data) return <div className="card"><LoadState error={error} loading /></div>;
  const x = { ...data.extract, dates: data.extract.dates ?? [] };
  // der wirkliche Absender; ein unplausibler Name („MyWebsite“) wird nicht vorbelegt
  const cAddr = data.contactAddr || data.fromAddr;
  const who = data.contactName === '' ? { firstName: '', lastName: '' } : splitName(data.contactName ?? data.fromName, cAddr);
  /** Kopfzeile: wirklicher Absender; bei Kontaktformularen mit Hinweis, woher die Angaben stammen */
  const sender = <>{data.contactName || <i>Name unbekannt</i>} &lt;{cAddr}&gt; · {fmtDateTime(data.receivedAt)}{(data.viaForm || data.contactName === '') && <><br /><small>{data.viaForm ? 'Name und Adresse aus dem Text des Kontaktformulars – bitte kurz prüfen. ' : 'Der Absendername ist kein Personenname – bitte den Namen im Text suchen. '}Gesendet über: {data.fromName} &lt;{data.fromAddr}&gt;</small></>}</>;
  const hotelOk = /^\d{4}-\d\d-\d\d$/.test(h.from) && /^\d{4}-\d\d-\d\d$/.test(h.to) && h.from < h.to;
  const book = () => newBooking({
    from: h.from, to: h.to, source: 'E-Mail', draft: { ...who, email: cAddr, phone: x.phone },
    notes: `E-Mail-Anfrage vom ${fmtDateTime(data.receivedAt)}: ${data.subject}${x.persons ? ` · ${x.persons} Erw.${x.children ? ` + ${x.children} Ki.` : ''}` : ''}`.slice(0, 500),
    onCreated: (bid) => void patch({ status: 'done', linkKind: 'booking', linkId: bid }),
  });
  const remove = async () => {
    if (!window.confirm('Diese Nachricht aus dem Programm entfernen? Im Postfach bleibt sie erhalten.')) return;
    try { await api('DELETE', `/inbox/${id}`); toast('Entfernt'); bump(); onGone(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const status = (s: InboxStatus, msg: string) => void patch({ status: s }, msg);
  const toCase = async () => {
    if (!pick) return;
    setMoving(true);
    try { const c = await api<{ id: string; number: string }>('POST', `/inbox/${id}/case`, { kind: pick }); toast(`Vorgang ${c.number} angelegt`); bump(); go(`/email?ansicht=vorgaenge&vorgang=${c.id}`); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); setMoving(false); }
  };
  const domain = data.fromAddr.includes('@') ? data.fromAddr.slice(data.fromAddr.lastIndexOf('@') + 1).toLowerCase() : '';
  const block = async (scope: 'address' | 'domain') => {
    const what = scope === 'domain' ? `alle Adressen von ${domain}` : data.fromAddr.toLowerCase();
    if (!window.confirm(`E-Mails von ${what} künftig ausfiltern?\n\nSie erscheinen dann nicht mehr unter „Neu“, sondern gleich unter „Ignoriert“. Das lässt sich dort wieder aufheben.`)) return;
    try { const r = await api<{ entry: string; hidden: number }>('POST', `/inbox/${id}/block-sender`, { scope }); toast(`${r.entry} wird ausgefiltert${r.hidden ? ` – ${r.hidden} ${r.hidden === 1 ? 'Nachricht' : 'Nachrichten'} nach „Ignoriert“ verschoben` : ''}`); bump(); onGone(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const unblock = async (entry: string) => {
    try { const r = await api<{ restored: number }>('POST', '/inbox/blocked-senders/remove', { entry }); toast(`Filter für ${entry} aufgehoben${r.restored ? ` – ${r.restored} wieder unter „Neu“` : ''}`); bump(); reload(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  // Posteingang: Nachricht ohne Vorgang nur einsortieren – oder, wenn sie schon dazugehört, dorthin wechseln
  if (sorting && !data.offer && !data.invoice) return (
    <section className="card">
      <div className="cardhead"><div><h2>{data.subject || '(ohne Betreff)'}</h2><p className="muted">{sender}</p></div></div>
      <pre className="mailbody">{data.body || '(kein Text – die Nachricht besteht vermutlich nur aus Bildern oder Anhängen)'}</pre>
      {!!data.extract.attachments?.length && <p className="msg-att">{data.extract.attachments.map((a, i) => <AttachmentChip key={i} a={a} />)}</p>}
      {data.caseId ? <>
        <p className="notice small">Gehört zum Vorgang <b>{data.caseNumber}</b>. Antworten, Reservieren, Absagen und Erledigen geschieht dort.</p>
        <div className="formactions"><Button variant="primary" onClick={() => go(`/email?ansicht=vorgaenge&vorgang=${data.caseId}`)}>Vorgang {data.caseNumber} öffnen</Button></div>
      </> : <>
        <h3>Was ist das?</h3>
        <p className="muted small">Bitte die Art wählen – dann wandert die Nachricht als offener Vorgang in „Vorgänge“. Dort wird geantwortet, reserviert, abgesagt oder erledigt. Der Vorschlag des Programms ist markiert; bitte mit dem Text vergleichen.</p>
        <div className="sort-kinds" role="group" aria-label="Art der Nachricht">{MAIL_KINDS.map((k) => (
          <button key={k} type="button" className={`sort-tile mk-${k}${pick === k ? ' on' : ''}`} aria-pressed={pick === k} onClick={() => setPick(k)}><span className="sort-ico" aria-hidden>{KIND_ICON[k]}</span><b>{MAIL_KIND_LABEL[k]}</b>{k === data.kind && <small>Vorschlag</small>}{pick === k && <i className="rt-check" aria-hidden>✓</i>}</button>
        ))}</div>
        <div className="formactions">
          <Button variant="primary" busy={moving} disabled={!pick} onClick={() => void toCase()}>In Vorgänge verschieben</Button>
          {data.status === 'new' ? <Button onClick={() => status('ignored', 'Ignoriert')} title="Kein Vorgang nötig, z. B. Werbung">Kein Vorgang – ignorieren</Button> : <Button onClick={() => status('new', 'Wieder offen')}>Wieder öffnen</Button>}
          <Button variant="danger" onClick={() => void remove()}>Entfernen</Button>
        </div>
        {!pick && <p className="muted small">Erst die Art wählen, dann „In Vorgänge verschieben“.</p>}
        {data.blockedBy ? <p className="notice small">Dieser Absender wird ausgefiltert (<b>{data.blockedBy}</b>): seine E-Mails landen gleich unter „Ignoriert“. <button type="button" className="linkbtn" onClick={() => void unblock(data.blockedBy!)}>Filter aufheben</button></p>
          : domain && !data.viaForm && <div className="blk">
            <b>Nichts für das Programm?</b> <span className="muted small">Absender künftig ausfiltern – seine E-Mails landen dann automatisch unter „Ignoriert“ (im Postfach bleiben sie). Das ist keine Spam-Meldung.</span>
            <div className="formactions">
              <Button onClick={() => void block('address')}>Nur {data.fromAddr.toLowerCase()} ausfiltern</Button>
              <Button onClick={() => void block('domain')}>Alles von {domain} ausfiltern</Button>
            </div>
          </div>}
      </>}
    </section>
  );
  return (
    <>
      <section className={inCase ? 'card msg-incase' : 'card'}>
        {!inCase && <>
        <div className="cardhead"><div><h2>{data.subject || '(ohne Betreff)'}</h2><p className="muted">{sender}</p></div>
          <div className="actions"><select value={data.kind} onChange={(e) => void patch({ kind: e.target.value })} aria-label="Art der Nachricht">{MAIL_KINDS.map((k) => <option key={k} value={k}>{MAIL_KIND_LABEL[k]}</option>)}</select></div></div>
        <pre className="mailbody">{data.body || '(kein Text – die Nachricht besteht vermutlich nur aus Bildern oder Anhängen)'}</pre>
        {!!data.extract.attachments?.length && <p className="msg-att">{data.extract.attachments.map((a, i) => <AttachmentChip key={i} a={a} />)}{data.extract.attachments.some((a) => !a.id) && <small className="muted">ohne Link (zu groß oder älter): bitte im E-Mail-Programm öffnen</small>}</p>}
        </>}
        <div className="formactions">
          {!inCase && <>
          {data.status !== 'done' && <Button onClick={() => status('done', 'Als erledigt markiert')}>Erledigt</Button>}
          {data.status === 'new' && <Button onClick={() => status('ignored', 'Ignoriert')}>Ignorieren</Button>}
          {data.status !== 'new' && <Button onClick={() => status('new', 'Wieder offen')}>Wieder öffnen</Button>}
          <Button onClick={() => setMail('reply')}>Antworten</Button>
          {data.linkKind && <Button variant="primary" onClick={() => setMail('confirm')}>Bestätigung senden</Button>}
          </>}
          {!data.linkKind && ['hotel', 'table', 'event', 'meeting'].includes(data.kind) && <Button onClick={() => setMail('decline')}>Absage senden</Button>}
          <Button variant="danger" onClick={() => void remove()}>{inCase ? 'Letzte Nachricht entfernen' : 'Entfernen'}</Button>
        </div>
        {!inCase && data.repliedAt && <p className="muted small">Beantwortet am {fmtDateTime(data.repliedAt)}{data.repliedBy && ` von ${data.repliedBy}`}.</p>}
        {mail && <MailDialog path={`/inbox/${id}/mail?template=${mail}`} title={mail === 'confirm' ? 'Bestätigung senden' : mail === 'decline' ? 'Absage senden' : 'Antworten'} onClose={() => setMail(null)}
          onSent={() => { if (mail !== 'reply' && data.status === 'new') void patch({ status: 'done' }); else { bump(); reload(); } }} />}
        {!inCase && data.caseNumber && <p className="notice small">Gehört zum Vorgang <b>{data.caseNumber}</b> (Reiter „Vorgänge“). Antworten tragen diese Nummer im Betreff.</p>}
        {!data.caseId && !data.offer && !data.invoice && <p className="muted small">Noch kein Vorgang: Mit Ihrer ersten Antwort bekommt dieser E-Mail-Wechsel automatisch eine Vorgangsnummer. <button type="button" className="linkbtn" onClick={() => void api('POST', `/inbox/${id}/case`, {}).then(() => { toast('Vorgang angelegt'); bump(); reload(); }, (e) => toast(e instanceof Error ? e.message : 'Fehler', 'error'))}>Jetzt schon Vorgang anlegen</button></p>}
        {data.invoice && <p className="notice">Gehört zum Verlauf von <button type="button" className="linkbtn" onClick={() => openInvoice(data.invoice!.id)}>{data.invoice.label}</button>.</p>}
        {data.offer && <p className="notice">Gehört zum Verlauf von <a href={`/angebote?angebot=${data.offer.id}`}>Angebot {data.offer.number}</a>.</p>}
        {data.linkKind && <p className="notice">Daraus angelegt: {data.linkKind === 'booking'
          ? <button type="button" className="linkbtn" onClick={() => data.linkId && openBooking(data.linkId)}>Zimmerreservierung öffnen</button> : 'eine Tischreservierung (im Modul Restaurant zu finden)'}{data.handledBy && ` · bearbeitet von ${data.handledBy}`}</p>}
      </section>
      {(data.kind === 'event' || data.kind === 'meeting') && (
        <section className="card">
          <h2>{data.kind === 'event' ? 'Feier / Veranstaltung' : 'Tagung / Versammlung'} – erkannte Angaben</h2>
          <p>{x.dates.length ? `Termin: ${x.dates.slice(0, 3).map(deDate).join(', ')}` : 'Kein Termin erkannt'}{x.time ? ` · ${x.time} Uhr` : ''}{x.persons ? ` · etwa ${x.persons} ${data.kind === 'meeting' ? 'Teilnehmer' : 'Gäste'}` : ''}{x.phone ? ` · Tel. ${x.phone}` : ''}</p>
          {(hasModule(user, 'hotel') || hasModule(user, 'restaurant')) && <div className="formactions">
            <a className="btn primary" href={`/angebote?neu=1&name=${encodeURIComponent(data.contactName ?? data.fromName ?? '')}&email=${encodeURIComponent(cAddr)}&phone=${encodeURIComponent(x.phone ?? '')}&datum=${x.dates[0] ?? ''}&personen=${x.persons ?? ''}`}>Angebot erstellen</a>
          </div>}
          <p className="muted small">„Angebot erstellen“ öffnet ein neues Angebot mit Name und E-Mail-Adresse aus dieser Nachricht – Vorlage, Termin und Personenzahl dort wählen. Die erkannten Angaben sind Vorschläge – bitte mit dem Text vergleichen.</p>
        </section>
      )}
      {data.kind === 'hotel' && !data.linkKind && (
        <section className="card">
          <h2>Als Zimmerreservierung übernehmen</h2>
          {!hasModule(user, 'hotel') ? <p className="muted">Dafür braucht Ihr Benutzer das Modul „Hotel“.</p> : <>
            <p className="muted">Erkannt: {x.from ? `${deDate(x.from)}${x.to ? ` bis ${deDate(x.to)}` : ''}` : 'kein Zeitraum'}{x.persons ? ` · ${x.persons} Erw.` : ''}{x.children ? ` + ${x.children} Ki.` : ''}{x.phone ? ` · Tel. ${x.phone}` : ''}</p>
            <div className="formgrid cols3">
              <Field label="Anreise"><input type="date" value={h.from} onChange={(e) => setH({ ...h, from: e.target.value })} /></Field>
              <Field label="Abreise"><input type="date" value={h.to} onChange={(e) => setH({ ...h, to: e.target.value })} /></Field>
            </div>
            <div className="formactions"><Button variant="primary" disabled={!hotelOk} onClick={book}>Freie Zimmer ansehen und reservieren</Button></div>
            <p className="muted small">Es öffnet sich die normale Maske „Neue Reservierung“ mit Zeitraum, Name, E-Mail und Telefon aus der Nachricht. Gebucht wird erst, wenn Sie dort ein Zimmer wählen und speichern.</p>
          </>}
        </section>
      )}
      {data.kind === 'table' && !data.linkKind && (
        <form className="card" onSubmit={(e) => void f.submit({ ...t, persons: Number(t.persons), durationMin: 120, tableId: null }, e)} noValidate>
          <h2>Als Tischreservierung übernehmen</h2>
          {!hasModule(user, 'restaurant') ? <p className="muted">Dafür braucht Ihr Benutzer das Modul „Restaurant“.</p> : <>
            <div className="formgrid cols3">
              <Field label="Datum" error={f.errors.date}><input type="date" value={t.date} onChange={(e) => setT({ ...t, date: e.target.value })} /></Field>
              <Field label="Uhrzeit" error={f.errors.time}><input type="time" value={t.time} onChange={(e) => setT({ ...t, time: e.target.value })} /></Field>
              <Field label="Personen" error={f.errors.persons}><input inputMode="numeric" value={t.persons} onChange={(e) => setT({ ...t, persons: e.target.value })} /></Field>
              <Field label="Name" error={f.errors.name}><input value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} /></Field>
              <Field label="Telefon" error={f.errors.phone}><input value={t.phone} onChange={(e) => setT({ ...t, phone: e.target.value })} /></Field>
              <Field label="Notiz" error={f.errors.note}><input value={t.note} onChange={(e) => setT({ ...t, note: e.target.value })} /></Field>
            </div>
            <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Tisch reservieren</Button></div>
            <p className="muted small">Die Reservierung wird für 2 Stunden ohne festen Tisch angelegt; den Tisch weisen Sie im Modul Restaurant zu. Leere Felder hat das Programm in der Nachricht nicht gefunden.</p>
          </>}
        </form>
      )}
    </>
  );
}
