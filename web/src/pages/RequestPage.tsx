import { useState } from 'react';
import { webRequestInput, type WebRequestPublic } from '../../../src/shared/inbox.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useSubmit } from '../ui.tsx';

/** Öffentliche Seite „Zimmeranfrage“ – ohne Anmeldung, ohne Menü. Es wird nichts gebucht, nur angefragt. */
export function RequestPage() {
  const { data, error } = useLoad(() => api<WebRequestPublic>('GET', '/public/booking-request'));
  const [v, setV] = useState({ name: '', email: '', phone: '', from: '', to: '', adults: '2', children: '0', message: '', consent: false, website: '' });
  const [done, setDone] = useState(false);
  const f = useSubmit(webRequestInput, async (d) => { await api('POST', '/public/booking-request', d); setDone(true); });
  if (!data) return <div className="guestform"><LoadState error={error} loading /></div>;
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
  const input = (k: 'name' | 'email' | 'phone' | 'from' | 'to' | 'adults' | 'children', label: string, o: { type?: string; auto?: string; mode?: 'numeric' } = {}) => (
    <Field label={label} error={f.errors[k]}><input type={o.type ?? 'text'} inputMode={o.mode} autoComplete={o.auto} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
  );
  return (
    <div className="guestform">
      <header><b>{data.hotelName}</b><h1>Zimmeranfrage</h1>{data.intro && <p className="muted">{data.intro}</p>}</header>
      {!data.enabled ? <p className="notice">Online-Anfragen sind derzeit nicht möglich. Bitte rufen Sie uns an oder schreiben Sie uns eine E-Mail.</p>
        : done ? <p className="notice">Vielen Dank – Ihre Anfrage ist bei uns angekommen. Wir melden uns so bald wie möglich bei Ihnen. Die Anfrage ist noch keine Buchung.</p> : (
          <form className="card" onSubmit={(e) => void f.submit({ ...v, adults: num(v.adults), children: num(v.children) || 0 }, e)} noValidate>
            <div className="formgrid">
              {input('from', 'Anreise', { type: 'date' })}{input('to', 'Abreise', { type: 'date' })}
              {input('adults', 'Erwachsene', { mode: 'numeric' })}{input('children', 'Kinder', { mode: 'numeric' })}
              {input('name', 'Ihr Name', { auto: 'name' })}{input('email', 'E-Mail', { type: 'email', auto: 'email' })}
              {input('phone', 'Telefon (freiwillig)', { type: 'tel', auto: 'tel' })}
              <Field label="Nachricht (freiwillig)" error={f.errors.message} wide><textarea rows={3} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} /></Field>
              <input className="hp" tabIndex={-1} autoComplete="off" aria-hidden value={v.website} onChange={(e) => setV({ ...v, website: e.target.value })} />
              <label className="check wide"><input type="checkbox" checked={v.consent} onChange={(e) => setV({ ...v, consent: e.target.checked })} />
                <span>Ich habe den Hinweis zum Datenschutz gelesen.{data.privacy && <small>{data.privacy}</small>}{f.errors.consent && <span className="error" role="alert">{f.errors.consent}</span>}</span></label>
            </div>
            <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Anfrage senden</Button></div>
            <p className="muted small">Mit dem Absenden fragen Sie unverbindlich an. Eine Buchung kommt erst zustande, wenn wir sie Ihnen bestätigen.</p>
          </form>
        )}
    </div>
  );
}
