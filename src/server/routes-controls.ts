import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as C from '../shared/controls.js';
import { isIsoDate } from '../shared/hotel.js';
import type { Db } from './db/client.js';
import type { Actor } from './modules/audit.js';
import * as controls from './modules/controls.js';

interface Ctx {
  db: Db;
  requireUser: (req: FastifyRequest) => Promise<void>;
  requireAdmin: (req: FastifyRequest) => Promise<void>;
  actor: (req: FastifyRequest) => Actor;
}
const idOf = (req: FastifyRequest) => z.object({ id: z.uuid() }).parse(req.params).id;
const versionOf = (req: FastifyRequest) => z.object({ version: z.number().int() }).parse(req.body).version;

/** Kontrollen: Arten, Unterlagen, Besuche und die Temperatur-Eigenkontrolle. Einrichten darf nur der Administrator. */
export function registerControlRoutes(api: FastifyInstance, { db, requireUser, requireAdmin, actor }: Ctx) {
  const user = { preHandler: requireUser };
  const admin = { preHandler: requireAdmin };

  api.get('/inspection-types', user, () => controls.listTypes(db));
  api.get('/inspection-types/:id', user, (req) => controls.getType(db, idOf(req)));
  api.post('/inspection-types', admin, (req) => controls.saveType(db, actor(req), null, C.inspectionTypeInput.parse(req.body)));
  api.put('/inspection-types/:id', admin, (req) => controls.saveType(db, actor(req), idOf(req), C.inspectionTypeInput.parse(req.body), versionOf(req)));

  api.post('/inspection-types/:id/items', admin, async (req) => {
    await controls.addItem(db, actor(req), idOf(req), C.inspectionItemInput.parse(req.body).text);
    return controls.getType(db, idOf(req));
  });
  api.put('/inspection-items/:id', user, async (req) => {
    const r = await controls.updateItem(db, actor(req), idOf(req), C.inspectionItemUpdateInput.parse(req.body));
    return controls.getType(db, r.typeId);
  });
  api.post('/inspection-items/:id/remove', admin, async (req) => {
    const r = await controls.removeItem(db, actor(req), idOf(req));
    return controls.getType(db, r.typeId);
  });
  api.post('/inspection-types/:id/visits', user, async (req) => {
    await controls.addVisit(db, actor(req), idOf(req), C.inspectionVisitInput.parse(req.body));
    return controls.getType(db, idOf(req));
  });

  api.get('/hygiene/areas', user, () => controls.listAreas(db));
  api.post('/hygiene/areas', admin, (req) => controls.saveArea(db, actor(req), null, C.hygieneAreaInput.parse(req.body)));
  api.put('/hygiene/areas/:id', admin, (req) => controls.saveArea(db, actor(req), idOf(req), C.hygieneAreaInput.parse(req.body), versionOf(req)));
  api.post('/hygiene/points', admin, (req) => controls.savePoint(db, actor(req), null, C.hygienePointInput.parse(req.body)));
  api.put('/hygiene/points/:id', admin, (req) => controls.savePoint(db, actor(req), idOf(req), C.hygienePointInput.parse(req.body), versionOf(req)));
  api.get('/hygiene/readings', user, (req) => {
    const q = z.object({ from: z.string().refine(isIsoDate), to: z.string().refine(isIsoDate) }).parse(req.query);
    return controls.listReadings(db, q.from, q.to);
  });
  api.put('/hygiene/readings', user, (req) => controls.saveReadings(db, actor(req), C.hygieneReadingsInput.parse(req.body).entries));
}
