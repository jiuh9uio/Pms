import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { isActiveStatus, type BookingDto, type CheckinSheetDto, type GuestLinkDto } from '../../../src/shared/hotel.js';
import type { HotelSettings } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { Button, LoadState, useLoad, useToast } from '../ui.tsx';
import { deDate } from './common.tsx';

/** Meldeschein zum Ausdrucken und Unterschreiben – vorausgefüllt aus Reservierung und Gästeprofil. */
export function RegistrationPrint() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const toast = useToast();
  const [bonBusy, setBonBusy] = useState(false);
  const printBon = async () => {
    setBonBusy(true);
    try { const r = await api<{ guestSlip: boolean }>('POST', `/bookings/${id}/registration/bon`, {}); toast(r.guestSlip ? 'Meldeschein und Gästeinformationen auf dem Bondrucker gedruckt' : 'Meldeschein auf dem Bondrucker gedruckt'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Druck fehlgeschlagen', 'error'); }
    setBonBusy(false);
  };
  const { data, error } = useLoad(async () => {
    const [b, hotel, sheet] = await Promise.all([api<BookingDto>('GET', `/bookings/${id}`), api<HotelSettings>('GET', '/settings/hotel'), api<CheckinSheetDto>('GET', '/checkin-sheet').catch(() => null)]);
    // persönlicher Gäste-Link als QR-Code (nur wenn eingeschaltet und nicht gesperrt)
    const link = sheet?.showInfo && sheet.showGuestLink ? await api<GuestLinkDto>('GET', `/bookings/${id}/guest-link`).catch(() => null) : null;
    return { b, hotel, sheet, link: link && !link.blocked ? link : null };
  }, [id]);
  useEffect(() => { if (data) document.title = `Meldeschein ${data.b.number}`; }, [data]);
  // direkt nach dem Check-in: Druckfenster gleich öffnen (sobald der QR-Code geladen ist)
  useEffect(() => {
    if (!data || params.get('druck') !== '1') return;
    const t = setTimeout(() => window.print(), 400);
    return () => clearTimeout(t);
  }, [data, params]);
  if (!data) return <div className="center"><LoadState error={error} loading /></div>;
  const sheet = data.sheet?.showInfo && (data.sheet.wifi || data.sheet.lines.length || data.sheet.title || data.sheet.closing || data.link) ? data.sheet : null;
  return (
    <div className="printpage">
      <div className="printbar noprint">
        <Button variant="primary" onClick={() => window.print()}>Drucken (A4)</Button>
        {data.sheet?.bonPrinter && <Button busy={bonBusy} onClick={() => void printBon()}>Stattdessen auf Bondrucker</Button>}
        <span className="muted">Leere Felder füllt der Gast von Hand aus. Ob und für welche Gäste ein Meldeschein nötig ist und wie lange er aufzubewahren ist, regelt das Melderecht – bitte selbst prüfen.</span>
      </div>
      <RegistrationSheet b={data.b} h={data.hotel} sheet={params.get('info') === '0' ? null : sheet} link={data.link} />
    </div>
  );
}

/** Ein Meldeschein (A4), auf Wunsch mit abtrennbaren Gästeinformationen. */
export function RegistrationSheet({ b, h, sheet, link = null }: { b: BookingDto; h: HotelSettings; sheet: CheckinSheetDto | null; link?: GuestLinkDto | null }) {
  const g = b.guest;
  const rooms = b.rooms.filter((r) => isActiveStatus(r.status));
  const from = rooms.map((r) => r.from).sort()[0];
  const to = rooms.map((r) => r.to).sort().at(-1);
  const persons = rooms.reduce((s, r) => s + r.adults + r.children, 0);
  const row = (label: string, value: string | null | undefined) => <tr><th>{label}</th><td>{value || '\u00a0'}</td></tr>;
  return (
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
            <div className={`gi-body${sheet.wifi || link ? '' : ' nowifi'}`}>
              <div className="gi-codes">
              {sheet.wifi && (
                <div className="gi-wifi">
                  <img src={sheet.wifi.qr} alt="" />
                  <div><b>WLAN</b><span><small>Name</small>{sheet.wifi.ssid}</span>{sheet.wifi.open ? <span><small>Passwort</small>keins nötig</span> : <span><small>Passwort</small><code>{sheet.wifi.password}</code></span>}
                    <small className="gi-hint">QR-Code mit der Handykamera scannen, um sich direkt zu verbinden.</small></div>
                </div>
              )}
              {link && (
                <div className="gi-wifi gi-link">
                  <img src={link.qr} alt="" />
                  <div><b>Ihre Buchung online</b><span>{sheet.guestLinkText}</span>
                    <small className="gi-hint">QR-Code mit der Handykamera scannen. Zum Öffnen: Ihr Nachname{link.needsZip ? ' und Ihre Postleitzahl' : ''}.</small></div>
                </div>
              )}
              </div>
              {sheet.lines.length > 0 && <dl className="gi-lines">{sheet.lines.map((l, i) => l.label ? <div key={i}><dt>{l.label}</dt><dd>{l.value}</dd></div> : <div key={i} className="full"><dd>{l.value}</dd></div>)}</dl>}
            </div>
            {sheet.closing && <p className="gi-closing">{sheet.closing}</p>}
          </section>
        )}
      </article>
  );
}

/** Mehrere Meldescheine auf einmal drucken (aus dem Archiv), je einer pro Seite – ohne Gästeinformationen. */
export function RegistrationBatchPrint() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 100);
  const { data, error } = useLoad(async () => {
    const [hotel, ...bookings] = await Promise.all([api<HotelSettings>('GET', '/settings/hotel'), ...ids.map((id) => api<BookingDto>('GET', `/bookings/${id}`))]);
    return { hotel, bookings };
  }, [params.get('ids')]);
  useEffect(() => { document.title = `Meldescheine (${ids.length})`; }, [ids.length]);
  if (!data) return <div className="center"><LoadState error={error} loading /></div>;
  return (
    <div className="printpage">
      <div className="printbar noprint">
        <Button variant="primary" onClick={() => window.print()}>Alle drucken ({data.bookings.length})</Button>
        <span className="muted">Jeder Meldeschein kommt auf eine eigene Seite. Die Angaben stammen aus dem aktuellen Gästeprofil.</span>
      </div>
      {data.bookings.map((b) => <div key={b.id} className="pagebreak"><RegistrationSheet b={b} h={data.hotel} sheet={null} /></div>)}
    </div>
  );
}
