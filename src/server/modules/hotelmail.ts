import { cancelTerms, formatMoney, isActiveStatus, STATUS_LABEL, todayBerlin, type MailDraft } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { conflict } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { getBooking } from './bookings.js';
import { estimatePdf, getInvoice, invoicePdf } from './billing.js';
import { buildFromInvoice } from './einvoices.js';
import { lastRecipient, logInvoiceMailOut, withKvCode } from './invoicethread.js';
import { getMailSettings, sendMail } from './mail.js';
import { getHotel } from './settings.js';

/** E-Mails aus dem Bereich „Hotel“: Buchungsbestätigung und Rechnung an den Gast. Der Text ist vor dem Senden änderbar. */

async function issuedInvoice(db: Exec, id: string) {
  const inv = await getInvoice(db, id);
  if (inv.kind !== 'invoice' || inv.status !== 'issued' || !inv.number) throw conflict('Per E-Mail lassen sich nur ausgestellte, nicht stornierte Rechnungen senden');
  return inv;
}

const de = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const safe = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'rechnung';

export async function ready(db: Exec) {
  const s = await getMailSettings(db);
  return s.enabled && !!s.host && !!s.user && s.hasPassword;
}
export function greeting(g: { salutation: string; lastName: string }) {
  if (g.salutation === 'Herr') return `Sehr geehrter Herr ${g.lastName},`;
  if (g.salutation === 'Frau') return `Sehr geehrte Frau ${g.lastName},`;
  return 'Guten Tag,';
}
export function signature(h: Awaited<ReturnType<typeof getHotel>>) {
  return ['Mit freundlichen Grüßen', h.name, [h.street, [h.zip, h.city].filter(Boolean).join(' ')].filter(Boolean).join(', '), h.phone && `Telefon ${h.phone}`, h.website]
    .filter(Boolean).join('\n');
}

/** asConfirmed: Text einer Zusage, auch wenn die Zimmer noch vorläufig sind (Zusage wird erst beim Senden gebucht) */
export async function bookingMailDraft(db: Exec, bookingId: string, asConfirmed = false, roomIds: string[] = []): Promise<MailDraft> {
  const [b, h] = [await getBooking(db, bookingId), await getHotel(db)];
  const rooms = b.rooms.filter((r) => isActiveStatus(r.status) && (!roomIds.length || roomIds.includes(r.id)));
  if (rooms.length === 0) throw conflict('Die Reservierung enthält kein aktives Zimmer – eine Bestätigung ist nicht möglich');
  const tentative = !asConfirmed && rooms.some((r) => r.status === 'tentative');
  const lines = rooms.map((r) =>
    `- ${r.categoryName} (Zimmer ${r.roomNumber}): ${de(r.from)} bis ${de(r.to)}, ${r.nights} ${r.nights === 1 ? 'Nacht' : 'Nächte'}, ` +
    `${r.adults} ${r.adults === 1 ? 'Erwachsener' : 'Erwachsene'}${r.children ? `, ${r.children} ${r.children === 1 ? 'Kind' : 'Kinder'}` : ''} – ${formatMoney(r.lodgingCents)}` +
    (tentative ? ` (${STATUS_LABEL[r.status]})` : ''));
  // nur Leistungen der genannten Zimmer (und solche ohne Zimmerbezug) – nicht die stornierter oder nicht gewählter Zimmer
  const shown = b.charges.filter((c) => !c.bookingRoomId || rooms.some((r) => r.id === c.bookingRoomId));
  const extras = shown.map((c) => `- ${c.quantity} × ${c.name} – ${formatMoney(c.totalCents)}`);
  const total = rooms.reduce((s, r) => s + r.lodgingCents, 0) + shown.reduce((s, c) => s + c.totalCents, 0);
  // Stornobedingungen und persönlicher Link (der Link nur, wenn das Programm aus dem Internet erreichbar ist)
  const { getPolicy, mailLink } = await import('./guestlink.js');
  const terms = cancelTerms(await getPolicy(db), rooms.map((r) => r.from).sort()[0]!, rooms.reduce((s, r) => s + r.lodgingCents, 0), todayBerlin());
  const link = await mailLink(db, b.id);
  const text = [
    greeting(b.guest), '',
    tentative
      ? `vielen Dank für Ihre Anfrage. Wir haben Folgendes unter der Nummer ${b.number} für Sie vorgemerkt:`
      : `vielen Dank für Ihre Reservierung. Wir bestätigen Ihnen unter der Nummer ${b.number}:`,
    '', ...lines, ...(extras.length ? ['', 'Zusätzlich gebucht:', ...extras] : []),
    '', `Gesamtbetrag: ${formatMoney(total)} (inklusive Umsatzsteuer)`,
    '', `Anreise ab ${h.checkinTime} Uhr, Abreise bis ${h.checkoutTime} Uhr.`,
    ...(terms.enabled ? ['', terms.text] : []),
    ...(await (await import('./guestguide.js')).guideMailLines(db)),
    ...(link ? ['', `Ihre Reservierung ansehen, Ankunftszeit mitteilen oder stornieren: ${link}`, 'Zum Öffnen geben Sie Ihren Nachnamen und Ihre Postleitzahl ein.'] : []),
    '', 'Wir freuen uns auf Ihren Besuch.', '', signature(h),
  ].join('\n');
  return { to: b.guest.email, subject: `${tentative ? 'Ihre Anfrage' : 'Reservierungsbestätigung'} ${b.number} – ${h.name}`, text, attachment: null, ready: await ready(db) };
}

