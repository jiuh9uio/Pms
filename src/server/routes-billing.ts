import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import * as B from '../shared/billing.js';
import { isIsoDate } from '../shared/hotel.js';
import type { Db } from './db/client.js';
import type { Actor } from './modules/audit.js';
import * as billing from './modules/billing.js';
import * as terminal from './modules/terminal.js';

interface Ctx { db: Db; requireUser: (req: FastifyRequest) => Promise<void>; requireAdmin: (req: FastifyRequest) => Promise<void>; actor: (req: FastifyRequest) => Actor }
const idOf = (req: FastifyRequest) => z.object({ id: z.uuid() }).parse(req.params).id;
const range = z.object({ from: z.string().refine(isIsoDate, 'Ungültiges Datum'), to: z.string().refine(isIsoDate, 'Ungültiges Datum') });
const csv = (reply: FastifyReply, name: string, body: string) =>
  reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="${name}"`).send(body);

/** Abrechnung – gehört zum Bereich „Hotel“. */
export function registerBillingRoutes(api: FastifyInstance, { db, requireUser, requireAdmin, actor }: Ctx) {
  const user = { preHandler: requireUser };
  const admin = { preHandler: requireAdmin };

  api.get('/invoices', user, (req) => {
    const q = z.object({
      status: z.enum(['open', 'paid', 'draft', 'issued', 'cancelled', 'archive']).optional(), q: z.string().max(100).optional(),
      from: z.string().refine(isIsoDate).optional(), to: z.string().refine(isIsoDate).optional(),
      serviceFrom: z.string().refine(isIsoDate).optional(), serviceTo: z.string().refine(isIsoDate).optional(), method: z.enum(B.PAYMENT_METHODS_BILLING).optional(),
    }).parse(req.query);
    return billing.listInvoices(db, q);
  });
  api.get('/invoices/summary', user, () => billing.openSummary(db));
  api.get('/invoices/export.csv', user, async (req, reply) => {
    const q = range.parse(req.query);
    return csv(reply, `rechnungen_${q.from}_${q.to}.csv`, await billing.exportCsv(db, q.from, q.to));
  });
  api.get('/payments/export.csv', user, async (req, reply) => {
    const q = range.parse(req.query);
    return csv(reply, `zahlungen_${q.from}_${q.to}.csv`, await billing.exportPaymentsCsv(db, q.from, q.to));
  });
  api.get('/invoices/:id', user, (req) => billing.getInvoice(db, idOf(req)));
  api.post('/invoices', user, (req) => billing.createInvoice(db, actor(req), B.invoiceCreateInput.parse(req.body)));
  api.put('/invoices/:id', user, async (req) => {
    await billing.updateDraft(db, actor(req), idOf(req), B.invoiceUpdateInput.parse(req.body));
    return billing.getInvoice(db, idOf(req));
  });
  api.post('/invoices/:id/lines', user, async (req) => {
    await billing.addLine(db, actor(req), idOf(req), B.invoiceLineInput.parse(req.body));
    return billing.getInvoice(db, idOf(req));
  });
  api.post('/invoice-lines/:id/remove', user, async (req) => billing.getInvoice(db, (await billing.removeLine(db, actor(req), idOf(req))).invoiceId));
  api.post('/invoices/:id/remove', user, async (req) => {
    await billing.deleteDraft(db, actor(req), idOf(req));
    return { ok: true };
  });
  api.post('/invoices/:id/issue', user, async (req) => {
    await billing.issueInvoice(db, actor(req), idOf(req), z.object({ version: z.number().int() }).parse(req.body).version);
    // Archivkopie sofort anlegen; schlägt das fehl, wird sie beim ersten Abruf erzeugt
    await billing.invoicePdf(db, idOf(req)).catch((e) => req.log.error(e));
    return billing.getInvoice(db, idOf(req));
  });
  // Stornieren darf nur der Administrator
  api.post('/invoices/:id/cancel', admin, async (req) => {
    const r = await billing.cancelInvoice(db, actor(req), idOf(req), B.cancelInput.parse(req.body).reason);
    await billing.invoicePdf(db, r.id).catch((e) => req.log.error(e));
    return r;
  });
  api.get('/invoices/:id/pdf', user, async (req, reply) => {
    const f = await billing.invoicePdf(db, idOf(req));
    const download = z.object({ download: z.string().optional() }).parse(req.query).download;
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${f.filename}"`).send(f.pdf);
  });
  api.get('/settings/logo-info', user, async () => ({ present: !!(await billing.getLogo(db)) }));
  api.get('/settings/logo', user, async (_req, reply) => {
    const logo = await billing.getLogo(db);
    if (!logo) return reply.status(404).send({ error: { code: 'not_found', message: 'Kein Logo hinterlegt' } });
    return reply.header('Content-Type', logo.mime).header('Cache-Control', 'no-cache').send(logo.data);
  });
  api.put('/settings/logo', { ...admin, bodyLimit: 700 * 1024 }, async (req) => {
    await billing.saveLogo(db, actor(req), z.object({ mime: z.enum(['image/png', 'image/jpeg']), dataBase64: z.string().max(600_000) }).parse(req.body));
    return { ok: true };
  });
  api.post('/settings/logo/remove', admin, async (req) => { await billing.saveLogo(db, actor(req), null); return { ok: true }; });

  api.get('/bookings/:id/billing', user, (req) => billing.bookingBilling(db, idOf(req)));
  // ---------- EC-Gerät ----------
  api.get('/terminal/status', user, async () => ({ ready: await terminal.terminalReady(db) }));
  api.get('/terminal/progress', user, () => terminal.terminalProgress());
  api.post('/payments/terminal', user, (req) => terminal.payByTerminal(db, actor(req), B.terminalPayInput.parse(req.body)));
  api.get('/settings/terminal', admin, () => terminal.getTerminal(db));
  api.put('/settings/terminal', admin, (req) => terminal.saveTerminal(db, actor(req), B.terminalSettingsInput.parse(req.body)));
  api.post('/settings/terminal/test', admin, () => terminal.testTerminal(db));
  api.get('/terminal/log', admin, () => terminal.terminalLog(db));

  api.post('/payments', user, (req) => billing.addPayment(db, actor(req), B.paymentInput.parse(req.body)));
  // Gegenbuchungen (Storno einer Zahlung) darf nur der Administrator
  api.post('/payments/:id/reverse', admin, (req) => billing.reversePayment(db, actor(req), idOf(req), B.reverseInput.parse(req.body).note));
}
