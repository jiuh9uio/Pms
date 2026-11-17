import { useEffect, useState } from 'react';
import { STATUS_LABEL, formatMoney, publicArrivalInput, publicCredInput, type PublicBooking, type PublicBookingGate, type PublicCred, type StayRequest } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { deDate } from '../hotel/common.tsx';
import { Badge, Button, Field, LoadState, useLoad, useSubmit } from '../ui.tsx';
import { GuestLogo } from '../logo.tsx';

/** Seite für den Gast (ohne Anmeldung, über seinen persönlichen Link): Reservierung ansehen, Ankunftszeit mitteilen, stornieren. */
const CRED = 'pms.buchung.';
export function BookingPage() {
  const token = window.location.pathname.split('/')[2] ?? '';
  const path = `/public/booking/${token}`;
  const gate = useLoad(() => api<PublicBookingGate>('GET', path));
  // Nachname und Postleitzahl bleiben nur für dieses Browserfenster gemerkt (damit ein Neuladen nicht erneut fragt)
  const [cred, setCred] = useState<PublicCred | null>(() => { try { return JSON.parse(sessionStorage.getItem(CRED + token) ?? 'null') as PublicCred | null; } catch { return null; } });
  const [b, setB] = useState<PublicBooking | null>(null);
  const [login, setLogin] = useState({ lastName: '', zip: '' });
  const [v, setV] = useState({ time: '', message: '' });
  const [saved, setSaved] = useState(false);
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const open = async (c: PublicCred) => {
    const r = await api<PublicBooking>('POST', `${path}/open`, c);
    try { sessionStorage.setItem(CRED + token, JSON.stringify(c)); } catch { /* ohne Speicher */ }
    setCred(c); setB(r); setV({ time: r.arrivalTime, message: r.guestMessage });
  };
  useEffect(() => { if (cred && !b) open(cred).catch(() => { setCred(null); try { sessionStorage.removeItem(CRED + token); } catch { /* egal */ } }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // falsche Angaben bleiben als Meldung stehen (nicht nur kurz eingeblendet)
  const [gateFail, setGateFail] = useState<string | null>(null);
  const enter = useSubmit(publicCredInput, async (d) => { setGateFail(null); try { await open(d); } catch (e) { setGateFail(e instanceof Error ? e.message : 'Das hat nicht geklappt.'); } });
  const f = useSubmit(publicArrivalInput, async (d) => { setB(await api<PublicBooking>('POST', `${path}/arrival`, d)); setSaved(true); });
  const cancel = async () => {
    setBusy(true); setFail(null);
    try { setB(await api<PublicBooking>('POST', `${path}/cancel`, { ...cred, confirm: true, feeCents: b?.terms.feeCents ?? 0 })); setAsk(false); }
    catch (e) { setFail(e instanceof Error ? e.message : 'Das hat nicht geklappt.'); }
    setBusy(false);
  };
  if (!gate.data) return <div className="guestform"><LoadState error={gate.error} loading /></div>;
  if (!b) return (
    <div className="guestform">
      <header><GuestLogo /><b>{gate.data.hotelName}</b><h1>Ihre Reservierung</h1><p className="muted">Bitte bestätigen Sie kurz, dass Sie es sind.</p></header>
      {cred ? <LoadState error={null} loading /> : (
        <form className="card" onSubmit={(e) => void enter.submit(login, e)} noValidate>
          <div className="formgrid">
            <Field label="Nachname" error={enter.errors.lastName} hint="wie bei der Buchung angegeben"><input value={login.lastName} onChange={(e) => setLogin({ ...login, lastName: e.target.value })} autoComplete="family-name" autoFocus /></Field>
            {gate.data.needsZip && <Field label="Postleitzahl" error={enter.errors.zip}><input value={login.zip} onChange={(e) => setLogin({ ...login, zip: e.target.value })} autoComplete="postal-code" inputMode="numeric" /></Field>}
          </div>
          {gateFail && <p className="notice danger" role="alert">{gateFail}</p>}
          <div className="formactions"><Button type="submit" variant="primary" busy={enter.busy}>Reservierung öffnen</Button></div>
          <p className="muted small">Klappt es nicht? Rufen Sie uns gern an{gate.data.hotelPhone && `: ${gate.data.hotelPhone}`}.</p>
        </form>
      )}
    </div>
  );
  const persons = (r: PublicBooking['rooms'][number]) => `${r.adults} ${r.adults === 1 ? 'Erwachsener' : 'Erwachsene'}${r.children ? `, ${r.children} ${r.children === 1 ? 'Kind' : 'Kinder'}` : ''}`;
  return (
    <div className="guestform">
      <header><GuestLogo /><b>{b.hotelName}</b><h1>Ihre Reservierung</h1>
        <p className="muted">Nr. {b.number} · {b.guestName}</p>{b.welcome && <p>{b.welcome}</p>}</header>
      {b.state === 'cancelled' && <p className="notice warn"><b>Diese Reservierung ist storniert.</b> Wenn das ein Versehen war, rufen Sie uns bitte an{b.hotelPhone && ` (${b.hotelPhone})`}.</p>}
      <section className="card">
        <h2>{deDate(b.from)} bis {deDate(b.to)}</h2>
        <ul className="plain">{b.rooms.map((r, i) => (
          <li key={i}><b>{r.category}</b> · {r.nights} {r.nights === 1 ? 'Nacht' : 'Nächte'} · {persons(r)}{b.rooms.length > 1 && <> · {deDate(r.from)}–{deDate(r.to)}</>}{r.status === 'tentative' && <> <Badge tone="warn">{STATUS_LABEL[r.status]}</Badge></>}</li>
        ))}</ul>
        {b.state !== 'cancelled' && b.totalCents != null && <p>Gesamtbetrag: <b>{formatMoney(b.totalCents)}</b> <span className="muted small">inklusive Umsatzsteuer</span></p>}
        <p className="muted small">Anreise ab {b.checkinTime} Uhr.{b.hotelPhone && ` Bei Fragen: ${b.hotelPhone}.`}</p>
      </section>
      {b.guide && (
        <section className="card">
          <h2>{b.guide.label}</h2>
          {b.guide.text && <p>{b.guide.text}</p>}
          <div className="formactions"><a className="btn primary" href={b.guide.url} target="_blank" rel="noreferrer">Öffnen</a></div>
        </section>
      )}
      {b.canArrival && (
        <form className="card" onSubmit={(e) => { setSaved(false); void f.submit({ ...cred, ...v }, e); }} noValidate>
          <h2>Wann kommen Sie an?</h2>
          <div className="formgrid">
            <Field label="Voraussichtliche Ankunftszeit" error={f.errors.time} hint="freiwillig – hilft uns bei der Planung"><input type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} /></Field>
            <Field label="Nachricht an uns" error={f.errors.message} wide hint="z. B. späte Anreise, Kinderbett, Unverträglichkeiten"><textarea rows={3} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} /></Field>
          </div>
          <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button></div>
          {saved && <p className="notice">Danke – wir haben Ihre Angaben erhalten.</p>}
        </form>
      )}
      {b.state === 'active' && (
        <section className="card">
          <h2>Stornieren</h2>
          {b.terms.enabled && <p>{b.terms.text}</p>}
          {b.canCancel ? (
            ask ? (
              <>
                <p className={`notice ${b.terms.free ? '' : 'warn'}`}>{b.terms.free
                  ? 'Die Stornierung ist jetzt kostenfrei. Möchten Sie die Reservierung wirklich stornieren?'
                  : <>Die Frist für die kostenfreie Stornierung ist abgelaufen. Bei Stornierung berechnen wir <b>{formatMoney(b.terms.feeCents)}</b> ({b.terms.feePercent} % des Zimmerpreises). Möchten Sie trotzdem stornieren?</>}</p>
                {fail && <p className="notice danger" role="alert">{fail}</p>}
                <div className="formactions"><Button variant="danger" busy={busy} onClick={() => void cancel()}>Ja, verbindlich stornieren</Button><Button onClick={() => setAsk(false)}>Nein, behalten</Button></div>
              </>
            ) : <div className="formactions"><Button variant="danger" onClick={() => setAsk(true)}>Reservierung stornieren</Button></div>
          ) : <p className="muted">{b.cancelHint}</p>}
        </section>
      )}
      {b.canRequest && cred && <StayCard path={path} cred={cred} b={b} />}
      {(b.state === 'arrived' || b.state === 'past') && <p className="notice">{b.state === 'arrived' ? 'Sie sind bereits angereist – schön, dass Sie da sind.' : 'Dieser Aufenthalt liegt in der Vergangenheit. Vielen Dank für Ihren Besuch.'}</p>}
    </div>
  );
}

const NEEDS = ['Handtücher', 'Kopfkissen', 'Decke', 'Toilettenpapier', 'Zahnbürste', 'Föhn'];
/** Während des Aufenthalts: Reinigung wünschen, keine Reinigung, etwas bringen lassen, Abreise melden. */
function StayCard({ path, cred, b }: { path: string; cred: PublicCred; b: PublicBooking }) {
  const [open, setOpen] = useState<StayRequest | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const send = async (kind: StayRequest) => {
    setBusy(true); setFail(null); setDone(null);
    try { const r = await api<{ text: string }>('POST', `${path}/request`, { ...cred, kind, message: msg }); setDone(r.text); setOpen(null); setMsg(''); }
    catch (e) { setFail(e instanceof Error ? e.message : 'Das hat nicht geklappt. Bitte rufen Sie uns an.'); }
    setBusy(false);
  };
  const choose = (k: StayRequest) => { setOpen(open === k ? null : k); setMsg(''); setFail(null); setDone(null); };
  const form: Record<StayRequest, { label: string; hint: string; placeholder: string; button: string }> = {
    cleaning: { label: 'Hinweis (freiwillig)', hint: '', placeholder: 'z. B. bitte erst ab 14 Uhr', button: 'Reinigung anfordern' },
    no_cleaning: { label: 'Hinweis (freiwillig)', hint: '', placeholder: 'z. B. nur frische Handtücher vor die Tür', button: 'Heute keine Reinigung' },
    need: { label: 'Was dürfen wir bringen?', hint: 'antippen oder selbst schreiben', placeholder: 'z. B. zwei Handtücher', button: 'Absenden' },
    checkout: { label: 'Hinweis (freiwillig)', hint: '', placeholder: 'z. B. Schlüssel liegt im Zimmer', button: 'Abreise melden' },
  };
  return (
    <section className="card staycard">
      <h2>Während Ihres Aufenthalts</h2>
      <p className="muted small">Ihre Nachricht geht direkt an unser Team.</p>
      <div className="staybtns">
        <Button variant={open === 'cleaning' ? 'primary' : 'default'} onClick={() => choose('cleaning')}>🧹 Zimmerreinigung wünschen</Button>
        <Button variant={open === 'no_cleaning' ? 'primary' : 'default'} onClick={() => choose('no_cleaning')}>🚫 Heute keine Reinigung</Button>
        <Button variant={open === 'need' ? 'primary' : 'default'} onClick={() => choose('need')}>🛎 Etwas bringen lassen</Button>
        <Button variant={open === 'checkout' ? 'primary' : 'default'} onClick={() => choose('checkout')}>👋 Abreise melden</Button>
      </div>
      {open && (
        <div className="stayform">
          {open === 'need' && <div className="chips">{NEEDS.map((n) => <button key={n} type="button" className="chip" onClick={() => setMsg(msg ? `${msg}, ${n}` : n)}>{n}</button>)}</div>}
          {open === 'checkout' && <p className="small">Abreise bis {b.checkoutTime} Uhr. Bezahlen Sie bitte vorher an der Rezeption, falls noch nicht geschehen.</p>}
          <Field label={form[open].label} hint={form[open].hint || undefined}><textarea rows={2} maxLength={300} value={msg} placeholder={form[open].placeholder} onChange={(e) => setMsg(e.target.value)} /></Field>
          <div className="formactions"><Button variant="primary" busy={busy} disabled={open === 'need' && msg.trim().length < 2} onClick={() => void send(open)}>{form[open].button}</Button></div>
        </div>
      )}
      {done && <p className="notice" role="status">{done}</p>}
      {fail && <p className="notice danger" role="alert">{fail}</p>}
      {b.hotelPhone && <p className="muted small">Eilig? Rufen Sie uns an: <a href={`tel:${b.hotelPhone.replace(/[^\d+]/g, '')}`}>{b.hotelPhone}</a></p>}
    </section>
  );
}
