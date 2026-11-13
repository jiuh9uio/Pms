import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as E from '../shared/einvoice.js';
import type { Db } from './db/client.js';
import type { Actor } from './modules/audit.js';
import * as einv from './modules/einvoices.js';
import * as mail from './modules/mail.js';

interface Ctx {
  db: Db;
  requireUser: (req: FastifyRequest) => Promise<void>;
  requireAdmin: (req: FastifyRequest) => Promise<void>;
  actor: (req: FastifyRequest) => Actor;
}
const idOf = (req: FastifyRequest) => z.object({ id: z.uuid() }).parse(req.params).id;

/** Bereich „E-Rechnung“: PDF-Rechnungen in ZUGFeRD/Factur-X umwandeln, herunterladen und per E-Mail versenden. */
export function registerEInvoiceRoutes(api: FastifyInstance, { db, requireUser, requireAdmin, actor }: Ctx) {
  const user = { preHandler: requireUser };
  const admin = { preHandler: requireAdmin };

  api.get('/einvoices', user, () => einv.listEInvoices(db));
  api.get('/einvoices/defaults', user, () => einv.defaults(db));
  api.post('/einvoices/from-invoice/:id', user, (req) => einv.fromInvoice(db, actor(req), idOf(req)));
  // PDF-Datei kommt Base64-kodiert im JSON – daher eine höhere Größengrenze nur für diese Adresse
  api.post('/einvoices/upload', { ...user, bodyLimit: 15 * 1024 * 1024 }, (req) => einv.fromUpload(db, actor(req), E.einvoiceUploadInput.parse(req.body)));
  for (const kind of ['pdf', 'xml'] as const)
    api.get(`/einvoices/:id/${kind}`, user, async (req, reply) => {
      const f = await einv.getFile(db, idOf(req), kind);
      return reply.header('Content-Type', f.type).header('Content-Disposition', `attachment; filename="${f.filename}"`).send(f.content);
    });
  api.post('/einvoices/:id/send', user, async (req) => {
    await einv.sendEInvoice(db, actor(req), idOf(req), E.einvoiceSendInput.parse(req.body));
    return { ok: true };
  });
  api.post('/einvoices/:id/remove', user, async (req) => {
    await einv.removeEInvoice(db, actor(req), idOf(req));
    return { ok: true };
  });
  api.get('/mail/status', user, async () => {
    const s = await mail.getMailSettings(db);
    return { ready: s.enabled && !!s.host && !!s.user && s.hasPassword, from: s.user };
  });

  // E-Mail-Zugang: nur Administrator
  api.get('/settings/mail', admin, () => mail.getMailSettings(db));
  api.put('/settings/mail', admin, (req) => mail.saveMailSettings(db, actor(req), E.mailSettingsInput.parse(req.body)));
  api.post('/settings/mail/test', admin, async (req) => {
    const { to } = z.object({ to: z.email('Ungültige E-Mail-Adresse') }).parse(req.body);
    await mail.sendMail(db, actor(req), { to, subject: 'Test aus dem Schützenhaus PMS', text: 'Diese Nachricht bestätigt, dass der E-Mail-Versand eingerichtet ist.' });
    return { ok: true };
  });
}
