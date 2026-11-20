import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { depositCreateInput, depositDraftQuery, depositPaidInput } from '../shared/deposits.js';
import * as O from '../shared/offers.js';
import { hasModule } from '../shared/schemas.js';
import type { Db } from './db/client.js';
import { AppError } from './lib/errors.js';
import type { Actor } from './modules/audit.js';
import * as deposits from './modules/deposits.js';
import * as offers from './modules/offers.js';
import { guestBaseUrl } from './routes-hotel.js';

interface Ctx { db: Db; requireUser: (req: FastifyRequest) => Promise<void>; requireAdmin: (req: FastifyRequest) => Promise<void>; actor: (req: FastifyRequest) => Actor; publicLimit: (req: FastifyRequest) => Promise<void> }
const idOf = (req: FastifyRequest) => z.object({ id: z.uuid() }).parse(req.params).id;
const versionOf = (req: FastifyRequest) => z.object({ version: z.number().int() }).parse(req.body).version;
const tokenOf = (req: FastifyRequest) => z.object({ token: z.string().min(10).max(120) }).parse(req.params).token;

/** Angebote (Tagungen, Feiern, Gruppen) – für alle mit Hotel oder Restaurant; Katalog, Vorlagen und AGB pflegt der Administrator. */
export function registerOfferRoutes(api: FastifyInstance, { db, requireUser, requireAdmin, actor, publicLimit }: Ctx) {
  const user = { preHandler: async (req: FastifyRequest) => {
    await requireUser(req);
    if (!hasModule(req.user!, 'hotel') && !hasModule(req.user!, 'restaurant')) throw new AppError(403, 'forbidden', 'Für Angebote fehlt die Freigabe (Hotel oder Restaurant)');
  } };
  const admin = { preHandler: requireAdmin };

  // Katalog, Vorlagen, Dokumente
  api.get('/offer-items', user, () => offers.listItems(db));
  api.post('/offer-items', admin, (req) => offers.saveItem(db, actor(req), null, O.offerItemInput.parse(req.body)));
  api.put('/offer-items/:id', admin, (req) => offers.saveItem(db, actor(req), idOf(req), O.offerItemInput.parse(req.body), versionOf(req)));
  // Fragenkatalog: alle dürfen Fragen ergänzen, entfernen nur der Administrator
  const qIn = z.object({ question: z.string().trim().min(2, 'Bitte eine Frage eintragen').max(200) });
  api.get('/offer-questions', user, () => offers.questionBank(db));
  api.post('/offer-questions', user, (req) => offers.addQuestion(db, actor(req), qIn.parse(req.body).question));
  api.post('/offer-questions/remove', admin, (req) => offers.removeQuestion(db, actor(req), qIn.parse(req.body).question));
  api.get('/offer-templates', user, () => offers.listTemplates(db));
  api.post('/offer-templates', admin, (req) => offers.saveTemplate(db, actor(req), null, O.offerTemplateInput.parse(req.body)));
  api.put('/offer-templates/:id', admin, (req) => offers.saveTemplate(db, actor(req), idOf(req), O.offerTemplateInput.parse(req.body), versionOf(req)));
  // Gestaltung des Angebots-PDFs
  api.get('/settings/offer-layout', admin, () => offers.getOfferLayout(db));
  api.put('/settings/offer-layout', admin, (req) => offers.saveOfferLayout(db, actor(req), O.offerLayoutInput.parse(req.body)));
  api.get('/settings/offer-layout/preview', admin, async (req, reply) =>
    reply.header('Content-Type', 'application/pdf').header('Content-Disposition', 'inline; filename="Muster-Angebot.pdf"').send(await offers.offerLayoutPreview(db, O.offerLayoutInput.parse(req.query))));
  api.get('/offer-documents', user, () => offers.listDocuments(db));
  api.post('/offer-documents', { ...admin, bodyLimit: 11 * 1024 * 1024 }, (req) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'bad_file', 'Bitte eine PDF-Datei wählen');
    return offers.uploadDocument(db, actor(req), { name: decodeURIComponent(String(req.headers['x-doc-name'] ?? '')), fileName: decodeURIComponent(String(req.headers['x-file-name'] ?? 'dokument.pdf')), data: req.body });
  });
  api.post('/offer-documents/:id/active', admin, (req) => offers.setDocumentActive(db, actor(req), idOf(req), z.object({ active: z.boolean() }).parse(req.body).active));
  api.get('/offer-documents/:id/file', user, async (req, reply) => {
    const f = await offers.documentFile(db, idOf(req));
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${f.fileName.replace(/"/g, '')}"`).send(f.data);
  });

  // Angebote
  api.get('/offers', user, (req) => offers.listOffers(db, z.object({ state: z.string().max(20).optional(), q: z.string().trim().max(80).optional() }).parse(req.query)));
  api.post('/offers', user, (req) => offers.createOffer(db, actor(req), O.offerCreateInput.parse(req.body)));
  api.get('/offers/:id', user, (req) => offers.getOffer(db, idOf(req)));
  api.put('/offers/:id', user, (req) => offers.updateOffer(db, actor(req), idOf(req), O.offerUpdateInput.parse(req.body)));
  api.get('/offers/:id/pdf', user, async (req, reply) => {
    const f = await offers.offerPdf(db, idOf(req));
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${f.fileName}"`).send(f.pdf);
  });
  api.get('/offers/:id/mail', user, (req) => offers.mailDraft(db, idOf(req), guestBaseUrl(req).url));
  api.post('/offers/:id/mail', user, (req) => offers.sendOffer(db, actor(req), idOf(req), O.offerSendInput.parse(req.body)));
  // Leistungskatalog zum Ankreuzen: ansehen, per E-Mail senden, ausgefülltes PDF einlesen (?katalog=<Vorlagen-ID>, sonst Vorlage des Angebots)
  const katalogOf = (req: FastifyRequest) => z.object({ katalog: z.uuid().optional() }).parse(req.query).katalog ?? null;
  api.get('/offers/:id/catalog/pdf', user, async (req, reply) => {
    const f = await offers.catalogPdf(db, idOf(req), katalogOf(req));
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${encodeURIComponent(f.fileName)}"`).send(f.pdf);
  });
  api.get('/offers/:id/catalog/mail', user, (req) => offers.catalogMailDraft(db, idOf(req), katalogOf(req)));
  api.post('/offers/:id/catalog/mail', user, (req) => offers.sendCatalog(db, actor(req), idOf(req), katalogOf(req), O.offerSendInput.parse(req.body)));
  api.post('/offers/:id/catalog/read', { ...user, bodyLimit: 11 * 1024 * 1024 }, (req) => {
    if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'bad_file', 'Bitte eine PDF-Datei wählen');
    return offers.readCatalog(db, idOf(req), req.body);
  });
  api.get('/offers/:id/link', user, (req) => offers.offerLink(db, idOf(req), guestBaseUrl(req).url));
  api.post('/offers/:id/accept', user, (req) => offers.acceptOffer(db, actor(req), idOf(req), O.offerAcceptInput.parse(req.body)));
  api.post('/offers/:id/decline', user, (req) => offers.declineOffer(db, actor(req), idOf(req)));
  api.post('/offers/:id/to-offer', user, (req) => offers.toOffer(db, actor(req), idOf(req)));
  api.post('/offers/:id/link-reservation', user, (req) => offers.linkReservation(db, actor(req), idOf(req), z.object({ bookingId: z.uuid().nullable().optional(), tableReservationId: z.uuid().nullable().optional() }).parse(req.body)));
  // Anzahlung zum angenommenen Angebot (Eingang von Hand vermerken)
  api.get('/offers/:id/deposits', user, (req) => deposits.listFor(db, 'offer', idOf(req)));
  api.get('/offers/:id/deposits/draft', user, (req) => { const q = depositDraftQuery.parse(req.query); return deposits.draft(db, 'offer', idOf(req), q.amountCents, q.dueDate); });
  api.post('/offers/:id/deposits', user, (req) => deposits.create(db, actor(req), 'offer', idOf(req), depositCreateInput.parse(req.body)));
  api.post('/offers/deposits/:id/paid', user, (req) => deposits.markPaid(db, actor(req), 'offer', idOf(req), depositPaidInput.parse(req.body).note));
  api.post('/offers/deposits/:id/cancel', user, (req) => deposits.cancel(db, actor(req), 'offer', idOf(req)));

  // Öffentlich: Angebot über den Link ansehen und annehmen
  const pub = { preHandler: publicLimit };
  api.get('/public/offer/:token', pub, (req) => offers.publicOffer(db, tokenOf(req)));
  api.get('/public/offer/:token/pdf', pub, async (req, reply) => {
    const f = await offers.publicPdf(db, tokenOf(req));
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${f.fileName}"`).send(f.pdf);
  });
  api.get('/public/offer/:token/doc/:docId', pub, async (req, reply) => {
    const docId = z.object({ docId: z.uuid() }).parse(req.params).docId;
    const f = await offers.publicDocument(db, tokenOf(req), docId);
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${f.fileName.replace(/"/g, '')}"`).send(f.data);
  });
  api.post('/public/offer/:token/answer', { ...pub, bodyLimit: 48 * 1024 }, (req) => offers.publicAnswer(db, tokenOf(req), O.publicAnswersInput.parse(req.body), req.ip ?? null));
  api.post('/public/offer/:token/accept', { ...pub, bodyLimit: 2048 }, (req) => offers.publicAccept(db, tokenOf(req), O.publicOfferAcceptInput.parse(req.body), req.ip ?? null));
}
