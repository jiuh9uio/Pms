import { useEffect, useState } from 'react';
import type { CompanyDto, GuestDto } from '../../src/shared/hotel.js';
import { api } from './api.ts';

/** Aus der Kundendatenbank übernommene Angaben (Gästekartei oder Firmen) */
export interface PickedCustomer { company: string; name: string; firstName: string; lastName: string; street: string; zip: string; city: string; country: string; email: string; phone: string; vatId: string }

/**
 * Suche in der Kundendatenbank (Gäste und Firmen) – überall, wo Empfänger- oder Kundendaten eingetragen werden.
 * Übernimmt Name, Firma, Anschrift, E-Mail und Telefon in das Formular; die Angaben bleiben danach änderbar.
 * Ohne Zugriff auf die Gästekartei (fehlende Freigabe) blendet sich die Suche aus.
 */
export function CustomerPicker({ onPick, label = 'Aus der Kundendatenbank übernehmen', disabled }: { onPick: (c: PickedCustomer) => void; label?: string; disabled?: boolean }) {
  const [q, setQ] = useState('');
  const [guests, setGuests] = useState<GuestDto[]>([]);
  const [companies, setCompanies] = useState<CompanyDto[]>([]);
  const [off, setOff] = useState(false);
  const [searched, setSearched] = useState(false);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setGuests([]); setCompanies([]); setSearched(false); return; }
    let live = true;
    const t = setTimeout(() => {
      void Promise.allSettled([api<GuestDto[]>('GET', `/guests?q=${encodeURIComponent(term)}`), api<CompanyDto[]>('GET', `/companies?q=${encodeURIComponent(term)}`)]).then(([g, c]) => {
        if (!live) return;
        if (g.status === 'rejected' && c.status === 'rejected') { setOff(true); return; }
        setGuests(g.status === 'fulfilled' ? g.value.slice(0, 8) : []);
        setCompanies(c.status === 'fulfilled' ? c.value.filter((x) => x.active).slice(0, 6) : []);
        setSearched(true);
      });
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  if (off || disabled) return null;
  const done = (c: PickedCustomer) => { onPick(c); setQ(''); };
  const fromGuest = (g: GuestDto): PickedCustomer => ({ company: g.company, name: [g.firstName, g.lastName].filter(Boolean).join(' '), firstName: g.firstName, lastName: g.lastName,
    street: g.street, zip: g.zip, city: g.city, country: g.country, email: g.email, phone: g.phone, vatId: '' });
  const fromCompany = (c: CompanyDto): PickedCustomer => { const [first, ...rest] = c.contactName.split(' '); return { company: c.name, name: c.contactName, firstName: rest.length ? first ?? '' : '', lastName: rest.length ? rest.join(' ') : c.contactName,
    street: c.street, zip: c.zip, city: c.city, country: c.country, email: c.email, phone: c.phone, vatId: c.vatId }; };
  return (
    <div className="cpick">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`${label}: Name, Firma oder Ort …`} aria-label={label}
        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
      {(guests.length > 0 || companies.length > 0) && (
        <div className="hits cpick-hits">
          {companies.map((c) => <button type="button" key={`c-${c.id}`} onClick={() => done(fromCompany(c))}><b>{c.name}</b> <small>Firma{c.city ? ` · ${c.city}` : ''}{c.contactName ? ` · ${c.contactName}` : ''}</small></button>)}
          {guests.map((g) => <button type="button" key={`g-${g.id}`} onClick={() => done(fromGuest(g))}><b>{[g.firstName, g.lastName].filter(Boolean).join(' ')}</b> <small>{['Gast', g.company, g.city].filter(Boolean).join(' · ')}</small></button>)}
        </div>
      )}
      {searched && guests.length === 0 && companies.length === 0 && <small className="muted">Nichts gefunden – die Angaben einfach unten eintragen.</small>}
    </div>
  );
}
