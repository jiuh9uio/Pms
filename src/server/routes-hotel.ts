import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as H from '../shared/hotel.js';
import type { Db } from './db/client.js';
import { listAudit, type Actor } from './modules/audit.js';
import * as bookings from './modules/bookings.js';
import * as guests from './modules/guests.js';
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

/** Phase 2: Zimmer, Preise, Gäste, Belegungsplan, Reservierungen. */
export function registerHotelRoutes(api: FastifyInstance, { db, requireUser, requireAdmin, actor }: Ctx) {
  const user = { preHandler: requireUser };
  const admin = { preHandler: requireAdmin };

  // ---------- Stammdaten: lesen alle, ändern nur Administrator ----------
  api.get('/categories', user, () => rooms.listCategories(db));
  api.post('/categories', admin, (req) => rooms.saveCategory(db, actor(req), null, H.categoryInput.parse(req.body)));
  api.put('/categories/:id', admin, (req) => rooms.saveCategory(db, actor(req), idOf(req), H.categoryInput.parse(req.body), versionOf(req)));

  api.get('/rooms', user, () => rooms.listRooms(db));
  api.post('/rooms', admin, (req) => rooms.saveRoom(db, actor(req), null, H.roomInput.parse(req.body)));
  api.put('/rooms/:id', admin, (req) => rooms.saveRoom(db, actor(req), idOf(req), H.roomInput.parse(req.body), versionOf(req)));

  api.get('/rate-rules', user, () => rooms.listRateRules(db));
  api.post('/rate-rules', admin, (req) => rooms.saveRateRule(db, actor(req), null, H.rateRuleInput.parse(req.body)));
  api.put('/rate-rules/:id', admin, (req) => rooms.saveRateRule(db, actor(req), idOf(req), H.rateRuleInput.parse(req.body), versionOf(req)));

  api.get('/services', user, () => rooms.listServices(db));
  api.post('/services', admin, (req) => rooms.saveService(db, actor(req), null, H.serviceInput.parse(req.body)));
  api.put('/services/:id', admin, (req) => rooms.saveService(db, actor(req), idOf(req), H.serviceInput.parse(req.body), versionOf(req)));

  // ---------- Belegungsplan, Verfügbarkeit, Preisauskunft ----------
  api.get('/calendar', user, (req) => {
    const q = z.object({ from: z.string().refine(H.isIsoDate), days: z.coerce.number().int().min(1).max(62) }).parse(req.query);
    return bookings.calendar(db, q.from, q.days);
  });
  api.get('/availability', user, async (req) => {
    const q = range.and(z.object({ exclude: z.uuid().optional() })).parse(req.query);
    const free = await rooms.freeRooms(db, q.from, q.to, q.exclude);
    // mit Preis für den angefragten Zeitraum, damit die Auswahl ohne weitere Anfragen auskommt
    return Promise.all(free.map(async (r) => ({
      ...r, quoteCents: (await rooms.priceNights(db, r.id, r.categoryId, q.from, q.to)).reduce((s, n) => s + n.priceCents, 0),
    })));
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
  api.get('/guests/:id', user, async (req) => ({ guest: await guests.getGuest(db, idOf(req)), bookings: await bookings.guestBookings(db, idOf(req)) }));
  api.post('/guests', user, (req) => db.transaction((tx) => guests.createGuest(tx, actor(req), H.guestInput.parse(req.body))));
  api.put('/guests/:id', user, (req) => guests.updateGuest(db, actor(req), idOf(req), H.guestInput.parse(req.body), versionOf(req)));

  // ---------- Reservierungen ----------
  api.get('/bookings', user, (req) => {
    const q = z.object({
      q: z.string().max(100).optional(), status: z.enum(['active', ...H.ROOM_STATUSES]).optional(),
      from: z.string().refine(H.isIsoDate).optional(), to: z.string().refine(H.isIsoDate).optional(),
    }).parse(req.query);
    return bookings.listBookings(db, q);
  });
  api.get('/bookings/:id', user, (req) => bookings.getBooking(db, idOf(req)));
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
