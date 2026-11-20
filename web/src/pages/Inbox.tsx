import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MAIL_KINDS, MAIL_KIND_LABEL, MAIL_KIND_SHORT, replySnippetsInput, type CaseDto, type CaseListRow, type ReplySnippet, type InboxCounts, type InboxMailDto, type InboxState, type InboxStatus } from '../../../src/shared/inbox.js';
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
      {current === 'vorgaenge' ? <CasesView /> : current === 'vorlagen' ? <SnippetsAdmin /> : <MailsView key={current} status={current} />}
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
      <div className="inboxfilter">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen in Absender, Betreff, Text" aria-label="Suchen" />
      </div>
      <div className="inbox">
        <div className="inboxlist">
          <LoadState error={list.error} loading={!list.data} />
          {list.data?.length === 0 && <p className="card muted">Keine Nachrichten in dieser Ansicht.</p>}
          {list.data?.map((m) => (
            <button key={m.id} type="button" className={`card inboxitem${m.id === openId ? ' on' : ''}`} onClick={() => setOpenId(m.id)}>
              <span className="top"><b>{m.fromName || m.fromAddr}</b><small>{fmtDateTime(m.receivedAt)}</small></span>
              <span className="subject">{m.subject || '(ohne Betreff)'} <Badge tone={tone(m.kind)}>{MAIL_KIND_SHORT[m.kind]}</Badge>{m.status === 'done' && <> <Badge tone="ok">erledigt</Badge></>}{m.repliedAt && <> <Badge>beantwortet</Badge></>}</span>
              <small className="muted">{m.snippet}</small>
            </button>
          ))}
        </div>
        <div className="inboxdetail">{openId ? <MailDetail key={openId} id={openId} onGone={() => setOpenId(null)} /> : <p className="card muted">Links eine Nachricht wählen.</p>}</div>
      </div>
    </>
  );
}

