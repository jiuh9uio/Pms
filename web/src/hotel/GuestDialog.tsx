import { useEffect, useState } from 'react';
import { formatMoney, guestInput, type BookingListRow, type GuestDto } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { useData } from '../data.tsx';
import { Button, Dialog, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';
import { GuestFields, StatusBadge, deDate, toDraft, type GuestDraft } from './common.tsx';

/** Gästeprofil: Kontaktdaten, Bemerkungen, bisherige Aufenthalte – und erneut buchen mit einem Klick. */
export function GuestDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { bump, rev, openBooking, newBooking } = useData();
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';
  const anonymize = async () => {
    if (!window.confirm('Alle personenbezogenen Angaben dieses Gastes unwiderruflich entfernen?\n\nReservierungen bleiben ohne Namen erhalten; ausgestellte Rechnungen bleiben wegen der gesetzlichen Aufbewahrung unverändert.')) return;
    try { await api('POST', `/guests/${id}/anonymize`); toast('Gast anonymisiert'); bump(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const { data, error } = useLoad(async () => (id ? api<{ guest: GuestDto; bookings: BookingListRow[] }>('GET', `/guests/${id}`) : null), [id, rev]);
  const [v, setV] = useState<GuestDraft>(toDraft({}));
  useEffect(() => { if (data) setV(toDraft(data.guest)); }, [data]);
  const f = useSubmit(guestInput, async (d) => {
    if (id) await api('PUT', `/guests/${id}`, { ...d, version: data!.guest.version });
    else await api('POST', '/guests', d);
    toast('Gast gespeichert');
    bump();
    if (!id) onClose();
  });
  const name = data ? [data.guest.firstName, data.guest.lastName].filter(Boolean).join(' ') : 'Neuer Gast';

  return (
    <Dialog title={name} onClose={onClose} size={id ? 'lg' : 'md'}
      footer={<>{data && <Button className="left" onClick={() => { onClose(); newBooking({ guest: data.guest }); }}>Neue Reservierung für diesen Gast</Button>}
        {data && isAdmin && <><a className="btn" href={`/api/v1/guests/${id}/export.json`}>Datenauskunft</a><Button variant="danger" onClick={() => void anonymize()}>Anonymisieren</Button></>}
        <Button onClick={onClose}>Schließen</Button><Button variant="primary" busy={f.busy} onClick={() => void f.submit(v)}>Speichern</Button></>}>
      {id && !data ? <LoadState error={error} loading /> : (
        <div className={id ? 'split' : ''}>
          <form onSubmit={(e) => void f.submit(v, e)} noValidate>
            <GuestFields value={v} onChange={setV} errors={f.errors} />
            <button type="submit" hidden />
          </form>
          {data && (
            <aside>
              <h3>Aufenthalte und Reservierungen</h3>
              {data.bookings.length === 0 && <p className="muted">Noch keine Reservierungen.</p>}
              <ul className="plain compact">
                {data.bookings.map((b) => (
                  <li key={b.id} className="rowlink" onClick={() => openBooking(b.bookingId)}>
                    <span>{deDate(b.from)} – {deDate(b.to)}<br /><small>Zimmer {b.roomNumber} · {b.number}</small></span>
                    <span className="right"><StatusBadge status={b.status} /><br /><small>{formatMoney(b.lodgingCents)}</small></span>
                  </li>
                ))}
              </ul>
              <p className="muted small">Rechnungen erscheinen hier, sobald die Abrechnung (Phase 3) verfügbar ist.</p>
            </aside>
          )}
        </div>
      )}
    </Dialog>
  );
}
