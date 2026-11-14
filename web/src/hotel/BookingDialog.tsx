import { useEffect, useState } from 'react';
import type { AuditDto, TaxRateDto } from '../../../src/shared/schemas.js';
import {
  isActiveStatus,
  PAYMENT_METHODS, SOURCES, STATUS_LABEL, addDays, bookingRoomInput, bookingRoomUpdateInput, bookingUpdateInput, chargeInput, diffDays, formatMoney,
  guestInput, isIsoDate, moneyInput, parseMoney, todayBerlin,
  type BookingDto, type BookingRoomDto, type CancelTerms, type GuestLinkDto, type FreeRoomDto, type RoomStatus, type ServiceDto,
} from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import type { BookingBillingDto } from '../../../src/shared/billing.js';
import { BookingBilling } from '../billing/BookingBilling.tsx';
import { CompanySelect } from './CompanySelect.tsx';
import { GuestFormDialog } from './GuestFormDialog.tsx';
import { MailDialog } from './MailDialog.tsx';
import { useData } from '../data.tsx';
import { Button, Dialog, Field, LoadState, fmtDateTime, useLoad, useSubmit, useToast } from '../ui.tsx';
import { GuestFields, StatusBadge, deDate, deShort, persons, toDraft, type GuestDraft } from './common.tsx';

type Sub = { kind: 'checkin' | 'checkout' | 'edit'; room: BookingRoomDto } | { kind: 'add' } | null;

export function BookingDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { rev, bump, openGuest } = useData();
  const toast = useToast();
  const { data: b, error } = useLoad(() => api<BookingDto>('GET', `/bookings/${id}`), [id, rev]);
  const history = useLoad(() => api<AuditDto[]>('GET', `/bookings/${id}/history`), [id, rev]);
  const [sub, setSub] = useState<Sub>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [mail, setMail] = useState(false);
  const [qr, setQr] = useState(false);

  const setStatus = async (room: BookingRoomDto, status: RoomStatus, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(room.id);
    try {
      await api('POST', `/booking-rooms/${room.id}/status`, { status, version: room.version });
      toast(`Zimmer ${room.roomNumber}: ${STATUS_LABEL[status]}`);
      bump();
    } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(null);
  };

  const guestName = b ? [b.guest.firstName, b.guest.lastName].filter(Boolean).join(' ') : '';
  return (
    <Dialog title={b ? <>Reservierung {b.number} <span className="muted light">· {guestName}</span></> : 'Reservierung'} onClose={onClose} size="xl"
      footer={<>{b && <a className="btn" href={`/meldeschein/${b.id}`} target="_blank" rel="noopener">Meldeschein drucken</a>}{b && <Button onClick={() => setQr(true)}>Meldeschein per QR</Button>}{b && <Button onClick={() => setMail(true)}>Bestätigung per E-Mail</Button>}<Button onClick={onClose}>Schließen</Button></>}>
      {!b ? <LoadState error={error} loading /> : (
        <div className="split">
          <div>
            <div className="chosen">
              <span><b>{guestName}</b>{b.guest.company && <> · {b.guest.company}</>}<br />
                <small>{[b.guest.phone, b.guest.email, [b.guest.zip, b.guest.city].filter(Boolean).join(' ')].filter(Boolean).join(' · ') || 'Keine Kontaktdaten hinterlegt'}</small></span>
              <Button onClick={() => openGuest(b.guest.id)}>Gästeprofil</Button>
            </div>

            <h3>Zimmer</h3>
            {b.rooms.map((r) => (
              <RoomCard key={r.id} room={r} busy={busy === r.id} onStatus={setStatus}
                onCheckin={() => setSub({ kind: 'checkin', room: r })} onCheckout={() => setSub({ kind: 'checkout', room: r })} onEdit={() => setSub({ kind: 'edit', room: r })} />
            ))}
            <p><Button onClick={() => setSub({ kind: 'add' })}>+ Weiteres Zimmer</Button></p>

            <Charges booking={b} />
          </div>
          <aside>
            <h3 className="first">Summe</h3>
            <table className="sums"><tbody>
              <tr><td>Übernachtung</td><td className="num">{formatMoney(b.lodgingCents)}</td></tr>
              <tr><td>Frühstück und Leistungen</td><td className="num">{formatMoney(b.chargesCents)}</td></tr>
              <tr className="sum"><td>Gesamt (brutto)</td><td className="num">{formatMoney(b.totalCents)}</td></tr>
            </tbody></table>
            <BookingBilling booking={b} />
            <Meta booking={b} />
            <h3>Verlauf</h3>
            <ul className="history">
              {history.data?.map((h) => <li key={h.id}><span>{describe(h)}</span><small>{fmtDateTime(h.at)} · {h.userName}</small></li>)}
            </ul>
          </aside>
        </div>
      )}
      {b && qr && <GuestFormDialog bookingId={b.id} number={b.number} onClose={() => { setQr(false); bump(); }} />}
      {b && mail && <MailDialog path={`/bookings/${b.id}/mail`} title={`Bestätigung zu Reservierung ${b.number}`} onClose={() => setMail(false)} onSent={bump} />}
      {b && sub?.kind === 'checkin' && <Checkin booking={b} room={sub.room} onClose={() => setSub(null)} />}
      {b && sub?.kind === 'checkout' && <Checkout booking={b} room={sub.room} onClose={() => setSub(null)} />}
      {b && sub?.kind === 'edit' && <RoomForm booking={b} room={sub.room} onClose={() => setSub(null)} />}
      {b && sub?.kind === 'add' && <RoomForm booking={b} room={null} onClose={() => setSub(null)} />}
    </Dialog>
  );
}

