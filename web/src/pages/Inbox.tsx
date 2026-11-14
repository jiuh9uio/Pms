import { useEffect, useState } from 'react';
import { MAIL_KINDS, MAIL_KIND_LABEL, type InboxMailDto, type InboxState, type InboxStatus } from '../../../src/shared/inbox.js';
import type { MailKind } from '../../../src/shared/mailextract.js';
import { tableReservationInput } from '../../../src/shared/restaurant.js';
import { hasModule } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { deDate } from '../hotel/common.tsx';
import { MailDialog } from '../hotel/MailDialog.tsx';
import { Badge, Button, Field, LoadState, PageHeader, fmtDateTime, useLoad, useSubmit, useTabs, useToast } from '../ui.tsx';

export const INBOX_TABS = [['new', 'Neu'], ['done', 'Erledigt'], ['ignored', 'Ignoriert'], ['all', 'Alle']] as const;
const tone = (k: MailKind) => (k === 'hotel' ? 'accent' : k === 'table' ? 'ok' : 'neutral');
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
  const [kind, setKind] = useState<MailKind | 'all'>('all');
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const state = useLoad(() => api<InboxState>('GET', '/inbox/state'), [rev]);
  const list = useLoad(() => api<InboxMailDto[]>('GET', `/inbox?status=${current}&kind=${kind}&q=${encodeURIComponent(q)}`), [current, kind, q, rev]);
  const fetchNow = async () => {
    setBusy(true);
    try { const r = await api<{ added: number }>('POST', '/inbox/fetch', {}); toast(r.added ? `${r.added} neue ${r.added === 1 ? 'Nachricht' : 'Nachrichten'}` : 'Keine neuen Nachrichten'); bump(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); bump(); }
    setBusy(false);
  };
  const st = state.data;
  return (
    <>
      <PageHeader title="E-Mail" sub={st ? `${st.newCount} offen${st.lastFetchAt ? ` · zuletzt abgerufen ${fmtDateTime(st.lastFetchAt)}` : ''}${st.autoMinutes ? ` · automatisch alle ${st.autoMinutes} Min.` : ''}` : undefined}
        actions={<Button variant="primary" busy={busy} disabled={!st?.ready} onClick={() => void fetchNow()}>Jetzt abrufen</Button>} />
      {st && !st.ready && <p className="notice">Der E-Mail-Empfang ist noch nicht eingerichtet. Das geht unter Verwaltung → Einstellungen → E-Mail (nur Administrator).</p>}
      {st?.lastError && <p className="notice danger">Letzter Abruf fehlgeschlagen: {st.lastError}</p>}
      {bar}
      <div className="inboxfilter">
        <select value={kind} onChange={(e) => setKind(e.target.value as MailKind | 'all')} aria-label="Art">
          <option value="all">alle Arten</option>{MAIL_KINDS.map((k) => <option key={k} value={k}>{MAIL_KIND_LABEL[k]}</option>)}
        </select>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen in Absender, Betreff, Text" aria-label="Suchen" />
      </div>
      <div className="inbox">
        <div className="inboxlist">
          <LoadState error={list.error} loading={!list.data} />
          {list.data?.length === 0 && <p className="card muted">Keine Nachrichten in dieser Ansicht.</p>}
          {list.data?.map((m) => (
            <button key={m.id} type="button" className={`card inboxitem${m.id === openId ? ' on' : ''}`} onClick={() => setOpenId(m.id)}>
              <span className="top"><b>{m.fromName || m.fromAddr}</b><small>{fmtDateTime(m.receivedAt)}</small></span>
              <span className="subject">{m.subject || '(ohne Betreff)'} <Badge tone={tone(m.kind)}>{MAIL_KIND_LABEL[m.kind]}</Badge>{m.status === 'done' && <> <Badge tone="ok">erledigt</Badge></>}{m.repliedAt && <> <Badge>beantwortet</Badge></>}</span>
              <small className="muted">{m.snippet}</small>
            </button>
          ))}
        </div>
        <div className="inboxdetail">{openId ? <MailDetail key={openId} id={openId} onGone={() => setOpenId(null)} /> : <p className="card muted">Links eine Nachricht wählen.</p>}</div>
      </div>
      <p className="muted small">Die Einordnung (Zimmer, Tisch, Sonstiges) und die erkannten Angaben sind Vorschläge des Programms nach festen Mustern – bitte vor dem Übernehmen mit dem Text vergleichen. Im Postfach selbst wird nichts verändert.</p>
    </>
  );
}

function MailDetail({ id, onGone }: { id: string; onGone: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const { bump, newBooking, openBooking } = useData();
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
          {!data.linkKind && data.kind !== 'other' && <Button onClick={() => setMail('decline')}>Absage senden</Button>}
          <Button variant="danger" onClick={() => void remove()}>Entfernen</Button>
        </div>
        {data.repliedAt && <p className="muted small">Beantwortet am {fmtDateTime(data.repliedAt)}{data.repliedBy && ` von ${data.repliedBy}`}.</p>}
        {mail && <MailDialog path={`/inbox/${id}/mail?template=${mail}`} title={mail === 'confirm' ? 'Bestätigung senden' : mail === 'decline' ? 'Absage senden' : 'Antworten'} onClose={() => setMail(null)}
          onSent={() => { if (mail !== 'reply' && data.status === 'new') void patch({ status: 'done' }); else { bump(); reload(); } }} />}
        {data.linkKind && <p className="notice">Daraus angelegt: {data.linkKind === 'booking'
          ? <button type="button" className="linkbtn" onClick={() => data.linkId && openBooking(data.linkId)}>Zimmerreservierung öffnen</button> : 'eine Tischreservierung (im Modul Restaurant zu finden)'}{data.handledBy && ` · bearbeitet von ${data.handledBy}`}</p>}
      </section>
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
