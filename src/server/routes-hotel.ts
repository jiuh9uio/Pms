import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as H from '../shared/hotel.js';
import type { Db } from './db/client.js';
import { listAudit, type Actor } from './modules/audit.js';
import * as bookings from './modules/bookings.js';
import * as breakfast from './modules/breakfast.js';
import * as guestguide from './modules/guestguide.js';
import * as lookup from './modules/lookup.js';
import * as guestlink from './modules/guestlink.js';
import * as stats from './modules/stats.js';
import * as prearrival from './modules/prearrival.js';
import { cleanList, dayReport } from './modules/team.js';
import * as companies from './modules/companies.js';
import { networkInterfaces } from 'node:os';
import * as guestforms from './modules/guestforms.js';
import * as guests from './modules/guests.js';
import * as hotelmail from './modules/hotelmail.js';
import { yearReport } from './modules/reports.js';
import * as rooms from './modules/rooms.js';

interface Ctx {
  db: Db;
  requireUser: (req: FastifyRequest) => Promise<void>;
  requireAdmin: (req: FastifyRequest) => Promise<void>;
  actor: (req: FastifyRequest) => Actor;
}

const idOf = (req: FastifyRequest) => z.object({ id: z.uuid() }).parse(req.params).id;
const versionOf = (req: FastifyRequest) => z.object({ version: z.number().int() }).parse(req.body).version;
const range = z.object({ from: z.string().refine(H.isIsoDate), to: z.string().refine(H.isIsoDate) }).refine((v) => v.from < v.to, 'Ungültiger Zeitraum');

/**
 * Adresse, unter der ein Gast das PMS mit dem eigenen Gerät erreicht: PUBLIC_URL aus pms.env, sonst die Adresse,
 * die das Personal gerade benutzt. „localhost“ wird durch die Netzwerkadresse des Rechners ersetzt.
 */