function RoomCard({ room: r, busy, onStatus, onCheckin, onCheckout, onEdit }: {
  room: BookingRoomDto; busy: boolean; onStatus: (r: BookingRoomDto, s: RoomStatus, confirm?: string) => void;
  onCheckin: () => void; onCheckout: () => void; onEdit: () => void;
}) {
  const [open, setOpen] = useState(false);
  const editable = ['tentative', 'confirmed', 'checked_in'].includes(r.status);
  const cancelText = `Zimmer ${r.roomNumber} wirklich stornieren? Das Zimmer wird wieder frei.`;
  return (
    <div className={`roomcard st-${r.status}`}>
      <div className="roomcard-main">
        <div>
          <b>Zimmer {r.roomNumber}</b> <small className="inl">{r.categoryName}</small> <StatusBadge status={r.status} /><br />
          {deDate(r.from)} – {deDate(r.to)} · {r.nights} {r.nights === 1 ? 'Nacht' : 'Nächte'} · {persons(r.adults, r.children)}
        </div>
        <div className="num"><b>{formatMoney(r.lodgingCents)}</b><br />
          <button type="button" className="linkbtn" onClick={() => setOpen(!open)} aria-expanded={open}>Preise je Nacht {open ? '▴' : '▾'}</button></div>
      </div>
      {open && (
        <table className="nights"><tbody>
          {r.nightly?.map((n) => <tr key={n.date}><td>{deDate(n.date)}</td><td className="muted">{n.source} · {n.taxRatePercent.toLocaleString('de-DE')} % MwSt.</td><td className="num">{formatMoney(n.priceCents)}</td></tr>)}
        </tbody></table>
      )}
      <div className="roomcard-actions">
        {r.status === 'tentative' && <Button variant="primary" busy={busy} onClick={() => onStatus(r, 'confirmed')}>Bestätigen</Button>}
        {r.status === 'confirmed' && <Button variant="primary" busy={busy} onClick={onCheckin}>Check-in</Button>}
        {r.status === 'checked_in' && <Button variant="primary" busy={busy} onClick={onCheckout}>Check-out</Button>}
        {editable && <Button onClick={onEdit}>Ändern</Button>}
        {(r.status === 'tentative' || r.status === 'confirmed') && <Button variant="danger" busy={busy} onClick={() => onStatus(r, 'cancelled', cancelText)}>Stornieren</Button>}
        {r.status === 'confirmed' && r.from <= todayBerlin() && <Button busy={busy} onClick={() => onStatus(r, 'no_show', `Zimmer ${r.roomNumber} als nicht angereist markieren? Das Zimmer wird wieder frei.`)}>Nicht angereist</Button>}
        {r.status === 'checked_in' && <Button busy={busy} onClick={() => onStatus(r, 'confirmed', 'Check-in zurücknehmen?')}>Check-in zurücknehmen</Button>}
        {r.status === 'checked_out' && <Button busy={busy} onClick={() => onStatus(r, 'checked_in', 'Check-out zurücknehmen? Der Gast gilt wieder als im Haus.')}>Check-out zurücknehmen</Button>}
        {(r.status === 'cancelled' || r.status === 'no_show') && <Button busy={busy} onClick={() => onStatus(r, 'confirmed')}>Reaktivieren</Button>}
      </div>
    </div>
  );
}

