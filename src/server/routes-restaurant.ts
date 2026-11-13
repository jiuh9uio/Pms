import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { isIsoDate } from '../shared/hotel.js';
import * as R from '../shared/restaurant.js';
import type { Db } from './db/client.js';
import type { Actor } from './modules/audit.js';
import * as restaurant from './modules/restaurant.js';

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
  api.post('/restaurant/reservations', user, (req) => restaurant.createReservation(db, actor(req), R.tableReservationInput.parse(req.body)));
  api.put('/restaurant/reservations/:id', user, (req) => restaurant.updateReservation(db, actor(req), idOf(req), R.tableReservationUpdateInput.parse(req.body)));
  api.post('/restaurant/reservations/:id/status', user, (req) => {
    const v = R.tableStatusInput.parse(req.body);
    return restaurant.setStatus(db, actor(req), idOf(req), v.status, v.version);
  });
}
