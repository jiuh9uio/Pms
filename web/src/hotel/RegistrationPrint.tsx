import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { isActiveStatus, type BookingDto } from '../../../src/shared/hotel.js';
import type { HotelSettings } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { Button, LoadState, useLoad } from '../ui.tsx';
import { deDate } from './common.tsx';

/** Meldeschein zum Ausdrucken und Unterschreiben – vorausgefüllt aus Reservierung und Gästeprofil. */
export function RegistrationPrint() {
  const { id } = useParams();
  const { data, error } = useLoad(async () => {
    const [b, hotel] = await Promise.all([api<BookingDto>('GET', `/bookings/${id}`), api<HotelSettings>('GET', '/settings/hotel')]);
    return { b, hotel };
  }, [id]);
  useEffect(() => { if (data) document.title = `Meldeschein ${data.b.number}`; }, [data]);
  if (!data) return <div className="center"><LoadState error={error} loading /></div>;
  const { b, hotel: h } = data;
  const g = b.guest;
  const rooms = b.rooms.filter((r) => isActiveStatus(r.status));
  const from = rooms.map((r) => r.from).sort()[0];
  const to = rooms.map((r) => r.to).sort().at(-1);
  const persons = rooms.reduce((s, r) => s + r.adults + r.children, 0);
  const row = (label: string, value: string | null | undefined) => <tr><th>{label}</th><td>{value || ' '}</td></tr>;
  return (
    <div className="printpage">
      <div className="printbar noprint">
        <Button variant="primary" onClick={() => window.print()}>Drucken</Button>
        <span className="muted">Leere Felder füllt der Gast von Hand aus. Ob und für welche Gäste ein Meldeschein nötig ist und wie lange er aufzubewahren ist, regelt das Melderecht – bitte selbst prüfen.</span>
      </div>
      <article className="invoice regform">
        <header><b>{h.name}</b><br /><small>{[h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</small></header>
        <h1>Meldeschein</h1>
        <table><tbody>
          {row('Ankunft', from ? deDate(from) : '')}{row('Voraussichtliche Abreise', to ? deDate(to) : '')}
          {row('Zimmer', rooms.map((r) => r.roomNumber).join(', '))}{row('Reservierung', b.number)}
          {row('Familienname', g.lastName)}{row('Vornamen', g.firstName)}{row('Geburtsdatum', g.birthdate ? deDate(g.birthdate) : '')}
          {row('Staatsangehörigkeit', g.nationality)}{row('Straße und Hausnummer', g.street)}{row('PLZ, Ort', [g.zip, g.city].filter(Boolean).join(' '))}{row('Staat', g.country)}
          {row('Pass- oder Ausweisnummer (bei ausländischen Gästen)', g.idNumber)}
          {row('Anzahl der mitreisenden Personen', persons > 1 ? String(persons - 1) : '')}
        </tbody></table>
        <div className="signatures"><span>Ort, Datum</span><span>Unterschrift des Gastes</span></div>
      </article>
    </div>
  );
}