/** Was es ist – steht in Liste und Kopf vorn, der Name daneben */
const WHAT: Record<MailKind | 'offer' | 'estimate', string> = { hotel: 'Zimmeranfrage', table: 'Tischanfrage', event: 'Feier / Veranstaltung', meeting: 'Tagung', voucher: 'Gutschein', question: 'Frage', other: 'Nachricht', offer: 'Angebot', estimate: 'Kostenvoranschlag' };
/** Stand als farbiges Abzeichen: grün = bestätigt/erledigt, blau = angelegt, gelb = wir sind dran, grau = wartet auf Kunde */
function stageOf(c: { status: string; turn: string | null; linked: boolean; confirmed: boolean }): { label: string; tone: 'ok' | 'accent' | 'warn' | 'neutral' } {
  if (c.status === 'done') return { label: 'Erledigt', tone: 'ok' };
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
  const [status, setStatus] = useState<'open' | 'done' | 'all'>('open');
  const [kind, setKind] = useState('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useLoad(() => api<CaseListRow[]>('GET', `/mail-cases?status=${status}&kind=${kind}&q=${encodeURIComponent(q)}`), [status, kind, q, rev]);
  const open = (r: CaseListRow) => { if (r.source === 'case') setOpenId(r.id); else if (r.source === 'offer') go(`/angebote?angebot=${r.id}`); else openInvoice(r.id); };
  const ours = (list.data ?? []).filter((r) => r.status === 'open' && r.turn === 'ours').length;
  return (
    <div className={`msg${openId ? ' has-open' : ''}`}>
      <aside className="msg-side">
        <div className="msg-filter">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen: Name, Nummer, Betreff" aria-label="Vorgänge suchen" />
          <div className="msg-chips">
            {([['open', 'Offen'], ['done', 'Erledigt'], ['all', 'Alle']] as const).map(([k, l]) => <button key={k} type="button" className={`kindchip${status === k ? ' on' : ''}`} aria-pressed={status === k} onClick={() => setStatus(k)}>{l}{k === 'open' && ours > 0 && <span className="n">{ours}</span>}</button>)}
            <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Kategorie">
              <option value="all">Alle Arten</option>
              {MAIL_KINDS.map((k) => <option key={k} value={k}>{MAIL_KIND_LABEL[k]}</option>)}
              <option value="offer">Angebot</option><option value="estimate">Kostenvoranschlag</option>
            </select>
          </div>
        </div>
        <div className="msg-list">
          <LoadState error={list.error} loading={!list.data} />
          {list.data?.length === 0 && <p className="muted small msg-empty">Keine Vorgänge in dieser Ansicht. Ein Vorgang entsteht, sobald Sie auf eine E-Mail antworten (Posteingang).</p>}
          {list.data?.map((r) => {
            const waiting = r.status === 'open' && r.turn === 'ours';
            return (
              <button key={`${r.source}-${r.id}`} type="button" className={`msg-item${r.source === 'case' && r.id === openId ? ' on' : ''}${waiting ? ' ours' : ''}${r.status === 'done' ? ' done' : ''}`} onClick={() => open(r)}>
                <span className={`msg-avatar k-${r.kind}`} aria-hidden>{initials(r.contact)}</span>
                <span className="msg-main">
                  <span className="msg-top"><b>{WHAT[r.kind]}</b><small>{shortTime(r.lastAt)}</small></span>
                  <span className="msg-sub">{r.contact || r.title} · {r.number}{r.source !== 'case' && ' ›'}</span>
                  <span className="msg-snip">{r.turn === 'theirs' && 'Sie: '}{r.snippet || r.title}</span>
                </span>
                {r.source === 'case' && r.status === 'open' && r.confirmed && !waiting ? <span className="msg-dot ok" title="Bestätigt" aria-label="bestätigt" /> : waiting && <span className="msg-dot" title="Wir sind dran" aria-label="wir sind dran" />}
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
function nextStep(c: CaseDto): { text: string; tone: 'warn' | 'neutral' | 'ok' } {
  if (c.status === 'done') return { text: 'Erledigt – nichts zu tun.', tone: 'ok' };
  const last = c.messages[c.messages.length - 1];
  if (c.confirmedAt && c.turn === 'theirs') return { text: `Bestätigung gesendet am ${new Date(c.confirmedAt).toLocaleDateString('de-DE')}. Bitte noch prüfen, ob in der Reservierung alles stimmt – dann als erledigt markieren.`, tone: 'ok' };
  if (c.confirmedAt && c.turn === 'ours') return { text: 'Der Kunde hat nach der Bestätigung noch einmal geschrieben – bitte lesen und antworten.', tone: 'warn' };
  if (c.turn === 'theirs') { const d = last ? daysSince(last.at) : 0; return { text: `Warten auf die Antwort des Kunden${d >= 1 ? ` – seit ${d} ${d === 1 ? 'Tag' : 'Tagen'}` : ''}.${d >= 3 ? ' Vielleicht nachfragen?' : ''}`, tone: 'neutral' }; }
  if (c.latestLinkKind === 'booking') return { text: 'Die Zimmerreservierung ist angelegt – jetzt die Bestätigung senden oder antworten.', tone: 'warn' };
  if (c.latestLinkKind === 'table') return { text: 'Die Tischreservierung ist angelegt – jetzt die Bestätigung senden oder antworten.', tone: 'warn' };
  const by: Record<MailKind, string> = {
    hotel: 'Zimmeranfrage: Verfügbarkeit prüfen, dann Reservierung anlegen oder antworten.', table: 'Tischanfrage: Tisch reservieren oder antworten.',
    event: 'Anfrage für eine Feier: antworten – oder im Bereich Angebote eine Absprache / ein Angebot anlegen.', meeting: 'Tagungsanfrage: antworten – oder im Bereich Angebote ein Angebot anlegen.',
    voucher: 'Gutschein-Anfrage: antworten – der Gutschein wird im Bereich Gutscheine ausgestellt.', question: 'Frage des Kunden beantworten.', other: 'Nachricht lesen und antworten – oder als erledigt markieren.',
  };
  return { text: by[c.kind], tone: 'warn' };
}

function CaseDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const { rev, bump } = useData();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api<CaseDto>('GET', `/mail-cases/${id}`), [id, rev]);
  const [reply, setReply] = useState<false | string>(false);
  const [more, setMore] = useState(false);
  const snippets = useLoad(() => api<ReplySnippet[]>('GET', '/reply-snippets')).data ?? [];
  if (!data) return <LoadState error={error} loading />;
  const act = async (method: 'PATCH' | 'POST', path: string, body: unknown, msg: string) => { try { await api(method, `/mail-cases/${id}${path}`, body); toast(msg); bump(); reload(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); } };
  const next = nextStep(data);
  const stage = stageOf({ status: data.status, turn: data.turn, linked: !!data.latestLinkKind, confirmed: !!data.confirmedAt });
  const fit = snippets.filter((x) => x.active && (x.kind === data.kind || x.kind === 'all'));
  const ins = data.messages.filter((x) => x.dir === 'in').length;
  return (
    <>
      <header className="msg-head">
        <button type="button" className="iconbtn msg-back" onClick={onBack} aria-label="Zurück zur Liste">‹</button>
        <span className={`msg-avatar k-${data.kind}`} aria-hidden>{initials(data.contactName || data.contactAddr)}</span>
        <div className="msg-who">
          <b>{WHAT[data.kind]} <Badge tone={stage.tone}>{stage.label}</Badge></b>
          <small>{data.contactName ? `${data.contactName} · ` : ''}{data.contactAddr} · {data.number}</small>
        </div>
        <select value={data.kind} onChange={(e) => void act('PATCH', '', { kind: e.target.value }, 'Kategorie geändert')} aria-label="Kategorie des Vorgangs">{MAIL_KINDS.map((k) => <option key={k} value={k}>{MAIL_KIND_LABEL[k]}</option>)}</select>
        {data.status === 'open' ? <Button onClick={() => void act('PATCH', '', { status: 'done' }, 'Vorgang erledigt')}>Erledigt</Button> : <Button onClick={() => void act('PATCH', '', { status: 'open' }, 'Vorgang wieder offen')}>Wieder öffnen</Button>}
      </header>
      <div className={`msg-next t-${next.tone}`}><b>Als Nächstes:</b> {next.text}</div>
      {data.candidates.length > 0 && <div className="ot-cand msg-cand">
        <span className="muted small">Im Posteingang von dieser Adresse, noch keinem Vorgang zugeordnet:</span>
        {data.candidates.map((c) => <div key={c.inboxMailId}><span>{fmtDateTime(c.at)} · {c.subject || '(ohne Betreff)'}</span><Button onClick={() => void act('POST', '/assign', { inboxMailId: c.inboxMailId }, 'E-Mail zugeordnet')}>Zuordnen</Button></div>)}
      </div>}
      <ol className="msg-chat">{data.messages.map((m) => (
        <li key={m.id} className={m.dir === 'out' ? 'me' : 'them'}>
          <div className="msg-bubble">
            {m.text.length > 500 ? <details><summary>{m.text.slice(0, 380).trim()} … <u>ganz lesen</u></summary><div className="ot-text">{m.text}</div></details> : <div className="ot-text">{m.text || <span className="muted">(kein Text)</span>}</div>}
            <small>{m.dir === 'out' ? m.who.split(' → ')[0] : 'Kunde'} · {fmtDateTime(m.at)}{m.inboxMailId && ins > 1 && <> · <button type="button" className="linkbtn" onClick={() => { if (window.confirm('Diese E-Mail gehört nicht zu diesem Vorgang? Die Zuordnung wird gelöst; die E-Mail bleibt im Posteingang.')) void act('POST', '/remove', { inboxMailId: m.inboxMailId }, 'Zuordnung gelöst'); }}>gehört nicht hierher</button></>}</small>
          </div>
        </li>
      ))}</ol>
      {data.latestInboxMailId && (
        <footer className="msg-foot">
          {fit.length > 0 && <div className="msg-sugg"><span className="muted small">Antwortvorschläge:</span>{fit.map((x) => <button key={x.id} type="button" className="chip" onClick={() => setReply(`reply&vorlage=${encodeURIComponent(x.id)}`)}>{x.title}</button>)}</div>}
          {data.latestLinkKind && !data.confirmedAt && <Button variant="primary" onClick={() => setReply('confirm')}>Bestätigung senden</Button>}
          <Button variant={data.latestLinkKind && !data.confirmedAt ? undefined : 'primary'} onClick={() => setReply('reply')}>Frei antworten</Button>
          <Button onClick={() => setMore(!more)}>{more ? 'Weniger' : 'Mehr: übernehmen, absagen …'}</Button>
        </footer>
      )}
      {reply && data.latestInboxMailId && <MailDialog path={`/inbox/${data.latestInboxMailId}/mail?template=${reply}`} title={`${reply === 'confirm' ? 'Bestätigung senden' : 'Antworten'} – ${data.number}`} onClose={() => setReply(false)} onSent={() => { bump(); reload(); }}
        intro={<p className="muted small">Die Vorgangsnummer {data.number} wird beim Senden automatisch in den Betreff gesetzt.</p>} />}
      {more && data.latestInboxMailId && <div className="msg-more"><MailDetail key={data.latestInboxMailId} id={data.latestInboxMailId} onGone={() => { bump(); reload(); }} /></div>}
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

function MailDetail({ id, onGone }: { id: string; onGone: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const { bump, newBooking, openBooking, openInvoice } = useData();
  const { data, error, reload } = useLoad(() => api<InboxMailDto>('GET', `/inbox/${id}`), [id]);
  const [h, setH] = useState({ from: '', to: '' });
  const [t, setT] = useState({ date: '', time: '', persons: '', name: '', phone: '', note: '' });
  const [mail, setMail] = useState<'reply' | 'confirm' | 'decline' | null>(null);
  useEffect(() => {
    if (!data) return;
    const x = data.extract;
    setH({ from: x.from ?? x.dates[0] ?? '', to: x.to ?? '' });
    setT({ date: x.dates[0] ?? '', time: x.time ?? '', persons: x.persons ? String(x.persons + (x.children ?? 0)) : '', name: data.fromName || data.fromAddr, phone: x.phone, note: `Per E-Mail: ${data.subject}`.slice(0, 200) });
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
  const x = data.extract;
  const who = splitName(data.fromName, data.fromAddr);
  const hotelOk = /^\d{4}-\d\d-\d\d$/.test(h.from) && /^\d{4}-\d\d-\d\d$/.test(h.to) && h.from < h.to;
  const book = () => newBooking({
    from: h.from, to: h.to, source: 'E-Mail', draft: { ...who, email: data.fromAddr, phone: x.phone },
    notes: `E-Mail-Anfrage vom ${fmtDateTime(data.receivedAt)}: ${data.subject}${x.persons ? ` · ${x.persons} Erw.${x.children ? ` + ${x.children} Ki.` : ''}` : ''}`.slice(0, 500),
    onCreated: (bid) => void patch({ status: 'done', linkKind: 'booking', linkId: bid }),
  });
  const remove = async () => {
    if (!window.confirm('Diese Nachricht aus dem Programm entfernen? Im Postfach bleibt sie erhalten.')) return;
    try { await api('DELETE', `/inbox/${id}`); toast('Entfernt'); bump(); onGone(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const status = (s: InboxStatus, msg: string) => void patch({ status: s }, msg);
  return (
    <>
      <section className="card">
        <div className="cardhead"><div><h2>{data.subject || '(ohne Betreff)'}</h2><p className="muted">{data.fromName} &lt;{data.fromAddr}&gt; · {fmtDateTime(data.receivedAt)}</p></div>
          <div className="actions"><select value={data.kind} onChange={(e) => void patch({ kind: e.target.value })} aria-label="Art der Nachricht">{MAIL_KINDS.map((k) => <option key={k} value={k}>{MAIL_KIND_LABEL[k]}</option>)}</select></div></div>
        <pre className="mailbody">{data.body || '(kein Text – die Nachricht besteht vermutlich nur aus Bildern oder Anhängen)'}</pre>
        <div className="formactions">
          {data.status !== 'done' && <Button onClick={() => status('done', 'Als erledigt markiert')}>Erledigt</Button>}
          {data.status === 'new' && <Button onClick={() => status('ignored', 'Ignoriert')}>Ignorieren</Button>}
          {data.status !== 'new' && <Button onClick={() => status('new', 'Wieder offen')}>Wieder öffnen</Button>}
          <Button onClick={() => setMail('reply')}>Antworten</Button>
          {data.linkKind && <Button variant="primary" onClick={() => setMail('confirm')}>Bestätigung senden</Button>}
          {!data.linkKind && ['hotel', 'table', 'event', 'meeting'].includes(data.kind) && <Button onClick={() => setMail('decline')}>Absage senden</Button>}
          <Button variant="danger" onClick={() => void remove()}>Entfernen</Button>
        </div>
        {data.repliedAt && <p className="muted small">Beantwortet am {fmtDateTime(data.repliedAt)}{data.repliedBy && ` von ${data.repliedBy}`}.</p>}
        {mail && <MailDialog path={`/inbox/${id}/mail?template=${mail}`} title={mail === 'confirm' ? 'Bestätigung senden' : mail === 'decline' ? 'Absage senden' : 'Antworten'} onClose={() => setMail(null)}
          onSent={() => { if (mail !== 'reply' && data.status === 'new') void patch({ status: 'done' }); else { bump(); reload(); } }} />}
        {data.caseNumber && <p className="notice small">Gehört zum Vorgang <b>{data.caseNumber}</b> (Reiter „Vorgänge“). Antworten tragen diese Nummer im Betreff.</p>}
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
            <a className="btn primary" href={`/angebote?neu=1&name=${encodeURIComponent(data.fromName || '')}&email=${encodeURIComponent(data.fromAddr)}&phone=${encodeURIComponent(x.phone ?? '')}&datum=${x.dates[0] ?? ''}&personen=${x.persons ?? ''}`}>Angebot erstellen</a>
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
