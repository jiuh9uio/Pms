import { useState } from 'react';
import { formatMoney } from '../../../src/shared/hotel.js';
import { OFFER_STATE_LABEL, type PublicOffer } from '../../../src/shared/offers.js';
import { api } from '../api.ts';
import { deDate } from '../hotel/common.tsx';
import { Button, Field, LoadState, useLoad } from '../ui.tsx';

/** Seite für den Kunden (ohne Anmeldung, über den Link in der E-Mail): Angebot und Anlagen ansehen, online annehmen. */
export function OfferPublicPage() {
  const token = window.location.pathname.split('/')[2] ?? '';
  const path = `/public/offer/${token}`;
  const { data, error, reload } = useLoad(() => api<PublicOffer>('GET', path));
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  if (!data) return <div className="guestform"><LoadState error={error} loading /></div>;
  const accept = async () => {
    setBusy(true); setFail(null);
    try { await api('POST', `${path}/accept`, { name, agree }); reload(); }
    catch (e) { setFail(e instanceof Error ? e.message : 'Das hat nicht geklappt. Bitte rufen Sie uns an.'); }
    setBusy(false);
  };
  const when = data.eventDate ? (data.eventEnd && data.eventEnd !== data.eventDate ? `${deDate(data.eventDate)} – ${deDate(data.eventEnd)}` : deDate(data.eventDate)) : '';
  return (
    <div className="guestform">
      <header><b>{data.hotelName}</b><h1>Angebot {data.number}</h1><p className="muted">{data.title}{data.title && data.customer ? ' · ' : ''}{data.customer}</p></header>
      <section className="card">
        <ul className="plain">
          {when && <li><span>Termin</span><b>{when}</b></li>}
          <li><span>Personen</span><b>{data.persons}</b></li>
          <li><span>Gesamtbetrag (inkl. USt)</span><b>{formatMoney(data.totalCents)}</b></li>
          {data.validUntil && <li><span>Gültig bis</span><b>{deDate(data.validUntil)}</b></li>}
        </ul>
        <div className="btnrow">
          <a className="btn primary" href={`/api/v1${path}/pdf`} target="_blank" rel="noopener">Angebot als PDF</a>
          {data.documents.map((d) => <a key={d.id} className="btn" href={`/api/v1${path}/doc/${d.id}`} target="_blank" rel="noopener">{d.name}</a>)}
        </div>
      </section>
      {data.state === 'accepted' ? (
        <p className="notice"><b>Vielen Dank!</b> Das Angebot wurde am {new Date(data.acceptedAt!).toLocaleString('de-DE')} von {data.acceptedBy} angenommen. Wir melden uns mit allen weiteren Einzelheiten.</p>
      ) : data.state === 'sent' ? (
        <section className="card">
          <h2>Angebot annehmen</h2>
          <p className="small">Mit Ihrer Annahme kommt der Vertrag zu den Bedingungen dieses Angebots{data.documents.length ? ' und der beigefügten Unterlagen' : ''} zustande. Gespeichert werden Ihr Name, Datum und Uhrzeit, Ihre IP-Adresse und ein Prüfwert der angenommenen Fassung.</p>
          <Field label="Ihr vollständiger Name"><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>
          <label className="check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /><span>Ich habe das Angebot{data.documents.length ? ` und ${data.documents.map((d) => d.name).join(', ')}` : ''} gelesen und nehme es verbindlich an.</span></label>
          {fail && <p className="notice danger" role="alert">{fail}</p>}
          <div className="formactions"><Button variant="primary" busy={busy} disabled={name.trim().length < 2 || !agree} onClick={() => void accept()}>Angebot verbindlich annehmen</Button></div>
          {data.questions.length > 0 && <p className="muted small">Bitte schicken Sie uns außerdem noch kurz per E-Mail: {data.questions.join(' · ')}</p>}
        </section>
      ) : <p className="notice warn">Dieses Angebot ist {OFFER_STATE_LABEL[data.state]} und kann hier nicht mehr angenommen werden.{data.hotelPhone && ` Bitte rufen Sie uns an: ${data.hotelPhone}.`}</p>}
      <p className="muted small">Fragen? {data.hotelPhone ? `Telefon ${data.hotelPhone}` : 'Antworten Sie einfach auf unsere E-Mail.'}</p>
    </div>
  );
}
