import { useEffect, useState } from 'react';
import type { AuditDto, TaxRateDto } from '../../../src/shared/schemas.js';
import {
  isActiveStatus,
  PAYMENT_METHODS, SOURCES, STATUS_LABEL, addDays, bookingRoomInput, bookingRoomUpdateInput, bookingUpdateInput, chargeInput, diffDays, formatMoney,
  guestInput, isIsoDate, moneyInput, parseMoney, todayBerlin,
  type BookingDto, type BookingRoomDto, type CheckinSheetDto, type CancelTerms, type GuestLinkDto, type FreeRoomDto, type RoomStatus, type ServiceDto,
} from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import type { BookingBillingDto } from '../../../src/shared/billing.js';
import { BookingBilling } from '../billing/BookingBilling.tsx';
import { SettleDialog } from '../billing/SettleDialog.tsx';
import { CompanySelect } from './CompanySelect.tsx';
import { GuestFormDialog } from './GuestFormDialog.tsx';
import { MailDialog } from './MailDialog.tsx';
import { useAuth } from '../App.tsx';
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
  const billing = useLoad(() => api<BookingBillingDto>('GET', `/bookings/${id}/billing`), [id, rev]).data;
  const [paying, setPaying] = useState(false);
  const today = todayBerlin();
  const active = b ? b.rooms.filter((r) => isActiveStatus(r.status)) : [];
  // offen ist, was die Reservierung noch kostet – oder was auf ausgestellten Rechnungen noch fehlt
  const openOnInvoices = billing ? billing.invoices.filter((i) => i.status === 'issued' && i.kind === 'invoice').reduce((x, i) => x + Math.max(0, i.openCents), 0) : 0;
  const toPay = b && billing ? Math.max(b.totalCents - billing.paidCents, openOnInvoices, 0) : 0;
  const needsPay = !!billing && (toPay > 0 || billing.uninvoicedCents > 0);
  const toCheckin = active.find((r) => r.status === 'confirmed' && r.from <= today);
  const toCheckout = active.find((r) => r.status === 'checked_in' && r.to <= today);
  const inHouse = active.some((r) => r.status === 'checked_in');
  const from = active.map((r) => r.from).sort()[0], to = active.map((r) => r.to).sort().at(-1);
  const nights = from && to ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) : 0;
  const pax = active.reduce((n, r) => n + r.adults + r.children, 0);
  // Was als Nächstes zu tun ist – ein großer Knopf
  const next = !b || !billing ? null
    : toCheckin ? { label: 'Check-in', run: () => setSub({ kind: 'checkin', room: toCheckin }) }
    : needsPay && (inHouse || active.some((r) => r.status === 'checked_out')) ? { label: `Bezahlen · ${formatMoney(toPay)}`, run: () => setPaying(true) }
    : toCheckout ? { label: 'Check-out', run: () => setSub({ kind: 'checkout', room: toCheckout }) }
    : null;
  const state = !b ? '' : active.length === 0 ? 'Storniert'
    : active.every((r) => r.status === 'checked_out') ? (needsPay ? 'Abgereist – noch offen' : 'Abgeschlossen')
    : inHouse ? (needsPay ? 'Im Haus' : `Im Haus · bezahlt${to ? ` – Check-out am ${deDate(to)} automatisch` : ''}`)
    : active.some((r) => r.status === 'tentative') ? 'Vorläufig' : (from && from > today ? 'Anreise erwartet' : 'Anreise heute');
  return (
    <Dialog title={b ? <>Reservierung {b.number}</> : 'Reservierung'} onClose={onClose} size="xl"
      footer={<>{b && <a className="btn" href={`/meldeschein/${b.id}`} target="_blank" rel="noopener">Meldeschein drucken</a>}{b && <Button onClick={() => setQr(true)}>Meldeschein per QR</Button>}{b && <Button onClick={() => setMail(true)}>Bestätigung per E-Mail</Button>}<Button onClick={onClose}>Schließen</Button></>}>
      {!b ? <LoadState error={error} loading /> : (
        <div className="bk">
          <section className="bk-hero">
            <div className="bk-guest">
              <div className="bk-name">{guestName || '(ohne Namen)'}{b.guest.company && <small> · {b.guest.company}</small>}</div>
              <div className="bk-contact">{[b.guest.phone, b.guest.email].filter(Boolean).join(' · ') || 'Keine Kontaktdaten'}</div>
              <div className="bk-contact">{[b.guest.street, [b.guest.zip, b.guest.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Noch keine Anschrift'}</div>
              <div className="btnrow"><Button onClick={() => openGuest(b.guest.id)}>Gästeprofil</Button></div>
            </div>
            <div className="bk-facts">
              <span><small>Anreise</small>{deDate(from)}</span><span><small>Abreise</small>{deDate(to)}</span>
              <span><small>Nächte</small>{nights}</span><span><small>Zimmer</small>{active.map((r) => r.roomNumber).join(', ') || '–'}</span>
              <span><small>Personen</small>{pax}</span>
              <span className="bk-state"><small>Stand</small>{state}</span>
            </div>
            <div className="bk-act">
              {next && <Button variant="primary" onClick={next.run}>{next.label}</Button>}
              {next?.label === 'Check-in' && needsPay && <Button onClick={() => setPaying(true)}>Gleich bezahlen</Button>}
              {!next && needsPay && <Button onClick={() => setPaying(true)}>Bezahlen · {formatMoney(toPay)}</Button>}
              <small className="muted">{b && billing ? `Gesamt ${formatMoney(b.totalCents)}${toPay > 0 ? ` · offen ${formatMoney(toPay)}` : ' · bezahlt'}` : ''}</small>
            </div>
          </section>

          <h3>Zimmer</h3>
          {b.rooms.map((r) => (
            <RoomCard key={r.id} room={r} busy={busy === r.id} onStatus={setStatus}
              onCheckin={() => setSub({ kind: 'checkin', room: r })} onCheckout={() => setSub({ kind: 'checkout', room: r })} onEdit={() => setSub({ kind: 'edit', room: r })} />
          ))}
          <p><Button onClick={() => setSub({ kind: 'add' })}>+ Weiteres Zimmer</Button></p>

          <details className="bk-more"><summary>Frühstück und Leistungen{b.chargesCents ? ` · ${formatMoney(b.chargesCents)}` : ''}</summary><div><Charges booking={b} /></div></details>
          <details className="bk-more"><summary>Rechnungen und Zahlungen{billing ? ` · ${billing.invoices.filter((i) => i.status === 'issued').length} Rechnung(en), ${billing.payments.length} Zahlung(en)` : ''}</summary>
            <div>
              <table className="sums"><tbody>
                <tr><td>Übernachtung</td><td className="num">{formatMoney(b.lodgingCents)}</td></tr>
                <tr><td>Frühstück und Leistungen</td><td className="num">{formatMoney(b.chargesCents)}</td></tr>
                <tr className="sum"><td>Gesamt (brutto)</td><td className="num">{formatMoney(b.totalCents)}</td></tr>
              </tbody></table>
              <BookingBilling booking={b} />
            </div>
          </details>
          <details className="bk-more"><summary>Angaben zur Buchung (Quelle, Zahlungsart, Bemerkungen)</summary><div><Meta booking={b} /></div></details>
          <details className="bk-more"><summary>Verlauf</summary><div>
            <ul className="history">
              {history.data?.map((h) => <li key={h.id}><span>{describe(h)}</span><small>{fmtDateTime(h.at)} · {h.userName}</small></li>)}
            </ul>
          </div></details>
        </div>
      )}
      {b && qr && <GuestFormDialog bookingId={b.id} number={b.number} onClose={() => { setQr(false); bump(); }} />}
      {b && mail && <MailDialog path={`/bookings/${b.id}/mail`} title={`Bestätigung zu Reservierung ${b.number}`} onClose={() => setMail(false)} onSent={bump} />}
      {b && sub?.kind === 'checkin' && <Checkin booking={b} room={sub.room} onClose={() => setSub(null)} onPay={needsPay ? () => { setSub(null); setPaying(true); } : undefined} />}
      {b && sub?.kind === 'checkout' && <Checkout booking={b} room={sub.room} onClose={() => setSub(null)} />}
      {b && sub?.kind === 'edit' && <RoomForm booking={b} room={sub.room} onClose={() => setSub(null)} />}
      {b && sub?.kind === 'add' && <RoomForm booking={b} room={null} onClose={() => setSub(null)} />}
      {b && paying && <SettleDialog booking={b} onClose={() => { setPaying(false); bump(); }} />}
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
function Checkin({ booking, room, onClose, onPay }: { booking: BookingDto; room: BookingRoomDto; onClose: () => void; onPay?: () => void }) {
  const { bump } = useData();
  const toast = useToast();
  const [v, setV] = useState<GuestDraft>(toDraft(booking.guest));
  const [roomId, setRoomId] = useState(room.roomId);
  const [done, setDone] = useState<string | null>(null);
  const free = useLoad(() => api<FreeRoomDto[]>('GET', `/availability?from=${room.from}&to=${room.to}&exclude=${room.allocationId}`));
  const sheet = useLoad(() => api<CheckinSheetDto>('GET', '/checkin-sheet').catch(() => null));
  const [bonBusy, setBonBusy] = useState(false);
  const printBon = async () => {
    setBonBusy(true);
    try { const r = await api<{ guestSlip: boolean }>('POST', `/bookings/${booking.id}/registration/bon`, {}); toast(r.guestSlip ? 'Meldeschein und Gästeinformationen gedruckt' : 'Meldeschein gedruckt'); onClose(); }
    catch (e) { toast(e instanceof Error ? e.message : 'Druck fehlgeschlagen', 'error'); }
    setBonBusy(false);
  };
  const f = useSubmit(guestInput, async (d) => {
    if (JSON.stringify(toDraft(d as never)) !== JSON.stringify(toDraft(booking.guest)))
      await api('PUT', `/guests/${booking.guest.id}`, { ...d, version: booking.guest.version });
    let version = room.version;
    if (roomId !== room.roomId) {
      const moved = await api<BookingDto>('PATCH', `/booking-rooms/${room.id}`, { roomId, version });
      version = moved.rooms.find((r) => r.id === room.id)!.version;
    }
    await api('POST', `/booking-rooms/${room.id}/status`, { status: 'checked_in', version });
    const who = [d.firstName, d.lastName].filter(Boolean).join(' ');
    bump();
    if (sheet.data?.askAfterCheckin ?? true) setDone(who);
    else { toast(`${who} ist eingecheckt`); onClose(); }
  });
  if (done !== null) {
    const sh = sheet.data;
    const info = sh?.showInfo ? [sh.wifi ? 'WLAN-Zugang mit QR-Code' : '', sh.lines.length ? 'Hausinformationen' : ''].filter(Boolean) : [];
    const bonFirst = sh?.printMode === 'bon' && !!sh.bonPrinter;
    const a4 = <a key="a4" className={`btn${bonFirst ? '' : ' primary'}`} href={`/meldeschein/${booking.id}?druck=1`} target="_blank" rel="noopener" onClick={() => setTimeout(onClose, 300)}>A4 drucken</a>;
    const bon = sh?.bonPrinter ? <Button key="bon" variant={bonFirst ? 'primary' : undefined} busy={bonBusy} onClick={() => void printBon()}>Bon drucken</Button> : null;
    return (
      <Dialog title="Eingecheckt" onClose={onClose}
        footer={<>{onPay && <Button onClick={onPay}>Weiter zum Bezahlen</Button>}<Button onClick={onClose}>Nicht drucken</Button>{bonFirst ? <>{a4}{bon}</> : <>{bon}{a4}</>}</>}>
        <div className="ci-done">
          <div className="ci-done-mark" aria-hidden>✓</div>
          <p><b>{done || 'Der Gast'}</b> ist in Zimmer <b>{free.data?.find((r) => r.id === roomId)?.number ?? room.roomNumber}</b> eingecheckt.</p>
          <p className="muted">Meldeschein jetzt drucken und unterschreiben lassen?{info.length ? ` Dazu für den Gast: ${info.join(' und ')}.` : ''}</p>
          {sh?.bonPrinter
            ? <p className="muted small">A4: ein Blatt, die Gästeinformationen unten zum Abtrennen. Bondrucker ({sh.bonPrinter}): zwei Bons – Meldeschein zum Unterschreiben und Gästeinformationen zum Mitgeben.</p>
            : <p className="muted small">Für den Druck auf dem Bondrucker ist noch keiner eingerichtet (Einstellungen → Geräte → Drucker).</p>}
        </div>
      </Dialog>
    );
  }
  const future = room.from > todayBerlin();
  const target = free.data?.find((r) => r.id === roomId);
  const name = [v.salutation, v.firstName, v.lastName].filter(Boolean).join(' ') || 'Gast';
  const checks: [string, boolean][] = [
    ['Name', !!v.lastName.trim()], ['Anschrift', !!(v.street.trim() && v.zip.trim() && v.city.trim())], ['Geburtsdatum', !!v.birthdate],
    ['Staatsangehörigkeit', !!v.nationality.trim()], ['Kontakt', !!(v.email.trim() || v.phone.trim())],
  ];
  return (
    <Dialog title="Check-in" onClose={onClose} size="xl"
      footer={<><span className="left muted small">{checks.every(([, ok]) => ok) ? 'Alle Angaben vorhanden.' : `Noch offen: ${checks.filter(([, ok]) => !ok).map(([l]) => l).join(', ')} – einchecken geht trotzdem.`}</span>
        <Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} disabled={future} onClick={() => void f.submit(v)}>Anreise bestätigen</Button></>}>
      {future && <p className="notice warn">Die Anreise ist erst am {deDate(room.from)}. Bei früherer Anreise bitte zuerst über „Ändern“ das Anreisedatum anpassen.</p>}
      <form onSubmit={(e) => void f.submit(v, e)} noValidate className="checkin">
        <div className="ci-summary">
          <div className="ci-room"><small>Zimmer</small><b>{target?.number ?? room.roomNumber}</b><span>{target?.categoryName ?? room.categoryName}</span></div>
          <div className="ci-facts">
            <div className="ci-guest">{name}{booking.companyName && <small> · {booking.companyName}</small>}</div>
            <div className="ci-line">
              <span><small>Anreise</small>{deDate(room.from)}</span><span><small>Abreise</small>{deDate(room.to)}</span>
              <span><small>Nächte</small>{room.nights}</span><span><small>Personen</small>{persons(room.adults, room.children)}</span>
              <span><small>Reservierung</small>{booking.number}</span>
            </div>
            {(booking.arrivalTime || booking.guestMessage) && <p className="ci-note">{booking.arrivalTime && <>Ankunft laut Gast: <b>{booking.arrivalTime}</b>. </>}{booking.guestMessage && <>Nachricht: „{booking.guestMessage}“</>}</p>}
          </div>
          <label className="ci-change"><small>Anderes Zimmer zuweisen</small>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} aria-label="Zimmer">
              {(free.data ?? [{ id: room.roomId, number: room.roomNumber, categoryName: room.categoryName }]).map((r) => <option key={r.id} value={r.id}>{r.number} – {r.categoryName}{r.id === room.roomId ? ' (reserviert)' : ''}</option>)}
            </select>
          </label>
        </div>
        <div className="ci-checks" aria-label="Vollständigkeit der Gastdaten">
          {checks.map(([label, ok]) => <span key={label} className={`ci-chip ${ok ? 'ok' : 'miss'}`}>{ok ? '✓' : '!'} {label}</span>)}
        </div>
        <GuestFields value={v} onChange={setV} errors={f.errors} grouped />
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
      {early && <p className="notice warn">Vorzeitige Abreise: geplant war der {deDate(room.to)}. Der Aufenthalt endet am {deDate(end)}, {diffDays(end, room.to)} Nacht/Nächte entfallen und das Zimmer wird ab dann frei. Ist schon eine Rechnung ausgestellt oder alles bezahlt, passt sie danach nicht mehr: bitte die Rechnung stornieren, neu ausstellen und zu viel Bezahltes erstatten.</p>}
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
    <>
    {/* außerhalb des Formulars: das Fenster „Gäste-Link“ enthält ein eigenes Formular (E-Mail) */}
    <GuestSide booking={booking} />
    <form onSubmit={(e) => void f.submit({ ...v, companyId: v.companyId || null, version: booking.version }, e)} noValidate>
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
    </>
  );
}

/** Was der Gast über seinen Link mitgeteilt hat, die Stornobedingungen dieser Reservierung und der Link selbst. */
function GuestSide({ booking }: { booking: BookingDto }) {
  const terms = useLoad(() => api<CancelTerms>('GET', `/bookings/${booking.id}/cancel-terms`), [booking.id, booking.version]).data;
  const [win, setWin] = useState(false);
  const active = booking.rooms.some((r) => r.status === 'tentative' || r.status === 'confirmed');
  return (
    <>
      {(booking.arrivalTime || booking.guestMessage) && <p className="notice"><b>Vom Gast:</b> {booking.arrivalTime && `Ankunft voraussichtlich ${booking.arrivalTime} Uhr. `}{booking.guestMessage && `„${booking.guestMessage}“`}</p>}
      {terms?.enabled && active && <p className="muted small">Storno: {terms.free ? `kostenfrei bis einschließlich ${deDate(terms.freeUntil!)}` : `Frist abgelaufen (${deDate(terms.freeUntil!)}) – Ausfallgebühr laut Bedingungen ${formatMoney(terms.feeCents)} (${terms.feePercent} %)`}.</p>}
      <p><Button onClick={() => setWin(true)}>Gäste-Link</Button> <span className="muted small">Link erstellen, senden, sperren oder neu ausstellen</span></p>
      {win && <GuestLinkWindow booking={booking} onClose={() => setWin(false)} />}
    </>
  );
}

/** Fenster „Gäste-Link“: Link mit QR-Code, Kopieren, per E-Mail senden, sperren, neu ausstellen. */
function GuestLinkWindow({ booking, onClose }: { booking: BookingDto; onClose: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const [rev, setRev] = useState(0);
  const { data: link, error } = useLoad(() => api<GuestLinkDto>('GET', `/bookings/${booking.id}/guest-link`), [rev]);
  const [mail, setMail] = useState(false);
  const [busy, setBusy] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(link!.url); toast('Link kopiert'); } catch { toast('Kopieren nicht möglich – bitte den Link markieren', 'error'); } };
  const act = async (action: 'block' | 'unblock' | 'renew', ask: string, done: string) => {
    if (!window.confirm(ask)) return;
    setBusy(true);
    try { await api('POST', `/bookings/${booking.id}/guest-link`, { action }); toast(done); setRev(rev + 1); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  return (
    <Dialog title={`Gäste-Link – Reservierung ${booking.number}`} onClose={onClose} size="lg" footer={<Button onClick={onClose}>Schließen</Button>}>
      {!link ? <LoadState error={error} loading /> : (
        <>
          {link.blocked && <p className="notice danger"><b>Der Link ist gesperrt.</b> Der Gast sieht damit nichts und kann nichts ändern, bis Sie ihn wieder freigeben oder neu ausstellen.</p>}
          <div className="guestlink">
            <img src={link.qr} alt="QR-Code zum Gäste-Link" width={150} height={150} />
            <div>
              <p><code className="wrapcode">{link.url}</code></p>
              <p className="muted small">Zum Öffnen gibt der Gast seinen Nachnamen{link.needsZip ? ' und seine Postleitzahl' : ''} ein{link.needsZip ? '' : ' – eine Postleitzahl ist bei ihm nicht hinterlegt; tragen Sie sie beim Gast ein, wenn sie verlangt werden soll'}.</p>
              {link.localOnly && <p className="notice warn">Diese Adresse ist nur im Hausnetz erreichbar. Für Gäste zu Hause muss das Programm aus dem Internet erreichbar und die Adresse unter Einstellungen → Algorithmen → Storno eingetragen sein.</p>}
            </div>
          </div>
          <div className="formactions">
            <Button variant="primary" disabled={link.blocked} onClick={() => void copy()}>Link kopieren</Button>
            <Button disabled={link.blocked} onClick={() => setMail(true)}>Per E-Mail senden</Button>
            <a className="btn" href={link.url} target="_blank" rel="noreferrer">Seite ansehen</a>
          </div>
          {!link.guestEmail && <p className="muted small">Beim Gast ist keine E-Mail-Adresse hinterlegt – sie lässt sich im Sendefenster eintragen.</p>}
          <h3>Wenn es ein Problem gibt</h3>
          <div className="formactions">
            {link.blocked
              ? <Button busy={busy} onClick={() => void act('unblock', 'Link wieder freigeben?', 'Link freigegeben')}>Wieder freigeben</Button>
              : <Button busy={busy} onClick={() => void act('block', 'Link sperren? Der Gast kann seine Reservierung dann nicht mehr öffnen.', 'Link gesperrt')}>Link sperren</Button>}
            <Button variant="danger" busy={busy} onClick={() => void act('renew', 'Neuen Link ausstellen?\n\nDer bisherige Link funktioniert danach nicht mehr – auch nicht der in bereits verschickten E-Mails. Den neuen müssen Sie dem Gast erneut schicken.', 'Neuer Link ausgestellt')}>Neuen Link ausstellen</Button>
          </div>
          <p className="muted small">Sperren: wenn der Link in falsche Hände geraten sein könnte oder der Gast nichts mehr selbst ändern soll. Neu ausstellen: macht den alten Link endgültig ungültig{link.version > 0 ? ` (bisher ${link.version}-mal neu ausgestellt)` : ''}. Nach acht falschen Eingaben von Name und Postleitzahl sperrt sich der Link von selbst für 15 Minuten; Sperren oder Neu-Ausstellen hebt das sofort auf.
            {user.role === 'admin' ? ' Was der Gast auf der Seite sieht, stellen Sie unter Einstellungen → Algorithmen → Storno ein.' : ' Was der Gast auf der Seite sieht, legt der Administrator fest.'}</p>
          {mail && <MailDialog path={`/bookings/${booking.id}/guest-link/mail`} title="Gäste-Link per E-Mail senden" onClose={() => setMail(false)} />}
        </>
      )}
    </Dialog>
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
    case 'mail': return a.automatic === 'prearrival' ? `Nachricht vor der Anreise gesendet an ${a.to}` : `E-Mail gesendet an ${a.to}${a.subject ? ` („${a.subject}“)` : ''}`;
    case 'guest_link_block': return 'Gäste-Link gesperrt';
    case 'guest_link_unblock': return 'Gäste-Link wieder freigegeben';
    case 'guest_link_renew': return 'Neuen Gäste-Link ausgestellt (der alte gilt nicht mehr)';
    case 'guest_arrival': return `Gast über seinen Link: ${a.arrivalTime ? `Ankunft voraussichtlich ${a.arrivalTime} Uhr` : 'Nachricht hinterlassen'}`;
    case 'guest_cancel': return `Vom Gast über seinen Link storniert${a.free ? ' (kostenfrei)' : a.feeCents ? ` – Ausfallgebühr laut Bedingungen ${formatMoney(a.feeCents as number)}` : ''}`;
    case 'guest_form_link': return 'QR-Code für den Meldeschein erzeugt';
    case 'guest_form': return `Meldeschein vom Gast ausgefüllt${a.companions ? ` (${a.companions} mitreisende ${a.companions === 1 ? 'Person' : 'Personen'})` : ''}`;
    default: return h.action;
  }
}