/** Zimmer ändern (Zimmer, Zeitraum, Personen, Preis) oder ein weiteres Zimmer zur Buchung hinzufügen. */
function RoomForm({ booking, room, onClose }: { booking: BookingDto; room: BookingRoomDto | null; onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const ref = room ?? booking.rooms[0];
  const [v, setV] = useState({
    roomId: room?.roomId ?? '', from: ref?.from ?? todayBerlin(), to: ref?.to ?? addDays(todayBerlin(), 1),
    adults: String(room?.adults ?? 2), children: String(room?.children ?? 0), status: 'confirmed' as 'confirmed' | 'tentative',
    priceMode: 'keep' as 'keep' | 'auto' | 'manual', price: room?.priceManual ? moneyInput(room.nightly?.[0]?.priceCents) : '',
  });
  const valid = isIsoDate(v.from) && isIsoDate(v.to) && v.from < v.to;
  const free = useLoad(async () => (valid ? api<FreeRoomDto[]>('GET', `/availability?from=${v.from}&to=${v.to}${room ? `&exclude=${room.allocationId}` : ''}`) : []), [v.from, v.to]);
  const done = (msg: string) => { toast(msg); bump(); onClose(); };
  const upd = useSubmit(bookingRoomUpdateInput, async (d) => { await api('PATCH', `/booking-rooms/${room!.id}`, d); done('Zimmerbuchung geändert'); });
  const add = useSubmit(bookingRoomInput, async (d) => { await api('POST', `/bookings/${booking.id}/rooms`, d); done('Zimmer hinzugefügt'); });
  const f = room ? upd : add;
  const price = v.price.trim() === '' ? null : parseMoney(v.price);
  const send = (e?: React.FormEvent) => {
    const common = { roomId: v.roomId, from: v.from, to: v.to, adults: Number(v.adults), children: Number(v.children) };
    if (room) void upd.submit({ ...common, version: room.version, ...(v.priceMode === 'manual' ? { pricePerNightCents: price } : v.priceMode === 'auto' ? { pricePerNightCents: null } : {}) }, e);
    else void add.submit({ ...common, status: v.status, pricePerNightCents: price }, e);
  };
  const pick = free.data?.find((r) => r.id === v.roomId);
  const fixedFrom = room?.status === 'checked_in';
  return (
    <Dialog title={room ? `Zimmer ${room.roomNumber} ändern` : 'Weiteres Zimmer hinzufügen'} onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={() => send()}>{room ? 'Speichern' : 'Hinzufügen'}</Button></>}>
      <form className="formgrid" onSubmit={send} noValidate>
        <Field label="Anreise" error={f.errors.from} hint={fixedFrom ? 'Nach dem Check-in fest' : undefined}><input type="date" value={v.from} disabled={fixedFrom} onChange={(e) => setV({ ...v, from: e.target.value })} /></Field>
        <Field label="Abreise" error={f.errors.to ?? (!valid ? 'Muss nach der Anreise liegen' : undefined)}><input type="date" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} /></Field>
        <Field label="Zimmer" error={f.errors.roomId} wide hint={valid && free.data && !pick && v.roomId ? 'Das gewählte Zimmer ist in diesem Zeitraum nicht frei' : undefined}>
          <select value={v.roomId} onChange={(e) => setV({ ...v, roomId: e.target.value })}>
            <option value="">Bitte wählen</option>
            {free.data?.map((r) => <option key={r.id} value={r.id}>{r.number} – {r.categoryName} ({formatMoney(r.quoteCents)})</option>)}
          </select>
        </Field>
        <Field label="Erwachsene" error={f.errors.adults}><input type="number" min={1} value={v.adults} onChange={(e) => setV({ ...v, adults: e.target.value })} /></Field>
        <Field label="Kinder" error={f.errors.children}><input type="number" min={0} value={v.children} onChange={(e) => setV({ ...v, children: e.target.value })} /></Field>
        {room ? (
          <Field label="Preis" wide error={f.errors.pricePerNightCents}
            hint={v.priceMode === 'keep' ? 'Bereits gebuchte Nächte behalten ihren Preis; nur neue Nächte werden berechnet.' : v.priceMode === 'auto' ? 'Alle Nächte werden nach den heutigen Preisregeln neu berechnet.' : undefined}>
            <div className="inlinefields">
              <select value={v.priceMode} onChange={(e) => setV({ ...v, priceMode: e.target.value as typeof v.priceMode })}>
                <option value="keep">Gebuchte Preise behalten</option><option value="auto">Neu berechnen</option><option value="manual">Sonderpreis je Nacht</option>
              </select>
              {v.priceMode === 'manual' && <input inputMode="decimal" value={v.price} placeholder="0,00" onChange={(e) => setV({ ...v, price: e.target.value })} aria-label="Preis je Nacht" />}
            </div>
          </Field>
        ) : (
          <>
            <Field label="Status"><select value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as typeof v.status })}><option value="confirmed">Bestätigt</option><option value="tentative">Vorläufig</option></select></Field>
            <Field label="Sonderpreis je Nacht" error={f.errors.pricePerNightCents} hint="leer = nach Preisregeln"><input inputMode="decimal" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} /></Field>
          </>
        )}
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Check-in in einem Schritt: Gastdaten prüfen und ergänzen, Zimmer bestätigen, Anreise buchen. */
function Checkin({ booking, room, onClose }: { booking: BookingDto; room: BookingRoomDto; onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const [v, setV] = useState<GuestDraft>(toDraft(booking.guest));
  const [roomId, setRoomId] = useState(room.roomId);
  const free = useLoad(() => api<FreeRoomDto[]>('GET', `/availability?from=${room.from}&to=${room.to}&exclude=${room.allocationId}`));
  const f = useSubmit(guestInput, async (d) => {
    if (JSON.stringify(toDraft(d as never)) !== JSON.stringify(toDraft(booking.guest)))
      await api('PUT', `/guests/${booking.guest.id}`, { ...d, version: booking.guest.version });
    let version = room.version;
    if (roomId !== room.roomId) {
      const moved = await api<BookingDto>('PATCH', `/booking-rooms/${room.id}`, { roomId, version });
      version = moved.rooms.find((r) => r.id === room.id)!.version;
    }
    await api('POST', `/booking-rooms/${room.id}/status`, { status: 'checked_in', version });
    toast(`${[d.firstName, d.lastName].filter(Boolean).join(' ')} ist eingecheckt`);
    bump();
    onClose();
  });
  const future = room.from > todayBerlin();
  return (
    <Dialog title={`Check-in · Zimmer ${room.roomNumber}`} onClose={onClose} size="lg"
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} disabled={future} onClick={() => void f.submit(v)}>Anreise bestätigen</Button></>}>
      {future && <p className="notice warn">Die Anreise ist erst am {deDate(room.from)}. Bei früherer Anreise bitte zuerst über „Ändern“ das Anreisedatum anpassen.</p>}
      <form onSubmit={(e) => void f.submit(v, e)} noValidate>
        <div className="formgrid">
          <Field label="Zimmer" wide hint={`${deDate(room.from)} – ${deDate(room.to)} · ${persons(room.adults, room.children)}`}>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              {(free.data ?? [{ id: room.roomId, number: room.roomNumber, categoryName: room.categoryName }]).map((r) => <option key={r.id} value={r.id}>{r.number} – {r.categoryName}</option>)}
            </select>
          </Field>
        </div>
        <h3>Gastdaten prüfen</h3>
        <GuestFields value={v} onChange={setV} errors={f.errors} />
        <p className="muted small">Ob und welche Meldedaten zu erfassen sind (z. B. bei ausländischen Gästen), richtet sich nach dem Melderecht – bitte Staatsangehörigkeit und Ausweisnummer nur erfassen, soweit erforderlich.</p>
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

/** Check-out: Leistungen prüfen, Abreise buchen, Zimmer wird frei. */
function Checkout({ booking, room, onClose }: { booking: BookingDto; room: BookingRoomDto; onClose: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const today = todayBerlin();
  const end = today <= room.from ? addDays(room.from, 1) : today;
  const early = end < room.to;
  const keptCents = (room.nightly ?? []).filter((n) => n.date < end).reduce((s, n) => s + n.priceCents, 0);
  const roomCharges = booking.charges.filter((c) => c.bookingRoomId === room.id || c.bookingRoomId === null);
  const chargesCents = roomCharges.reduce((s, c) => s + c.totalCents, 0);
  // offener Betrag und noch nicht berechnete Leistungen der ganzen Reservierung
  const billing = useLoad(() => api<BookingBillingDto>('GET', `/bookings/${booking.id}/billing`), [booking.id]).data;
  const bookingTotal = booking.rooms.filter((r) => isActiveStatus(r.status)).reduce((s, r) => s + r.lodgingCents, 0) + booking.chargesCents;
  const bill = billing ? { open: Math.max(bookingTotal - billing.paidCents, 0), uninvoiced: billing.uninvoicedCents } : null;
  const go = async () => {
    setBusy(true);
    try {
      await api('POST', `/booking-rooms/${room.id}/status`, { status: 'checked_out', version: room.version });
      toast(`Zimmer ${room.roomNumber} ausgecheckt und wieder frei`);
      bump();
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); setBusy(false); }
  };
  return (
    <Dialog title={`Check-out · Zimmer ${room.roomNumber}`} onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={busy} onClick={() => void go()}>Abreise bestätigen</Button></>}>
      {early && <p className="notice warn">Vorzeitige Abreise: geplant war der {deDate(room.to)}. Der Aufenthalt endet am {deDate(end)}, {diffDays(end, room.to)} Nacht/Nächte entfallen und das Zimmer wird ab dann frei.</p>}
      <h3 className="first">Leistungen prüfen</h3>
      <table className="sums"><tbody>
        <tr><td>Übernachtung {deShort(room.from)} – {deShort(early ? end : room.to)} ({diffDays(room.from, early ? end : room.to)} N.)</td><td className="num">{formatMoney(keptCents)}</td></tr>
        {roomCharges.map((c) => <tr key={c.id}><td>{c.name} × {c.quantity.toLocaleString('de-DE')}</td><td className="num">{formatMoney(c.totalCents)}</td></tr>)}
        <tr className="sum"><td>Summe</td><td className="num">{formatMoney(keptCents + chargesCents)}</td></tr>
      </tbody></table>
      {early && roomCharges.length > 0 && <p className="muted small">Leistungen werden bei vorzeitiger Abreise nicht automatisch gekürzt – bitte in der Reservierung prüfen.</p>}
      {bill && (bill.open > 0 || bill.uninvoiced > 0)
        ? <p className="notice warn" role="alert"><b>Noch nicht abgerechnet:</b> {bill.open > 0 && <>offen {formatMoney(bill.open)}</>}{bill.open > 0 && bill.uninvoiced > 0 && ' · '}{bill.uninvoiced > 0 && <>{formatMoney(bill.uninvoiced)} ohne Rechnung</>}. Der Check-out ist trotzdem möglich; abrechnen lässt sich vorher oder danach über „Bezahlen / Abrechnen“ in der Reservierung.</p>
        : bill ? <p className="notice">Die Reservierung ist vollständig berechnet und bezahlt.</p> : null}
    </Dialog>
  );
}

