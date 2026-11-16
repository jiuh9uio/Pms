import { eq } from 'drizzle-orm';
import { CHECKIN_SHEET_DEFAULTS, type CheckinSheet, type CheckinSheetDto } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { settings } from '../db/schema.js';
import { record, type Actor } from './audit.js';
import { isActiveStatus } from '../../shared/hotel.js';
import { columns, wrap, type Line } from '../lib/escpos.js';
import { getBooking } from './bookings.js';
import { getWifi, wifiQrText } from './network.js';
import { bonTarget, printLines } from './quickprint.js';
import { getHotel } from './settings.js';
import { guestLink } from './guestlink.js';

/** Check-in-Blatt: Meldeschein mit abtrennbaren Gästeinformationen (WLAN mit QR-Code, Frühstück, Zimmerreinigung …). */
export async function getCheckinSheet(db: Exec): Promise<CheckinSheet> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'checkin_sheet'));
  if (row) return { ...CHECKIN_SHEET_DEFAULTS, ...(row.value as Partial<CheckinSheet>) };
  // noch nie gespeichert: Vorschlag aus den Hotel-Einstellungen (Frühstückszeiten, Abreise, Öffnungszeiten)
  const h = await getHotel(db);
  const info = [
    `Frühstück | ${h.breakfastTimes || '7:00 – 10:00 Uhr'}`,
    'Zimmerreinigung | täglich zwischen 10:00 und 14:00 Uhr – bitte Schild „Bitte nicht stören“ an die Tür hängen, wenn Sie keine Reinigung wünschen',
    `Abreise | bitte bis ${h.checkoutTime || '11:00'} Uhr das Zimmer freigeben`,
    ...(h.openingHours ? [`Restaurant | ${h.openingHours.split('\n').map((x) => x.trim()).filter(Boolean).join(' · ')}`] : []),
    `Rezeption | ${h.phone ? `bei Fragen einfach anrufen: ${h.phone}` : 'bei Fragen einfach anrufen oder vorbeikommen'}`,
  ].join('\n');
  return { ...CHECKIN_SHEET_DEFAULTS, info };
}
export async function saveCheckinSheet(db: Db, actor: Actor, v: CheckinSheet) {
  await db.insert(settings).values({ key: 'checkin_sheet', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'checkin_sheet', after: v });
  return getCheckinSheet(db);
}
/** Für den Druck: Zeilen aufbereitet, WLAN nur, wenn eingeschaltet und eingerichtet. */
export async function checkinSheetForPrint(db: Exec): Promise<CheckinSheetDto> {
  const s = await getCheckinSheet(db);
  const lines = s.info.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12).map((l) => {
    const i = l.indexOf('|');
    return i < 0 ? { label: '', value: l } : { label: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
  });
  let wifi: CheckinSheetDto['wifi'] = null;
  if (s.showWifi) {
    const w = await getWifi(db);
    if (w.qr) wifi = { ssid: w.ssid, password: w.open ? '' : w.password, open: w.open, qr: w.qr };
  }
  const bon = await bonTarget(db);
  return { ...s, lines, wifi, bonPrinter: bon?.name ?? null };
}

const deDay = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const center = (text: string, w: number, o: { bold?: boolean; big?: boolean } = {}): Line[] => wrap(text, o.big ? Math.floor(w / 2) : w).map((t) => ({ text: t, align: 'center' as const, ...o }));

/**
 * Meldeschein auf dem Bondrucker: Bon 1 = Meldeschein zum Unterschreiben (bleibt im Haus), Bon 2 = Gästeinformationen (WLAN mit QR-Code, Hausinfos).
 * Leere Angaben erscheinen als Linie zum Ausfüllen von Hand.
 */
