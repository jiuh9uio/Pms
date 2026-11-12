import { STATUS_LABEL, type GuestInput, type RoomStatus } from '../../../src/shared/hotel.js';
import { Field } from '../ui.tsx';

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
export function GuestFields({ value, onChange, errors, prefix = '', compact }: {
  value: GuestDraft; onChange: (v: GuestDraft) => void; errors: Record<string, string>; prefix?: string; compact?: boolean;
}) {
  const f = (k: keyof GuestDraft, label: string, o: { type?: string; wide?: boolean } = {}) => (
    <Field label={label} error={errors[prefix + k]} wide={o.wide}>
      <input type={o.type ?? 'text'} value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })} />
    </Field>
  );
  return (
    <div className="formgrid">
      <Field label="Anrede" error={errors[prefix + 'salutation']}>
        <select value={value.salutation} onChange={(e) => onChange({ ...value, salutation: e.target.value })}>
          <option value="">–</option><option>Herr</option><option>Frau</option>
        </select>
      </Field>
      {f('firstName', 'Vorname')}{f('lastName', 'Nachname')}{f('company', 'Firma')}
      {f('email', 'E-Mail', { type: 'email' })}{f('phone', 'Telefon', { type: 'tel' })}
      {!compact && <>
        {f('street', 'Straße und Hausnummer', { wide: true })}{f('zip', 'PLZ')}{f('city', 'Ort')}{f('country', 'Land')}
        {f('birthdate', 'Geburtsdatum', { type: 'date' })}{f('nationality', 'Staatsangehörigkeit')}{f('idNumber', 'Ausweisnummer')}
        <Field label="Interne Bemerkungen" error={errors[prefix + 'notes']} wide>
          <textarea rows={2} value={value.notes} onChange={(e) => onChange({ ...value, notes: e.target.value })} />
        </Field>
      </>}
    </div>
  );
}