/** Entwürfe zu einer Reservierung: Absage einer Anfrage, Stornobestätigung (bestimmte Zimmer) und Rückfrage an den Gast. */
export async function statusMailDraft(db: Exec, bookingId: string, kind: 'declined' | 'cancelled' | 'question', roomIds: string[] = []): Promise<MailDraft> {
  const [b, h] = [await getBooking(db, bookingId), await getHotel(db)];
  const chosen = roomIds.length ? b.rooms.filter((r) => roomIds.includes(r.id)) : b.rooms.filter((r) => isActiveStatus(r.status));
  const rooms = chosen.length ? chosen : b.rooms;
  const from = rooms.map((r) => r.from).sort()[0]!, to = rooms.map((r) => r.to).sort().at(-1)!;
  const lines = rooms.map((r) => `- ${r.categoryName}: ${de(r.from)} bis ${de(r.to)}, ${r.nights} ${r.nights === 1 ? 'Nacht' : 'Nächte'}, ${r.adults} ${r.adults === 1 ? 'Erwachsener' : 'Erwachsene'}${r.children ? `, ${r.children} ${r.children === 1 ? 'Kind' : 'Kinder'}` : ''}`);
  const body = {
    declined: [`vielen Dank für Ihre Anfrage (Nr. ${b.number}) und Ihr Interesse an unserem Haus.`, '',
      `Leider können wir Ihnen für den Zeitraum vom ${de(from)} bis ${de(to)} kein passendes Zimmer anbieten. Das bedauern wir sehr.`, '',
      'Wir würden uns freuen, Sie zu einem anderen Zeitpunkt bei uns begrüßen zu dürfen.'],
    cancelled: [`hiermit bestätigen wir die Stornierung Ihrer Reservierung Nr. ${b.number}:`, '', ...lines, '',
      'Wir würden uns freuen, Sie zu einem anderen Zeitpunkt bei uns begrüßen zu dürfen.'],
    question: [`vielen Dank für Ihre Anfrage (Nr. ${b.number}) für den Zeitraum vom ${de(from)} bis ${de(to)}.`, '',
      'Damit wir Ihre Reservierung bearbeiten können, benötigen wir noch folgende Angaben:', '', '- ', '',
      'Antworten Sie einfach auf diese E-Mail oder rufen Sie uns an. Vielen Dank!'],
  }[kind];
  const subject = { declined: `Ihre Anfrage ${b.number}`, cancelled: `Stornierung Ihrer Reservierung ${b.number}`, question: `Rückfrage zu Ihrer Anfrage ${b.number}` }[kind];
  return { to: b.guest.email, subject: `${subject} – ${h.name}`, text: [greeting(b.guest), '', ...body, '', signature(h)].join('\n'), attachment: null, ready: await ready(db) };
}

