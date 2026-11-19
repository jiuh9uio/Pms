import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { todayBerlin } from '../shared/hotel.js';
import { hasModule } from '../shared/schemas.js';
import * as V from '../shared/vouchers.js';
import type { Db } from './db/client.js';
import { AppError } from './lib/errors.js';
import type { Actor } from './modules/audit.js';
import * as vouchers from './modules/vouchers.js';

interface Ctx { db: Db; requireUser: (req: FastifyRequest) => Promise<void>; requireAdmin: (req: FastifyRequest) => Promise<void>; actor: (req: FastifyRequest) => Actor }
const idOf = (req: FastifyRequest) => z.object({ id: z.uuid() }).parse(req.params).id;
const versionOf = (req: FastifyRequest) => z.object({ version: z.number().int() }).parse(req.body).version;

/** Gutscheine – für alle mit Hotel oder Restaurant; Nummernkreis, Motive löschen und PIN anzeigen nur der Administrator. */
export function registerVoucherRoutes(api: FastifyInstance, { db, requireUser, requireAdmin, actor }: Ctx) {
  const user = { preHandler: async (req: FastifyRequest) => {
    await requireUser(req);
    if (!hasModule(req.user!, 'hotel') && !hasModule(req.user!, 'restaurant')) throw new AppError(403, 'forbidden', 'Für Gutscheine fehlt die Freigabe (Hotel oder Restaurant)');
  } };
  const admin = { preHandler: requireAdmin };

  api.get('/vouchers', user, () => vouchers.overview(db, todayBerlin()));
  api.post('/vouchers', user, (req) => vouchers.create(db, actor(req), V.voucherInput.parse(req.body)));
  api.put('/vouchers/:id', user, (req) => vouchers.update(db, actor(req), idOf(req), V.voucherInput.parse(req.body), versionOf(req)));
  api.post('/vouchers/:id/status', user, (req) => { const v = V.voucherStatusInput.parse(req.body); return vouchers.setStatus(db, actor(req), idOf(req), v.status, v.version); });
  api.post('/vouchers/:id/pin', admin, (req) => vouchers.revealPin(db, actor(req), idOf(req)));
  api.get('/vouchers/:id/pdf', user, async (req, reply) => {
    const f = await vouchers.pdf(db, actor(req), idOf(req));
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${f.filename}"`).header('Cache-Control', 'no-store').send(f.pdf);
  });
  api.get('/vouchers/:id/mail', user, (req) => vouchers.mailDraft(db, idOf(req)));
  api.post('/vouchers/:id/mail', user, (req) => vouchers.sendVoucherMail(db, actor(req), idOf(req), V.voucherMailInput.parse(req.body)));
  api.post('/vouchers/:id/invoice', user, (req) => vouchers.createInvoice(db, actor(req), idOf(req), V.voucherInvoiceInput.parse(req.body)));
  api.put('/voucher-numbering', admin, (req) => vouchers.saveNumbering(db, actor(req), V.voucherNumberingInput.parse(req.body)));

  api.post('/voucher-designs', { ...user, bodyLimit: 9 * 1024 * 1024 }, (req) => vouchers.addDesign(db, actor(req), V.voucherDesignInput.parse(req.body)));
  api.put('/voucher-designs/:id', user, (req) => vouchers.setDesignPos(db, actor(req), idOf(req), z.object({ textPos: z.enum(V.TEXT_POS) }).parse(req.body).textPos));
  api.post('/voucher-designs/:id/remove', admin, (req) => vouchers.removeDesign(db, actor(req), idOf(req)));
  // Design-Editor
  api.get('/voucher-designs/:id', user, (req) => vouchers.getDesign(db, idOf(req)));
  api.post('/voucher-designs/editor', { ...user, bodyLimit: 9 * 1024 * 1024 }, (req) => vouchers.saveDesign(db, actor(req), null, V.voucherDesignSave.parse(req.body)));
  api.put('/voucher-designs/:id/editor', { ...user, bodyLimit: 9 * 1024 * 1024 }, (req) => vouchers.saveDesign(db, actor(req), idOf(req), V.voucherDesignSave.parse(req.body)));
  api.get('/voucher-designs/:id/image', user, async (req, reply) => {
    const img = await vouchers.designImage(db, idOf(req));
    return reply.header('Content-Type', img.mime).header('Cache-Control', 'private, max-age=300').send(img.data);
  });
  api.get('/voucher-designs/:id/preview', user, async (req, reply) => {
    const f = await vouchers.designPreview(db, idOf(req));
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', 'inline; filename="Gutschein-Vorschau.pdf"').send(f.pdf);
  });
}
