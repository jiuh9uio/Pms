import { useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { isActiveStatus, type BookingDto, type CheckinSheetDto } from '../../../src/shared/hotel.js';
import type { HotelSettings } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { Button, LoadState, useLoad } from '../ui.tsx';
import { deDate } from './common.tsx';

/** Meldeschein zum Ausdrucken und Unterschreiben – vorausgefüllt aus Reservierung und Gästeprofil. */
export function RegistrationPrint() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { data, error } = useLoad(async () => {
    const [b, hotel, sheet] = await Promise.all([api<BookingDto>('GET', `/bookings/${id}`), api<HotelSettings>('GET', '/settings/hotel'), api<CheckinSheetDto>('GET', '/checkin-sheet').catch(() => null)]);
    return { b, hotel, sheet };
  }, [id]);
  useEffect(() => { if (data) document.title = `Meldeschein ${data.b.number}`; }, [data]);
  // direkt nach dem Check-in: Druckfenster gleich öffnen (sobald der QR-Code geladen ist)
  useEffect(() => {
    if (!data || params.get('druck') !== '1') return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [data, params]);
  if (!data) return <div className="center"><LoadState error={error} loading /></div>;
  const { b, hotel: h } = data;
  const g = b.guest;
  const rooms = b.rooms.filter((r) => isActiveStatus(r.status));
  const from = rooms.map((r) => r.from).sort()[0];
  const to = rooms.map((r) => r.to).sort().at(-1);
  const persons = rooms.reduce((s, r) => s + r.adults + r.children, 0);
  const sheet = data.sheet?.showInfo && (data.sheet.wifi || data.sheet.lines.length || data.sheet.title || data.sheet.closing) ? data.sheet : null;
  const row = (label: string, value: string | null | undefined) => <tr><th>{label}</th><td>{value || ' '}</td></tr>;
  return (
    <div className="printpage">
      <div className="printbar noprint">
        <Button variant="primary" onClick={() => window.print()}>Drucken</Button>
        <span className="muted">Leere Felder füllt der Gast von Hand aus. Ob und für welche Gäste ein Meldeschein nötig ist und wie lange er aufzubewahren ist, regelt das Melderecht – bitte selbst prüfen.</span>
      </div>
      <article className={`invoice regform${sheet ? ' withinfo' : ''}`}>
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
        {sheet && (
          <section className="guestinfo">
            <div className="cutline"><span>✂ hier abtrennen – für den Gast</span></div>
            <div className="gi-head">{sheet.title && <h2>{sheet.title}</h2>}<span>{h.name}{rooms.length ? ` · Zimmer ${rooms.map((r) => r.roomNumber).join(', ')}` : ''}</span></div>
            <div className={`gi-body${sheet.wifi ? '' : ' nowifi'}`}>
              {sheet.wifi && (
                <div className="gi-wifi">
                  <img src={sheet.wifi.qr} alt="" />
                  <div><b>WLAN</b><span><small>Name</small>{sheet.wifi.ssid}</span>{sheet.wifi.open ? <span><small>Passwort</small>keins nötig</span> : <span><small>Passwort</small><code>{sheet.wifi.password}</code></span>}
                    <small className="gi-hint">QR-Code mit der Handykamera scannen, um sich direkt zu verbinden.</small></div>
                </div>
              )}
              {sheet.lines.length > 0 && <dl className="gi-lines">{sheet.lines.map((l, i) => l.label ? <div key={i}><dt>{l.label}</dt><dd>{l.value}</dd></div> : <div key={i} className="full"><dd>{l.value}</dd></div>)}</dl>}
            </div>
            {sheet.closing && <p className="gi-closing">{sheet.closing}</p>}
          </section>
        )}
      </article>
    </div>
  );
}
