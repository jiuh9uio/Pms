import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isIsoDate } from '../shared/hotel.js';
import * as R from '../shared/restaurant.js';
import type { Db } from './db/client.js';
import type { Actor } from './modules/audit.js';
import { printerReady } from './modules/breakfast.js';
import * as outlook from './modules/outlook.js';
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

  // Ausblick: Gäste ohne Reservierung / früher gehen (Wetter, Fußball, Feiertage, eigene Einträge)
  api.get('/restaurant/outlook', user, (req) => outlook.outlook(db, z.object({ date: z.string().refine(isIsoDate) }).parse(req.query).date));
  api.get('/restaurant/outlook/settings', user, () => outlook.getOutlookSettings(db));
  api.put('/restaurant/outlook/settings', admin, (req) => outlook.saveOutlookSettings(db, actor(req), outlookSettingsInput.parse(req.body)));
  api.post('/restaurant/outlook/locate', admin, (req) => outlook.coordsFromLink(z.object({ url: z.string().trim().min(10, 'Bitte den Google-Maps-Link einfügen').max(2000) }).parse(req.body).url));
  api.get('/restaurant/events', user, (req) => outlook.listEvents(db, z.object({ from: z.string().refine(isIsoDate).optional() }).parse(req.query).from));
  api.post('/restaurant/events', user, (req) => outlook.addEvent(db, actor(req), outlookEventInput.parse(req.body)));
  api.delete('/restaurant/events/:id', user, (req) => outlook.deleteEvent(db, actor(req), z.object({ id: z.uuid() }).parse(req.params).id));
}