function guestBaseUrl(req: FastifyRequest): { url: string; localOnly: boolean } {
  const fixed = (process.env.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  if (/^https?:\/\//.test(fixed)) return { url: fixed, localOnly: false };
  const u = new URL(`${req.protocol}://${req.headers.host ?? 'localhost'}`);
  if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) {
    const lan = Object.values(networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal);
    if (lan) u.hostname = lan.address;
  }
  return { url: u.origin, localOnly: true };
}

/** Phase 2: Zimmer, Preise, Gäste, Belegungsplan, Reservierungen. */
export function registerHotelRoutes(api: FastifyInstance, { db, requireUser, requireAdmin, actor }: Ctx) {
  const user = { preHandler: requireUser };
  const admin = { preHandler: requireAdmin };

  // ---------- Stammdaten: lesen alle, ändern nur Administrator ----------
  api.get('/categories', user, () => rooms.listCategories(db));
  api.post('/categories', admin, (req) => rooms.saveCategory(db, actor(req), null, H.categoryInput.parse(req.body)));
  api.put('/categories/:id', admin, (req) => rooms.saveCategory(db, actor(req), idOf(req), H.categoryInput.parse(req.body), versionOf(req)));
  api.delete('/categories/:id', admin, (req) => rooms.deleteCategory(db, actor(req), idOf(req)));

  api.get('/rooms', user, () => rooms.listRooms(db));
  api.post('/rooms/bulk', admin, (req) => rooms.createRoomsBulk(db, actor(req), H.roomBulkInput.parse(req.body)));
  api.post('/rooms', admin, (req) => rooms.saveRoom(db, actor(req), null, H.roomInput.parse(req.body)));
  api.put('/rooms/:id', admin, (req) => rooms.saveRoom(db, actor(req), idOf(req), H.roomInput.parse(req.body), versionOf(req)));
  api.delete('/rooms/:id', admin, (req) => rooms.deleteRoom(db, actor(req), idOf(req)));

  api.post('/rooms/:id/housekeeping', user, async (req) => {
    await rooms.setHousekeeping(db, actor(req), idOf(req), z.object({ status: z.enum(['clean', 'dirty']) }).parse(req.body).status);
    return { ok: true };
  });

  api.get('/rate-rules', user, () => rooms.listRateRules(db));
  api.post('/rate-rules', admin, (req) => rooms.saveRateRule(db, actor(req), null, H.rateRuleInput.parse(req.body)));
  api.put('/rate-rules/:id', admin, (req) => rooms.saveRateRule(db, actor(req), idOf(req), H.rateRuleInput.parse(req.body), versionOf(req)));
  api.delete('/rate-rules/:id', admin, (req) => rooms.deleteRateRule(db, actor(req), idOf(req)));

  api.get('/services', user, () => rooms.listServices(db));
  api.post('/services', admin, (req) => rooms.saveService(db, actor(req), null, H.serviceInput.parse(req.body)));
  api.put('/services/:id', admin, (req) => rooms.saveService(db, actor(req), idOf(req), H.serviceInput.parse(req.body), versionOf(req)));
  api.delete('/services/:id', admin, (req) => rooms.deleteService(db, actor(req), idOf(req)));

  // ---------- Belegungsplan, Verfügbarkeit, Preisauskunft ----------
  api.get('/calendar', user, (req) => {
    const q = z.object({ from: z.string().refine(H.isIsoDate), days: z.coerce.number().int().min(1).max(62) }).parse(req.query);
    return bookings.calendar(db, q.from, q.days);
  });
  api.get('/availability', user, async (req) => {
    const q = range.and(z.object({ exclude: z.uuid().optional(), companyId: z.uuid().optional() })).parse(req.query);
    const free = await rooms.freeRooms(db, q.from, q.to, q.exclude);
    // mit Preis für den angefragten Zeitraum, damit die Auswahl ohne weitere Anfragen auskommt
    const cats = new Map((await rooms.listCategories(db)).map((c) => [c.id, c]));
    return Promise.all(free.map(async (r) => {
      const nightly = await bookings.nightsFor(db, q.companyId ?? null, r.id, r.categoryId, q.from, q.to);
      const c = cats.get(r.categoryId);
      const fixed = nightly.some((n) => n.source.startsWith('Firmenpreis'));
      return {
        ...r, quoteCents: nightly.reduce((s, n) => s + n.priceCents, 0),
        pricing: fixed || !c ? null : { stdOccupancy: c.stdOccupancy, singleDiscountCents: c.singleDiscountCents, extraAdultCents: c.extraAdultCents, extraChildCents: c.extraChildCents },
      };
    }));
  });
  api.get('/quote', user, async (req) => {
    const q = range.and(z.object({ roomId: z.uuid() })).parse(req.query);
    const room = (await rooms.listRooms(db)).find((r) => r.id === q.roomId);
    if (!room) return { nightly: [], totalCents: 0 };
    const nightly = await rooms.priceNights(db, q.roomId, room.categoryId, q.from, q.to);
    return { nightly, totalCents: nightly.reduce((s, n) => s + n.priceCents, 0) };
  });

  // ---------- Sperren ----------
  api.post('/blocks', user, (req) => rooms.createBlock(db, actor(req), H.blockInput.parse(req.body)));
  api.put('/blocks/:id', user, (req) => rooms.updateBlock(db, actor(req), idOf(req), H.blockUpdateInput.parse(req.body)));
  api.post('/blocks/:id/remove', user, async (req) => {
    await rooms.removeBlock(db, actor(req), idOf(req));
    return { ok: true };
  });

  // ---------- Gäste ----------
  api.get('/guests', user, (req) => guests.listGuests(db, z.object({ q: z.string().max(100).default('') }).parse(req.query).q.trim()));
  api.get('/guests/duplicates', admin, () => guests.guestDuplicates(db));
  api.post('/guests/:id/merge', admin, (req) => guests.mergeGuests(db, actor(req), idOf(req), H.guestMergeInput.parse(req.body).otherId));
  api.get('/guests/:id', user, async (req) => ({ guest: await guests.getGuest(db, idOf(req)), bookings: await bookings.guestBookings(db, idOf(req)) }));
  api.post('/guests', user, (req) => db.transaction((tx) => guests.createGuest(tx, actor(req), H.guestInput.parse(req.body))));
  api.get('/guests/:id/export.json', admin, async (req, reply) => {
    reply.header('Content-Disposition', `attachment; filename="datenauskunft-${idOf(req).slice(0, 8)}.json"`);
    return guests.exportGuest(db, idOf(req));
  });
  api.post('/guests/:id/anonymize', admin, async (req) => {
    await guests.anonymizeGuest(db, actor(req), idOf(req));
    return { ok: true };
  });
  api.put('/guests/:id', user, (req) => guests.updateGuest(db, actor(req), idOf(req), H.guestInput.parse(req.body), versionOf(req)));

  // ---------- Firmen ----------
  api.get('/companies', user, (req) => companies.listCompanies(db, z.object({ q: z.string().max(100).default('') }).parse(req.query).q.trim()));
  // Adressdaten nachschlagen (auf Knopfdruck): Impressum der Website oder Ortssuche über OpenStreetMap
  api.post('/companies/lookup/imprint', user, (req) => lookup.fromImprint(z.object({ url: z.string().trim().min(4, 'Bitte die Adresse der Website eintragen').max(300) }).parse(req.body).url));
  api.get('/companies/lookup/search', user, (req) => lookup.searchPlace(z.object({ q: z.string().trim().min(3, 'Bitte mindestens 3 Zeichen eingeben').max(120) }).parse(req.query).q));
  api.get('/companies/:id', user, (req) => companies.getCompany(db, idOf(req)));
  api.post('/companies', user, (req) => companies.saveCompany(db, actor(req), null, H.companyInput.parse(req.body)));
  api.put('/companies/:id', user, (req) => companies.saveCompany(db, actor(req), idOf(req), H.companyInput.parse(req.body), versionOf(req)));

  // ---------- Reservierungen ----------
  api.get('/bookings', user, (req) => {
    const q = z.object({
      q: z.string().max(100).optional(), status: z.enum(['active', ...H.ROOM_STATUSES]).optional(),
      from: z.string().refine(H.isIsoDate).optional(), to: z.string().refine(H.isIsoDate).optional(),
    }).parse(req.query);
    return bookings.listBookings(db, q);
  });
  api.get('/bookings/:id', user, (req) => bookings.getBooking(db, idOf(req)));
  // ---------- Frühstücksliste und Küchendrucker ----------
  const dateOf = (v: unknown) => z.object({ date: z.string().refine(H.isIsoDate) }).parse(v).date;
  api.get('/breakfast', user, (req) => breakfast.breakfastList(db, dateOf(req.query)));
  api.get('/housekeeping', user, (req) => cleanList(db, dateOf(req.query)));
  api.get('/reports/day', user, (req) => dayReport(db, dateOf(req.query)));
  api.get('/breakfast/week', user, (req) => breakfast.breakfastWeek(db, dateOf(req.query)));
  api.post('/breakfast/print', user, (req) => breakfast.printBreakfast(db, actor(req), dateOf(req.body)));
  api.get('/settings/prearrival', admin, () => prearrival.prearrivalState(db));
  api.put('/settings/prearrival', admin, (req) => prearrival.savePrearrival(db, actor(req), H.prearrivalInput.parse(req.body)));
  api.get('/settings/breakfast-rules', admin, () => breakfast.getRules(db));
  api.put('/settings/breakfast-rules', admin, (req) => breakfast.saveRules(db, actor(req), H.breakfastRulesInput.parse(req.body)));
  api.get('/settings/kitchen-printer', admin, () => breakfast.getPrinter(db));
  api.put('/settings/kitchen-printer', admin, (req) => breakfast.savePrinter(db, actor(req), H.kitchenPrinterInput.parse(req.body)));
  api.post('/settings/kitchen-printer/test', admin, async () => { await breakfast.testPrint(db); return { ok: true }; });

  api.get('/reports/forecast', user, (req) => { const q = z.object({ from: z.string().refine(H.isIsoDate), days: z.coerce.number().int().min(1).max(92).default(30) }).parse(req.query); return stats.forecast(db, q.from, q.days); });
  api.get('/reports/origin', user, (req) => { const q = z.object({ year: z.coerce.number().int().min(2000).max(2100), month: z.coerce.number().int().min(1).max(12) }).parse(req.query); return stats.originStats(db, q.year, q.month); });
  api.get('/reports/sources', user, (req) => stats.sourceStats(db, z.object({ year: z.coerce.number().int().min(2000).max(2100) }).parse(req.query).year));
  api.get('/reports/year', user, (req) => yearReport(db, z.object({ year: z.coerce.number().int().min(2000).max(2100) }).parse(req.query).year));
  api.get('/settings/guest-guide', admin, () => guestguide.getGuide(db));
  api.put('/settings/guest-guide', admin, (req) => guestguide.saveGuide(db, actor(req), H.guestGuideInput.parse(req.body)));
  // Stornobedingungen und Gäste-Link
  api.get('/settings/cancel-policy', admin, () => guestlink.getPolicy(db));
  api.put('/settings/cancel-policy', admin, (req) => guestlink.savePolicy(db, actor(req), H.cancelPolicyInput.parse(req.body)));
  api.get('/bookings/:id/guest-link', user, (req) => { const base = guestBaseUrl(req); return guestlink.guestLink(db, idOf(req), base.url, base.localOnly); });
  api.post('/bookings/:id/guest-link', user, (req) => guestlink.linkAction(db, actor(req), idOf(req), H.guestLinkActionInput.parse(req.body).action));
  api.get('/bookings/:id/guest-link/mail', user, (req) => { const base = guestBaseUrl(req); return guestlink.linkMailDraft(db, idOf(req), base.url, base.localOnly); });
  api.post('/bookings/:id/guest-link/mail', user, (req) => hotelmail.sendBookingMail(db, actor(req), idOf(req), H.mailSendInput.parse(req.body)));
  api.get('/bookings/:id/cancel-terms', user, (req) => guestlink.termsFor(db, idOf(req)));
  api.get('/bookings/:id/guest-form', user, (req) => guestforms.formStatus(db, idOf(req)));
  api.post('/bookings/:id/guest-form', user, (req) => {
    const base = guestBaseUrl(req);
    return guestforms.createForm(db, actor(req), idOf(req), base.url, base.localOnly);
  });
  api.get('/bookings/:id/mail', user, (req) => hotelmail.bookingMailDraft(db, idOf(req)));
  api.post('/bookings/:id/mail', user, async (req) => {
    await hotelmail.sendBookingMail(db, actor(req), idOf(req), H.mailSendInput.parse(req.body));
    return { ok: true };
  });
  const mailKind = (req: FastifyRequest) => z.object({ kind: z.enum(['invoice', 'reminder']).default('invoice') }).parse(req.query).kind;
  api.get('/invoices/:id/mail', user, (req) => hotelmail.invoiceMailDraft(db, idOf(req), mailKind(req)));
  api.post('/invoices/:id/mail', user, async (req) => {
    await hotelmail.sendInvoiceMail(db, actor(req), idOf(req), H.mailSendInput.parse(req.body), mailKind(req));
    return { ok: true };
  });
  api.get('/bookings/:id/history', user, async (req) => (await listAudit(db, { entity: 'booking', entityId: idOf(req), limit: 200 })).items);
  api.post('/bookings', user, (req) => bookings.createBooking(db, actor(req), H.bookingCreateInput.parse(req.body)));
  api.patch('/bookings/:id', user, async (req) => {
    await bookings.updateBooking(db, actor(req), idOf(req), H.bookingUpdateInput.parse(req.body));
    return bookings.getBooking(db, idOf(req));
  });
  api.post('/bookings/:id/rooms', user, async (req) => {
    await bookings.addRoom(db, actor(req), idOf(req), H.bookingRoomInput.parse(req.body));
    return bookings.getBooking(db, idOf(req));
  });
  api.patch('/booking-rooms/:id', user, async (req) => {
    const r = await bookings.updateBookingRoom(db, actor(req), idOf(req), H.bookingRoomUpdateInput.parse(req.body));
    return bookings.getBooking(db, r.bookingId);
  });
  api.post('/booking-rooms/:id/status', user, async (req) => {
    const r = await bookings.setRoomStatus(db, actor(req), idOf(req), H.statusInput.parse(req.body));
    return bookings.getBooking(db, r.bookingId);
  });
  api.post('/bookings/:id/charges', user, async (req) => {
    await bookings.addCharge(db, actor(req), idOf(req), H.chargeInput.parse(req.body));
    return bookings.getBooking(db, idOf(req));
  });
  api.post('/charges/:id/remove', user, async (req) => {
    const r = await bookings.removeCharge(db, actor(req), idOf(req));
    return bookings.getBooking(db, r.bookingId);
  });

  api.get('/dashboard', user, () => bookings.dashboard(db));
}
