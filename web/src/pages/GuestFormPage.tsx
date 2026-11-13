import { useState } from 'react';
import { guestFormInput, type GuestFormPublic } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { deDate } from '../hotel/common.tsx';
import { Button, Field, LoadState, useLoad, useSubmit } from '../ui.tsx';

/** Online-Meldeschein für den Gast (ohne Anmeldung, über den QR-Code der Reservierung). */
export function GuestFormPage() {
  const token = window.location.pathname.split('/')[2] ?? '';
  const path = `/public/guest-form/${token}`;
  const { data, error } = useLoad(() => api<GuestFormPublic>('GET', path));
  const [v, setV] = useState<Record<string, string> | null>(null);
  const [done, setDone] = useState(false);
  const f = useSubmit(guestFormInput, async (d) => { await api('POST', path, d); setDone(true); });
  if (!data) return <div className="guestform"><LoadState error={error} loading /></div>;
  const val = v ?? { firstName: data.firstName, lastName: data.lastName, birthdate: '', nationality: '', street: '', zip: '', city: '', country: '', idNumber: '', companions: '0' };
  const input = (k: string, label: string, o: { type?: string; hint?: string; auto?: string; mode?: 'numeric' } = {}) => (
    <Field label={label} error={f.errors[k]} hint={o.hint}>
      <input type={o.type ?? 'text'} inputMode={o.mode} autoComplete={o.auto} value={val[k]} onChange={(e) => setV({ ...val, [k]: e.target.value })} />
    </Field>
  );
  const send = (e: React.FormEvent) => void f.submit({ ...val, companions: val.companions!.trim() === '' ? NaN : Number(val.companions) }, e);
  return (
    <div className="guestform">
      <header><b>{data.hotelName}</b><h1>Meldeschein <small>Registration form</small></h1>
        <p className="muted">Reservierung {data.number} · {deDate(data.from)} – {deDate(data.to)}</p></header>
      {done || data.submitted ? (
        <p className="notice">{done ? 'Vielen Dank – Ihre Angaben sind angekommen. Thank you, your details have been received.' : 'Der Meldeschein wurde bereits ausgefüllt. Für Änderungen wenden Sie sich bitte an die Rezeption. This form has already been completed.'}</p>
      ) : (
        <form className="card" onSubmit={send} noValidate>
          <div className="formgrid">
            {input('lastName', 'Familienname / Surname', { auto: 'family-name' })}
            {input('firstName', 'Vornamen / First names', { auto: 'given-name' })}
            {input('birthdate', 'Geburtsdatum / Date of birth', { type: 'date', auto: 'bday' })}
            {input('nationality', 'Staatsangehörigkeit / Nationality')}
            {input('street', 'Straße und Hausnummer / Street and number', { auto: 'street-address' })}
            {input('zip', 'PLZ / Postal code', { auto: 'postal-code' })}
            {input('city', 'Ort / City', { auto: 'address-level2' })}
            {input('country', 'Staat / Country', { auto: 'country-name' })}
            {input('idNumber', 'Pass- oder Ausweisnummer / Passport or ID number', { hint: 'nur für Gäste ohne deutsche Staatsangehörigkeit / only for non-German guests' })}
            {input('companions', 'Anzahl mitreisender Personen / Accompanying persons', { mode: 'numeric' })}
          </div>
          <p className="muted small">Ihre Angaben werden an die Rezeption übermittelt und im Gästeprofil gespeichert. Your details are sent to the reception and stored in your guest profile.</p>
          <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Absenden / Submit</Button></div>
        </form>
      )}
    </div>
  );
}