export async function printCheckinBon(db: Db, actor: Actor, bookingId: string, base?: { url: string; localOnly: boolean }) {
  const [b, h, sheet] = await Promise.all([getBooking(db, bookingId), getHotel(db), checkinSheetForPrint(db)]);
  const link = sheet.showGuestLink && base ? await guestLink(db, bookingId, base.url, base.localOnly) : null;
  const g = b.guest;
  const rooms = b.rooms.filter((r) => isActiveStatus(r.status));
  const from = rooms.map((r) => r.from).sort()[0], to = rooms.map((r) => r.to).sort().at(-1);
  const persons = rooms.reduce((n, r) => n + r.adults + r.children, 0);
  const roomNo = rooms.map((r) => r.roomNumber).join(', ');
  const field = (label: string, value: string | null | undefined, w: number): Line[] => value
    ? [{ text: label }, ...wrap(value, w - 2).map((t) => ({ text: `  ${t}`, bold: true }))]
    : [{ text: label }, { feed: 1 }, { text: '_'.repeat(w) }];
  const address = [h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  await printLines(db, (w) => [
    ...center(h.name, w, { bold: true }), ...(address ? center(address, w) : []), { rule: true },
    ...center('MELDESCHEIN', w, { bold: true, big: true }), { feed: 1 },
    { text: columns('Ankunft', from ? deDay(from) : '', w) }, { text: columns('Abreise (voraussichtl.)', to ? deDay(to) : '', w) },
    { text: columns('Zimmer', roomNo, w) }, { text: columns('Reservierung', b.number, w) }, { rule: true },
    ...field('Familienname', g.lastName, w), ...field('Vornamen', g.firstName, w), ...field('Geburtsdatum', g.birthdate ? deDay(g.birthdate) : '', w),
    ...field('Staatsangehörigkeit', g.nationality, w), ...field('Straße und Hausnummer', g.street, w), ...field('PLZ, Ort', [g.zip, g.city].filter(Boolean).join(' '), w),
    ...field('Staat', g.country, w), ...field('Pass-/Ausweisnummer (ausländ. Gäste)', g.idNumber, w),
    ...field('Mitreisende Personen', persons > 1 ? String(persons - 1) : '', w),
    { feed: 2 }, { text: '_'.repeat(w) }, { text: 'Ort, Datum' }, { feed: 3 }, { text: '_'.repeat(w) }, { text: 'Unterschrift des Gastes' }, { feed: 1 },
  ]);
  let guest = false;
  if (sheet.showInfo && (sheet.wifi || sheet.lines.length || sheet.title || (link && !link.blocked))) {
    guest = true;
    const wifi = sheet.wifi;
    await printLines(db, (w) => [
      ...center(h.name, w, { bold: true }), { rule: true },
      ...(sheet.title ? [...center(sheet.title, w, { bold: true, big: true }), { feed: 1 } as Line] : []),
      ...(roomNo ? center(`Ihr Zimmer: ${roomNo}`, w, { bold: true }) : []), { feed: 1 },
      ...(wifi ? [{ text: 'WLAN', align: 'center', bold: true } as Line, { qr: wifiQrText({ ssid: wifi.ssid, password: wifi.password, open: wifi.open, note: '' }), size: 6 } as Line,
        ...center(`Netz: ${wifi.ssid}`, w, { bold: true }), ...center(wifi.open ? 'ohne Passwort' : `Passwort: ${wifi.password}`, w, { bold: true }),
        ...center('QR-Code mit der Handykamera scannen', w), { rule: true } as Line] : []),
      ...(link && !link.blocked ? [{ text: 'Ihre Buchung online', align: 'center', bold: true } as Line, { qr: link.url, size: 5 } as Line,
        ...center(sheet.guestLinkText, w), ...center(`Zum Öffnen: Ihr Nachname${link.needsZip ? ' und Ihre Postleitzahl' : ''}`, w), { rule: true } as Line] : []),
      ...sheet.lines.flatMap((l): Line[] => l.label ? [{ text: l.label, bold: true }, ...wrap(l.value, w - 2).map((t) => ({ text: `  ${t}` })), { feed: 1 }] : [...wrap(l.value, w).map((t) => ({ text: t })), { feed: 1 }]),
      ...(sheet.closing ? [{ rule: true } as Line, ...center(sheet.closing, w, { bold: true })] : []),
    ]);
  }
  await record(db, actor, { action: 'print', entity: 'booking', entityId: bookingId, after: { meldeschein: 'Bondrucker', gaesteinfo: guest } });
  return { ok: true, guestSlip: guest };
}
