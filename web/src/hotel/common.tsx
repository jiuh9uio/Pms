import { STATUS_LABEL, type GuestInput, type RoomStatus } from '../../../src/shared/hotel.js';
import { useState } from 'react';
import { Field } from '../ui.tsx';
import { AddressLookup } from './AddressLookup.tsx';

export const deDate = (s: string | null | undefined) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '–');
export const deShort = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.`;
export const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
export const persons = (a: number, c: number) => (c ? `${a} Erw. + ${c} Ki.` : `${a} ${a === 1 ? 'Person' : 'Personen'}`);

export const StatusBadge = ({ status }: { status: RoomStatus }) => <span className={`status st-${status}`}>{STATUS_LABEL[status]}</span>;

/** Zeichenketten-Entwurf eines Gastes für Formulare */
export type GuestDraft = { [K in keyof GuestInput]: string };
export const toDraft = (g: Partial<Record<keyof GuestInput, string | null>>): GuestDraft => ({
  salutation: g.salutation ?? '', firstName: g.firstName ?? '', lastName: g.lastName ?? '', company: g.company ?? '', email: g.email ?? '',
  phone: g.phone ?? '', street: g.street ?? '', zip: g.zip ?? '', city: g.city ?? '', country: g.country ?? 'Deutschland',
  birthdate: g.birthdate ?? '', nationality: g.nationality ?? '', idNumber: g.idNumber ?? '', notes: g.notes ?? '',
});

/** Eingabefelder eines Gastes. compact = nur das Nötigste für eine schnelle Buchung. */
export function GuestFields({ value, onChange, errors, prefix = '', compact, grouped }: {
  value: GuestDraft; onChange: (v: GuestDraft) => void; errors: Record<string, string>; prefix?: string; compact?: boolean;
  /** übersichtliche Abschnitte (Name & Kontakt, Anschrift, Meldedaten) – z. B. beim Check-in */
  grouped?: boolean;
}) {
  const f = (k: keyof GuestDraft, label: string, o: { type?: string; wide?: boolean } = {}) => (
    <Field label={label} error={errors[prefix + k]} wide={o.wide}>
      <input type={o.type ?? 'text'} value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
    </Field>
  );
  const [lookup, setLookup] = useState(false);
  const salutation = (
    <Field label="Anrede" error={errors[prefix + 'salutation']}>
      <select value={value.salutation} onChange={(e) => onChange({ ...value, salutation: e.target.value })}>
        <option value="">–</option><option>Herr</option><option>Frau</option>
      </select>
    </Field>
  );
  const lookupBox = lookup
    ? <AddressLookup forGuest onClose={() => setLookup(false)} onPick={(c) => onChange({ ...value, street: c.street || value.street, zip: c.zip || value.zip, city: c.city || value.city,
        country: c.country || value.country, company: value.company || (c.source !== 'OpenStreetMap' && c.name ? c.name : '') })} />
    : <div className="wide"><button type="button" className="linkbtn" onClick={() => setLookup(true)}>Adresse nachschlagen (Google-Maps-Link, Impressum oder Karte) …</button></div>;
  if (grouped) return (
    <div className="guestgroups">
      <fieldset className="gsec"><legend>Name &amp; Kontakt</legend>
        <div className="formgrid cols3">{salutation}{f('firstName', 'Vorname')}{f('lastName', 'Nachname')}{f('company', 'Firma')}{f('email', 'E-Mail', { type: 'email' })}{f('phone', 'Telefon', { type: 'tel' })}</div>
      </fieldset>
      <fieldset className="gsec"><legend>Anschrift</legend>
        <div className="formgrid cols3">{lookupBox}{f('street', 'Straße und Hausnummer', { wide: true })}{f('zip', 'PLZ')}{f('city', 'Ort')}{f('country', 'Land')}</div>
      </fieldset>
      <fieldset className="gsec"><legend>Meldedaten</legend>
        <div className="formgrid cols3">{f('birthdate', 'Geburtsdatum', { type: 'date' })}{f('nationality', 'Staatsangehörigkeit')}{f('idNumber', 'Ausweisnummer')}</div>
      </fieldset>
      <Field label="Interne Bemerkungen" error={errors[prefix + 'notes']} wide>
        <textarea rows={2} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
      </Field>
    </div>
  );
  return (
    <div className="formgrid">
      {salutation}
      {f('firstName', 'Vorname')}{f('lastName', 'Nachname')}{f('company', 'Firma')}
      {f('email', 'E-Mail', { type: 'email' })}{f('phone', 'Telefon', { type: 'tel' })}
      {!compact && <>
        {lookupBox}
        {f('street', 'Straße und Hausnummer', { wide: true })}{f('zip', 'PLZ')}{f('city', 'Ort')}{f('country', 'Land')}
        {f('birthdate', 'Geburtsdatum', { type: 'date' })}{f('nationality', 'Staatsangehörigkeit')}{f('idNumber', 'Ausweisnummer')}
        <Field label="Interne Bemerkungen" error={errors[prefix + 'notes']} wide>
          <textarea rows={2} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
        </Field>
      </>}
    </div>
  );
}