export async function sendBookingMail(db: Db, actor: Actor, bookingId: string, v: { to: string; subject: string; text: string }) {
  const b = await getBooking(db, bookingId);
  await sendMail(db, actor, v);
  await record(db, actor, { action: 'mail', entity: 'booking', entityId: b.id, after: { to: v.to, subject: v.subject } });
}

export type InvoiceMailKind = 'invoice' | 'reminder';

export async function invoiceMailDraft(db: Exec, invoiceId: string, kind: InvoiceMailKind = 'invoice'): Promise<MailDraft> {
  const inv = await issuedInvoice(db, invoiceId);
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
    '', signature(h),
  ].join('\n');
  return { to: guest?.email || await lastRecipient(db, invoiceId), subject: `Rechnung ${inv.number} – ${h.name}`, text, attachment: `${safe(inv.number!)}.pdf`, ready: await ready(db) };
}

export async function sendInvoiceMail(db: Db, actor: Actor, invoiceId: string, v: { to: string; subject: string; text: string }, kind: InvoiceMailKind = 'invoice') {
  const inv = await issuedInvoice(db, invoiceId);
  if (kind === 'reminder' && inv.openCents <= 0) throw conflict('Die Rechnung ist bereits bezahlt – eine Zahlungserinnerung ist nicht nötig');
  // mit eingebetteten E-Rechnungsdaten, wo das möglich ist; sonst das archivierte PDF
  const pdf = await buildFromInvoice(db, invoiceId).then((r) => r.pdf, async () => (await invoicePdf(db, invoiceId)).pdf);
  await sendMail(db, actor, { ...v, attachments: [{ filename: `${safe(inv.number!)}.pdf`, content: Buffer.from(pdf), contentType: 'application/pdf' }] });
  await logInvoiceMailOut(db, invoiceId, kind === 'reminder' ? 'reminder' : 'invoice', actor, v.to, v.subject, v.text);
  await record(db, actor, { action: kind === 'reminder' ? 'reminder' : 'mail', entity: 'invoice', entityId: inv.id, after: { to: v.to, subject: v.subject } });
}

// ---------- Kostenvoranschlag (Rechnungsentwurf mit KV-Nummer) per E-Mail ----------
export async function estimateMailDraft(db: Db, invoiceId: string): Promise<MailDraft> {
  const inv = await getInvoice(db, invoiceId);
  const f = await estimatePdf(db, invoiceId);
  const h = await getHotel(db);
  const guest = inv.bookingId ? (await getBooking(db, inv.bookingId)).guest : null;
  const text = [guest ? greeting(guest) : 'Guten Tag,', '',
    `anbei erhalten Sie unseren Kostenvoranschlag ${f.number} über ${formatMoney(inv.grossCents)} (inkl. Umsatzsteuer).`,
    'Dies ist noch keine Rechnung – bitte überweisen Sie noch nichts.', '',
    'Sind Sie einverstanden? Dann antworten Sie bitte einfach auf diese E-Mail mit „Ja“. Wenn nicht, antworten Sie mit „Nein“ – oder schreiben Sie uns, was wir ändern sollen.',
    `(Bitte den Betreff mit der Nummer ${f.number} stehen lassen, damit wir Ihre Antwort zuordnen können.)`,
    '', signature(h)].join('\n');
  return { to: guest?.email || await lastRecipient(db, invoiceId), subject: `Kostenvoranschlag ${f.number} – ${h.name}`, text, attachment: f.filename, ready: await ready(db) };
}
export async function sendEstimateMail(db: Db, actor: Actor, invoiceId: string, v: { to: string; subject: string; text: string }) {
  const f = await estimatePdf(db, invoiceId);
  const subject = withKvCode(v.subject, f.number);
  await sendMail(db, actor, { ...v, subject, attachments: [{ filename: f.filename, content: f.pdf, contentType: 'application/pdf' }] });
  await logInvoiceMailOut(db, invoiceId, 'estimate', actor, v.to, subject, v.text);
  await record(db, actor, { action: 'mail_estimate', entity: 'invoice', entityId: invoiceId, after: { to: v.to, subject: v.subject, estimateNumber: f.number } });
}
