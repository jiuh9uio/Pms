import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isIsoDate } from '../shared/hotel.js';
import * as R from '../shared/restaurant.js';
import type { Db } from './db/client.js';
import type { Actor } from './modules/audit.js';
import { printerReady } from './modules/breakfast.js';
import * as outlook from './modules/outlook.js';
import * as deposits from './modules/deposits.js';
import { depositCreateInput, depositDraftQuery, depositPaidInput } from '../shared/deposits.js';
import * as restaurant from './modules/restaurant.js';
import { outlookEventInput, outlookSettingsInput } from '../shared/outlook.js';

interface Ctx { db: Db; requireUser: (req: FastifyRequest) => Promise<void>; requireAdmin: (req: FastifyRequest) => Promise<void>; actor: (req: FastifyRequest) => Actor }
const idOf = (req: FastifyRequest) => z.object({ id: z.uuid() }).parse(req.params).id;

/** Bereich „Restaurant“: Tische (einrichten darf nur der Administrator) und Tischreservierungen. */
export function registerRestaurantRoutes(api: FastifyInstance, { db, requireUser, requireAdmin, actor }: Ctx) {
  const user = { preHandler: requireUser };
  const admin = { preHandler: requireAdmin };
  api.get('/restaurant/tables', user, () => restaurant.listTables(db));
  api.post('/restaurant/tables', admin, (req) => restaurant.saveTable(db, actor(req), null, R.restaurantTableInput.parse(req.body)));
  api.put('/restaurant/tables/:id', admin, (req) =>
    restaurant.saveTable(db, actor(req), idOf(req), R.restaurantTableInput.parse(req.body), z.object({ version: z.number().int() }).parse(req.body).version));
  api.get('/restaurant/reservations', user, (req) => restaurant.listReservations(db, z.object({ date: z.string().refine(isIsoDate) }).parse(req.query).date));
  api.get('/restaurant/printer', user, async () => ({ ready: await printerReady(db) }));
  api.post('/restaurant/reservations/print', user, (req) => restaurant.printReservations(db, actor(req), z.object({ date: z.string().refine(isIsoDate) }).parse(req.body).date));
  api.post('/restaurant/reservations', user, (req) => restaurant.createReservation(db, actor(req), R.tableReservationInput.parse(req.body)));
  api.put('/restaurant/reservations/:id', user, (req) => restaurant.updateReservation(db, actor(req), idOf(req), R.tableReservationUpdateInput.parse(req.body)));
  api.post('/restaurant/reservations/:id/status', user, (req) => {
    const v = R.tableStatusInput.parse(req.body);
    return restaurant.setStatus(db, actor(req), idOf(req), v.status, v.version);
  });

  // Anzahlung für Tischreservierungen (Eingang wird von Hand vermerkt)
  api.get('/restaurant/reservations/:id/deposits', user, (req) => deposits.listFor(db, 'table', idOf(req)));
  api.get('/restaurant/reservations/:id/deposits/draft', user, (req) => { const q = depositDraftQuery.parse(req.query); return deposits.draft(db, 'table', idOf(req), q.amountCents, q.dueDate); });
  api.post('/restaurant/reservations/:id/deposits', user, (req) => deposits.create(db, actor(req), 'table', idOf(req), depositCreateInput.parse(req.body)));
  api.post('/restaurant/deposits/:id/paid', user, (req) => deposits.markPaid(db, actor(req), idOf(req), depositPaidInput.parse(req.body).note));
  api.post('/restaurant/deposits/:id/cancel', user, (req) => deposits.cancel(db, actor(req), idOf(req)));
  api.get('/restaurant/deposits', user, async (req) => {
    const d = z.object({ date: z.string().refine(isIsoDate) }).parse(req.query).date;
    const ids = (await restaurant.listReservations(db, d)).map((r) => r.id);
    return deposits.forTables(db, ids);
  });
  api.get('/restaurant/deposits/overdue', user, () => deposits.overdue(db, 'table'));
  // Ausblick: Gäste ohne Reservierung / früher gehen (Wetter, Fußball, Feiertage, eigene Einträge)
  api.get('/restaurant/outlook', user, (req) => outlook.outlook(db, z.object({ date: z.string().refine(isIsoDate) }).parse(req.query).date));
  api.get('/restaurant/outlook/settings', user, () => outlook.getOutlookSettings(db));
  api.put('/restaurant/outlook/settings', admin, (req) => outlook.saveOutlookSettings(db, actor(req), outlookSettingsInput.parse(req.body)));
  api.post('/restaurant/outlook/locate', admin, (req) => outlook.coordsFromLink(z.object({ url: z.string().trim().min(10, 'Bitte den Google-Maps-Link einfügen').max(2000) }).parse(req.body).url));
  api.get('/restaurant/events', user, (req) => outlook.listEvents(db, z.object({ from: z.string().refine(isIsoDate).optional() }).parse(req.query).from));
  api.post('/restaurant/events', user, (req) => outlook.addEvent(db, actor(req), outlookEventInput.parse(req.body)));
  api.delete('/restaurant/events/:id', user, (req) => outlook.deleteEvent(db, actor(req), z.object({ id: z.uuid() }).parse(req.params).id));
}