function Charges({ booking }: { booking: BookingDto }) {
  const { bump } = useData();
  const toast = useToast();
  const base = useLoad(async () => {
    const [services, rates] = await Promise.all([api<ServiceDto[]>('GET', '/services'), api<TaxRateDto[]>('GET', '/tax-rates')]);
    return { services: services.filter((s) => s.active), rates: rates.filter((r) => r.active) };
  });
  const [v, setV] = useState({ serviceId: '', bookingRoomId: booking.rooms[0]?.id ?? '', quantity: '', name: '', price: '', taxRateId: '' });
  const free = v.serviceId === 'free';
  const f = useSubmit(chargeInput, async (d) => {
    await api('POST', `/bookings/${booking.id}/charges`, d);
    setV({ ...v, serviceId: '', quantity: '', name: '', price: '' });
    bump();
  });
  const send = (e: React.FormEvent) => void f.submit({
    bookingRoomId: v.bookingRoomId || undefined, quantity: v.quantity.trim() === '' ? undefined : Number(v.quantity.replace(',', '.')),
    ...(free ? { name: v.name, unitPriceCents: parseMoney(v.price), taxRateId: v.taxRateId || base.data?.rates.find((r) => r.defaultFor === 'services')?.id } : { serviceId: v.serviceId || undefined }),
  }, e);
  const remove = async (id: string) => {
    try { await api('POST', `/charges/${id}/remove`); bump(); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
  };
  const errs = [...new Set(Object.values(f.errors))];
  return (
    <>
      <h3>Frühstück und Zusatzleistungen</h3>
      {booking.charges.length === 0 && <p className="muted">Keine Leistungen gebucht.</p>}
      {booking.charges.length > 0 && (
        <table className="nights"><tbody>
          {booking.charges.map((c) => (
            <tr key={c.id}>
              <td>{c.name}{c.bookingRoomId && <small className="inl"> Zi. {booking.rooms.find((r) => r.id === c.bookingRoomId)?.roomNumber}</small>}</td>
              <td className="muted">{c.quantity.toLocaleString('de-DE')} × {formatMoney(c.unitPriceCents)} · {c.taxRatePercent.toLocaleString('de-DE')} %</td>
              <td className="num">{formatMoney(c.totalCents)}</td>
              <td className="num"><button type="button" className="iconbtn" aria-label={`${c.name} entfernen`} onClick={() => void remove(c.id)}>✕</button></td>
            </tr>
          ))}
        </tbody></table>
      )}
      <form className="addcharge" onSubmit={send} noValidate>
        <select value={v.serviceId} onChange={(e) => setV({ ...v, serviceId: e.target.value })} aria-label="Leistung">
          <option value="">Leistung hinzufügen …</option>
          {base.data?.services.map((s) => <option key={s.id} value={s.id}>{s.name} ({formatMoney(s.priceCents)})</option>)}
          <option value="free">Freie Position …</option>
        </select>
        {v.serviceId && booking.rooms.length > 1 && (
          <select value={v.bookingRoomId} onChange={(e) => setV({ ...v, bookingRoomId: e.target.value })} aria-label="Zimmer">
            {booking.rooms.map((r) => <option key={r.id} value={r.id}>Zimmer {r.roomNumber}</option>)}<option value="">ganze Buchung</option>
          </select>
        )}
        {free && <>
          <input placeholder="Bezeichnung" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} aria-label="Bezeichnung" />
          <input placeholder="Preis" inputMode="decimal" className="short" value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} aria-label="Einzelpreis" />
          <select className="short" value={v.taxRateId || base.data?.rates.find((r) => r.defaultFor === 'services')?.id || ''} onChange={(e) => setV({ ...v, taxRateId: e.target.value })} aria-label="Steuersatz">
            {base.data?.rates.map((r) => <option key={r.id} value={r.id}>{r.ratePercent.toLocaleString('de-DE')} %</option>)}
          </select>
        </>}
        {v.serviceId && <>
          <input placeholder={free ? 'Menge' : 'Menge (automatisch)'} inputMode="decimal" className="short" value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value })} aria-label="Menge" />
          <Button type="submit" busy={f.busy}>Hinzufügen</Button>
        </>}
      </form>
      {errs.length > 0 && <p className="error">{errs.join(' · ')}</p>}
    </>
  );
}

