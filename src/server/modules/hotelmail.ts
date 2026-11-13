import { formatMoney, isActiveStatus, STATUS_LABEL, type MailDraft } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { conflict } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { getBooking } from './bookings.js';
import { buildFromInvoice } from './einvoices.js';
import { getMailSettings, sendMail } from './mail.js';
import { getHotel } from './settings.js';

/** E-Mails aus dem Bereich „Hotel“: Buchungsbestätigung und Rechnung an den Gast. Der Text ist vor dem Senden änderbar. */

const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'rechnung';

async function ready(db: Exec) {
  const s = await getMailSettings(db);
  return s.enabled && !!s.host && !!s.user && s.hasPassword;
}
function greeting(g: { salutation: string; lastName: string }) {
  if (g.salutation === 'Herr') return `Sehr geehrter Herr ${g.lastName},`;
  if (g.salutation === 'Frau') return `Sehr geehrte Frau ${g.lastName},`;
  return 'Guten Tag,';
}
function signature(h: Awaited<ReturnType<typeof getHotel>>) {
  return ['Mit freundlichen Grüßen', h.name, [h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(', '), h.phone && `Telefon ${h.phone}`, h.website]
    .filter(Boolean).join('\n');
}

export async function bookingMailDraft(db: Exec, bookingId: string): Promise<MailDraft> {
  const [b, h] = [await getBooking(db, bookingId), await getHotel(db)];
  const rooms = b.rooms.filter((r) => isActiveStatus(r.status));
  if (rooms.length === 0) throw conflict('Die Reservierung enthält kein aktives Zimmer – eine Bestätigung ist nicht möglich');
  const tentative = rooms.some((r) => r.status === 'tentative');
  const lines = rooms.map((r) =>
    `- ${r.categoryName} (Zimmer ${r.roomNumber}): ${de(r.from)} bis ${de(r.to)}, ${r.nights} ${r.nights === 1 ? 'Nacht' : 'Nächte'}, ` +
    `${r.adults} ${r.adults === 1 ? 'Erwachsener' : 'Erwachsene'}${r.children ? `, ${r.children} ${r.children === 1 ? 'Kind' : 'Kinder'}` : ''} – ${formatMoney(r.lodgingCents)}` +
    (tentative ? ` (${STATUS_LABEL[r.status]})` : ''));
  const extras = b.charges.map((c) => `- ${c.quantity} × ${c.name} – ${formatMoney(c.totalCents)}`);
  const total = rooms.reduce((s, r) => s + r.lodgingCents, 0) + b.chargesCents;
  const text = [
    greeting(b.guest), '',
    tentative
      ? `vielen Dank für Ihre Anfrage. Wir haben Folgendes unter der Nummer ${b.number} für Sie vorgemerkt:`
      : `vielen Dank für Ihre Reservierung. Wir bestätigen Ihnen unter der Nummer ${b.number}:`,
    '', ...lines, ...(extras.length ? ['', 'Zusätzlich gebucht:', ...extras] : []),
    '', `Gesamtbetrag: ${formatMoney(total)} (inklusive Umsatzsteuer)`,
    '', `Anreise ab ${h.checkinTime} Uhr, Abreise bis ${h.checkoutTime} Uhr.`,
    '', 'Wir freuen uns auf Ihren Besuch.', '', signature(h),
  ].join('\n');
  return { to: b.guest.email, subject: `${tentative ? 'Ihre Anfrage' : 'Reservierungsbestätigung'} ${b.number} – ${h.name}`, text, attachment: null, ready: await ready(db) };
}

export async function sendBookingMail(db: Db, actor: Actor, bookingId: string, v: { to: string; subject: string; text: string }) {
  const b = await getBooking(db, bookingId);
  await sendMail(db, actor, v);
  await record(db, actor, { action: 'mail', entity: 'booking', entityId: b.id, after: { to: v.to, subject: v.subject } });
}

export type InvoiceMailKind = 'invoice' | 'reminder';

export async function invoiceMailDraft(db: Exec, invoiceId: string, kind: InvoiceMailKind = 'invoice'): Promise<MailDraft> {
  const { inv } = await buildFromInvoice(db, invoiceId);
  if (kind === 'reminder' && inv.openCents <= 0) throw conflict('Die Rechnung ist bereits bezahlt – eine Zahlungserinnerung ist nicht nötig');
  const h = await getHotel(db);
  const guest = inv.bookingId ? (await getBooking(db, inv.bookingId)).guest : null;
  if (kind === 'reminder') {
    const text = [
      guest ? greeting(guest) : 'Guten Tag,', '',
      `sicher ist es Ihrer Aufmerksamkeit entgangen: Für die Rechnung ${inv.number} vom ${de(inv.issueDate!)} über ${formatMoney(inv.grossCents)} ist noch ein Betrag von ${formatMoney(inv.openCents)} offen${inv.dueDate ? ` (fällig seit dem ${de(inv.dueDate)})` : ''}.`,
      '', 'Wir bitten Sie, den offenen Betrag in den nächsten Tagen unter Angabe der Rechnungsnummer zu überweisen.',
      inv.issuer?.iban ? `Bankverbindung: ${[inv.issuer.bankName, `IBAN ${inv.issuer.iban}`, inv.issuer.bic && `BIC ${inv.issuer.bic}`].filter(Boolean).join(', ')}` : '',
      '', 'Sollten Sie die Zahlung inzwischen veranlasst haben, betrachten Sie dieses Schreiben bitte als gegenstandslos. Die Rechnung liegt zur Erinnerung noch einmal bei.',
      '', signature(h),
    ].filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n');
    return { to: guest?.email ?? '', subject: `Zahlungserinnerung zur Rechnung ${inv.number} – ${h.name}`, text, attachment: `${safe(inv.number!)}.pdf`, ready: await ready(db) };
  }
  const text = [
    guest ? greeting(guest) : 'Guten Tag,', '',
    `anbei erhalten Sie die Rechnung ${inv.number} vom ${de(inv.issueDate!)} über ${formatMoney(inv.grossCents)}.`,
    inv.openCents > 0
      ? `Bitte überweisen Sie den offenen Betrag von ${formatMoney(inv.openCents)}${inv.dueDate ? ` bis zum ${de(inv.dueDate)}` : ''} unter Angabe der Rechnungsnummer.`
      : 'Der Betrag ist bereits beglichen – vielen Dank.',
    '', 'Die PDF-Datei enthält die Rechnungsdaten zusätzlich in maschinenlesbarer Form (ZUGFeRD).',
    '', signature(h),
  ].join('\n');
  return { to: guest?.email ?? '', subject: `Rechnung ${inv.number} – ${h.name}`, text, attachment: `${safe(inv.number!)}.pdf`, ready: await ready(db) };
}

export async function sendInvoiceMail(db: Db, actor: Actor, invoiceId: string, v: { to: string; subject: string; text: string }, kind: InvoiceMailKind = 'invoice') {
  const { inv, pdf } = await buildFromInvoice(db, invoiceId);
  if (kind === 'reminder' && inv.openCents <= 0) throw conflict('Die Rechnung ist bereits bezahlt – eine Zahlungserinnerung ist nicht nötig');
  await sendMail(db, actor, { ...v, attachments: [{ filename: `${safe(inv.number!)}.pdf`, content: Buffer.from(pdf), contentType: 'application/pdf' }] });
  await record(db, actor, { action: kind === 'reminder' ? 'reminder' : 'mail', entity: 'invoice', entityId: inv.id, after: { to: v.to, subject: v.subject } });
}
