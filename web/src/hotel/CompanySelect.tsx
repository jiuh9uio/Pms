import type { CompanyDto } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { Field, useLoad } from '../ui.tsx';

/** Auswahl der Firma für eine Firmenbuchung (vereinbarte Preise, Rechnung an die Firma). */
export function CompanySelect({ value, onChange, hint }: { value: string; onChange: (id: string) => void; hint?: string }) {
  const { data } = useLoad(() => api<CompanyDto[]>('GET', '/companies'));
  const list = (data ?? []).filter((c) => c.active || c.id === value);
  return (
    <Field label="Firma" hint={hint ?? (value ? 'Vereinbarte Preise gelten, die Rechnung geht an die Firma.' : undefined)}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">keine (Privatbuchung)</option>
        {list.map((c) => <option key={c.id} value={c.id}>{c.name}{c.city ? ` – ${c.city}` : ''}</option>)}
      </select>
    </Field>
  );
}