function Meta({ booking }: { booking: BookingDto }) {
  const { bump } = useData();
  const toast = useToast();
  const init = { companyId: booking.companyId ?? '', source: booking.source, paymentMethod: booking.paymentMethod, groupName: booking.groupName, notes: booking.notes, optionUntil: booking.optionUntil ?? '' };
  const tentative = booking.rooms.some((r) => r.status === 'tentative');
  const [v, setV] = useState(init);
  useEffect(() => setV(init), [booking.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(v) !== JSON.stringify(init);
  const f = useSubmit(bookingUpdateInput, async (d) => { await api('PATCH', `/bookings/${booking.id}`, d); toast('Angaben gespeichert'); bump(); });
  const opts = (list: string[], cur: string) => (cur && !list.includes(cur) ? [cur, ...list] : list);
  return (
    <form onSubmit={(e) => void f.submit({ ...v, companyId: v.companyId || null, version: booking.version }, e)} noValidate>
      <GuestSide booking={booking} />
      <h3>Angaben</h3>
      <div className="formgrid">
        <div className="wide"><CompanySelect value={v.companyId} onChange={(cid) => setV({ ...v, companyId: cid })} hint={v.companyId !== (booking.companyId ?? '') ? 'Gilt für neu hinzukommende Nächte und neue Rechnungen; gebuchte Preise bleiben.' : undefined} /></div>
        <Field label="Buchungsquelle"><select value={v.source} onChange={(e) => setV({ ...v, source: e.target.value })}><option value="">–</option>{opts(SOURCES, v.source).map((s) => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Zahlungsart"><select value={v.paymentMethod} onChange={(e) => setV({ ...v, paymentMethod: e.target.value })}><option value="">offen</option>{opts(PAYMENT_METHODS, v.paymentMethod).map((s) => <option key={s}>{s}</option>)}</select></Field>
        {(booking.rooms.length > 1 || v.groupName) && <Field label="Gruppenname" wide><input value={v.groupName} onChange={(e) => setV({ ...v, groupName: e.target.value })} /></Field>}
        {(tentative || v.optionUntil) && <Field label="Option bis" error={f.errors.optionUntil} hint={tentative ? 'bis dahin wird das Zimmer freigehalten; danach erscheint die Reservierung als Aufgabe in der Übersicht' : 'nur bei vorläufigen Reservierungen von Bedeutung'}><input type="date" value={v.optionUntil} onChange={(e) => setV({ ...v, optionUntil: e.target.value })} /></Field>}
        <Field label="Interne Bemerkungen" wide error={f.errors.notes}><textarea rows={3} value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} /></Field>
      </div>
      {dirty && <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Angaben speichern</Button></div>}
    </form>
  );
}

/** Was der Gast über seinen Link mitgeteilt hat, die Stornobedingungen dieser Reservierung und der Link selbst. */
function GuestSide({ booking }: { booking: BookingDto }) {
  const toast = useToast();
  const terms = useLoad(() => api<CancelTerms>('GET', `/bookings/${booking.id}/cancel-terms`), [booking.id, booking.version]).data;
  const [link, setLink] = useState<GuestLinkDto | null>(null);
  const show = async () => { try { setLink(await api<GuestLinkDto>('GET', `/bookings/${booking.id}/guest-link`)); } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); } };
  const copy = async () => { try { await navigator.clipboard.writeText(link!.url); toast('Link kopiert'); } catch { toast('Kopieren nicht möglich – bitte den Link markieren', 'error'); } };
  const active = booking.rooms.some((r) => r.status === 'tentative' || r.status === 'confirmed');
  return (
    <>
      {(booking.arrivalTime || booking.guestMessage) && <p className="notice"><b>Vom Gast:</b> {booking.arrivalTime && `Ankunft voraussichtlich ${booking.arrivalTime} Uhr. `}{booking.guestMessage && `„${booking.guestMessage}“`}</p>}
      {terms?.enabled && active && <p className="muted small">Storno: {terms.free ? `kostenfrei bis einschließlich ${deDate(terms.freeUntil!)}` : `Frist abgelaufen (${deDate(terms.freeUntil!)}) – Ausfallgebühr laut Bedingungen ${formatMoney(terms.feeCents)} (${terms.feePercent} %)`}.</p>}
      {link ? (
        <div className="guestlink">
          <img src={link.qr} alt="QR-Code zum Gäste-Link" width={120} height={120} />
          <div><p><b>Link für den Gast</b> – Reservierung ansehen, Ankunftszeit mitteilen, stornieren. Zum Öffnen gibt der Gast seinen Nachnamen{booking.guest.zip ? ' und seine Postleitzahl' : ''} ein{booking.guest.zip ? '' : ' (eine Postleitzahl ist beim Gast nicht hinterlegt)'}:</p><p><code className="wrapcode">{link.url}</code></p>
            <p><Button onClick={() => void copy()}>Link kopieren</Button></p>
            {link.localOnly && <p className="muted small">Diese Adresse ist nur im Hausnetz erreichbar. Für Gäste zu Hause muss das Programm aus dem Internet erreichbar und die Adresse unter Einstellungen → Algorithmen → Storno eingetragen sein.</p>}</div>
        </div>
      ) : <p><button type="button" className="linkbtn" onClick={() => void show()}>Link für den Gast anzeigen</button></p>}
    </>
  );
}

function describe(h: AuditDto): string {
  const a = (h.after ?? {}) as Record<string, unknown>;
  const b = (h.before ?? {}) as Record<string, unknown>;
  const d = (s: unknown) => deShort(String(s));
  switch (h.action) {
    case 'create': return 'Reservierung angelegt';
    case 'update': return 'Angaben geändert';
    case 'room_add': return `Zimmer ${a.room} hinzugefügt (${d(a.from)} – ${d(a.to)})`;
    case 'room_update': {
      const parts: string[] = [];
      if (a.room !== b.room) parts.push(`Zimmer ${b.room} → ${a.room}`);
      if (a.from !== b.from || a.to !== b.to) parts.push(`${d(b.from)}–${d(b.to)} → ${d(a.from)}–${d(a.to)}`);
      if (a.adults !== b.adults || a.children !== b.children) parts.push('Personenzahl');
      if (a.lodgingCents !== b.lodgingCents) parts.push(`${formatMoney(b.lodgingCents as number)} → ${formatMoney(a.lodgingCents as number)}`);
      return `Zimmerbuchung geändert: ${parts.join(', ') || `Zimmer ${a.room}`}`;
    }
    case 'status': return `Zimmer ${a.room}: ${STATUS_LABEL[b.status as RoomStatus]} → ${STATUS_LABEL[a.status as RoomStatus]}${a.earlyDeparture ? ' (vorzeitige Abreise)' : ''}`;
    case 'charge_add': return `Leistung hinzugefügt: ${a.name}`;
    case 'charge_remove': return `Leistung entfernt: ${b.name}`;
    case 'mail': return `Bestätigung per E-Mail gesendet an ${a.to}`;
    case 'guest_form_link': return 'QR-Code für den Meldeschein erzeugt';
    case 'guest_form': return `Meldeschein vom Gast ausgefüllt${a.companions ? ` (${a.companions} mitreisende ${a.companions === 1 ? 'Person' : 'Personen'})` : ''}`;
    default: return h.action;
  }
}
