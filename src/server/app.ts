import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import * as S from '../shared/schemas.js';
import type { Db } from './db/client.js';
import type { users } from './db/schema.js';
import { AppError, forbidden, pgCode, pgMessage } from './lib/errors.js';
import { listAudit, record, type Actor } from './modules/audit.js';
import * as auth from './modules/auth.js';
import * as settings from './modules/settings.js';
import * as usersMod from './modules/users.js';
import { registerBillingRoutes } from './routes-billing.js';
import { registerControlRoutes } from './routes-controls.js';
import { registerEInvoiceRoutes } from './routes-einvoice.js';
import { registerHotelRoutes } from './routes-hotel.js';
import { getBackupStatus, runBackup } from './backup.js';
import { checkForUpdate, getUpdateStatus, installUpdate } from './update.js';

const COOKIE = 'pms_session';

declare module 'fastify' {
  interface FastifyRequest {
    user: typeof users.$inferSelect | null;
    sessionId: string | null;
  }
}

export interface AppOptions { db: Db; cookieSecure?: boolean; webDir?: string | null; logger?: boolean }

export async function buildApp({ db, cookieSecure = false, webDir, logger = false }: AppOptions) {
  // trustProxy nur für lokale Proxys (z. B. Caddy auf demselben Rechner)
  const app = Fastify({ logger: logger ? { level: 'warn' } : false, trustProxy: 'loopback', bodyLimit: 1024 * 1024 });
  await app.register(cookie);
  app.decorateRequest('user', null);
  app.decorateRequest('sessionId', null);

  const meta = (req: FastifyRequest): auth.Meta => ({ ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });
  const actor = (req: FastifyRequest): Actor => ({ userId: req.user!.id, userName: req.user!.name, ip: req.ip ?? null });
  const setCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: cookieSecure, path: '/', maxAge: 30 * 24 * 60 * 60 });
  const idParam = (req: FastifyRequest) => z.object({ id: z.uuid() }).parse(req.params).id;

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    // Schreibende Anfragen nur von der eigenen Seite (zusätzlich zu SameSite=Strict)
    const origin = req.headers.origin;
    if (origin && !['GET', 'HEAD'].includes(req.method)) {
      let host = '';
      try { host = new URL(origin).host; } catch { /* ungültig */ }
      if (host !== req.headers.host) throw new AppError(403, 'bad_origin', 'Anfrage von fremder Herkunft abgelehnt');
    }
  });

  // ---------- Zugriffsschutz ----------
  const requireUser = async (req: FastifyRequest) => {
    const s = await auth.authenticate(db, req.cookies[COOKIE]);
    if (!s) throw new AppError(401, 'unauthenticated', 'Bitte anmelden');
    req.user = s.user;
    req.sessionId = s.sessionId;
  };
  /** Zugriff auf einen Bereich: Administratoren immer, Benutzer nur mit Freigabe. */
  const requireModule = (m: S.Module) => async (req: FastifyRequest) => {
    await requireUser(req);
    if (!S.hasModule(req.user!, m)) throw new AppError(403, 'forbidden', `Für den Bereich „${S.MODULE_LABEL[m]}“ fehlt die Freigabe`);
  };
  const requireAdmin = async (req: FastifyRequest) => {
    await requireUser(req);
    if (req.user!.role !== 'admin') throw forbidden();
  };

  // ---------- Fehlerbehandlung ----------
  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ZodError) {
      const fields: Record<string, string> = {};
      for (const i of err.issues) fields[i.path.join('.') || '_'] ??= i.message;
      return reply.status(400).send({ error: { code: 'validation', message: 'Bitte die Eingaben prüfen', fields } });
    }
    if (err instanceof AppError) return reply.status(err.status).send({ error: { code: err.code, message: err.message, fields: err.fields } });
    const e = err as { statusCode?: number; code?: string; message?: string };
    const pg = pgCode(err);
    if (pg === '23P01') return reply.status(409).send({ error: { code: 'room_taken', message: 'Das Zimmer ist in diesem Zeitraum bereits belegt oder gesperrt' } });
    if (pg === 'P0001') return reply.status(409).send({ error: { code: 'protected', message: pgMessage(err) ?? 'Nicht erlaubt' } });
    if (pg === '23505') return reply.status(409).send({ error: { code: 'duplicate', message: 'Dieser Eintrag existiert bereits' } });
    if (pg === '23503') return reply.status(409).send({ error: { code: 'in_use', message: 'Der Eintrag wird noch verwendet oder verweist auf etwas, das es nicht gibt' } });
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: { code: 'bad_request', message: 'Ungültige Anfrage' } });
    req.log.error(err);
    if (!logger) console.error(err);
    return reply.status(500).send({ error: { code: 'internal', message: 'Interner Fehler – bitte erneut versuchen' } });
  });

  await app.register(async (api) => {
    api.get('/health', async () => {
      await db.execute(sql`select 1`);
      return { ok: true };
    });

    // ---------- Anmeldung ----------
    api.get('/auth/state', async (req) => {
      const s = await auth.authenticate(db, req.cookies[COOKIE]);
      return { needsSetup: s ? false : await auth.needsSetup(db), user: s ? usersMod.toUserDto(s.user) : null };
    });
    api.post('/auth/setup', async (req, reply) => {
      const r = await auth.setup(db, S.setupInput.parse(req.body), meta(req));
      setCookie(reply, r.token);
      return { user: r.user };
    });
    api.post('/auth/login', async (req, reply) => {
      const r = await auth.login(db, S.loginInput.parse(req.body), meta(req));
      setCookie(reply, r.token);
      return { user: r.user };
    });
    api.post('/auth/logout', { preHandler: requireUser }, async (req, reply) => {
      await auth.logout(db, actor(req), req.sessionId!);
      reply.clearCookie(COOKIE, { path: '/' });
      return { ok: true };
    });
    api.post('/auth/password', { preHandler: requireUser }, async (req) => {
      await auth.changeOwnPassword(db, actor(req), req.sessionId!, S.changePasswordInput.parse(req.body));
      return { ok: true };
    });

    // ---------- Benutzer (nur Administrator) ----------
    api.get('/users', { preHandler: requireAdmin }, () => usersMod.listUsers(db));
    api.post('/users', { preHandler: requireAdmin }, (req) => usersMod.createUser(db, actor(req), S.userCreateInput.parse(req.body)));
    api.patch('/users/:id', { preHandler: requireAdmin }, (req) => usersMod.updateUser(db, actor(req), idParam(req), S.userUpdateInput.parse(req.body)));
    api.post('/users/:id/password', { preHandler: requireAdmin }, async (req) => {
      await usersMod.resetPassword(db, actor(req), idParam(req), S.passwordResetInput.parse(req.body).password);
      return { ok: true };
    });

    // ---------- Protokoll (nur Administrator) ----------
    api.get('/audit', { preHandler: requireAdmin }, (req) => {
      const q = z.object({
        entity: z.string().max(40).optional(), userId: z.uuid().optional(),
        before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(200).default(50),
      }).parse(req.query);
      return listAudit(db, q);
    });

    // ---------- Einstellungen ----------
    api.get('/settings/hotel', { preHandler: requireUser }, () => settings.getHotel(db));
    api.put('/settings/hotel', { preHandler: requireAdmin }, (req) => settings.saveHotel(db, actor(req), S.hotelSettings.parse(req.body)));
    api.get('/tax-rates', { preHandler: requireUser }, () => settings.listTaxRates(db));
    api.post('/tax-rates', { preHandler: requireAdmin }, (req) => settings.createTaxRate(db, actor(req), S.taxRateCreateInput.parse(req.body)));
    api.patch('/tax-rates/:id', { preHandler: requireAdmin }, (req) => settings.updateTaxRate(db, actor(req), idParam(req), S.taxRateUpdateInput.parse(req.body)));

    registerHotelRoutes(api, { db, requireUser: requireModule('hotel'), requireAdmin, actor });
    registerControlRoutes(api, { db, requireUser: requireModule('kontrollen'), requireAdmin, actor });
    registerBillingRoutes(api, { db, requireUser: requireModule('hotel'), actor });
    registerEInvoiceRoutes(api, { db, requireUser: requireModule('erechnung'), requireAdmin, actor });

    // ---------- Programm-Update (nur Administrator) ----------
    api.get('/update/status', { preHandler: requireAdmin }, (req) =>
      (z.object({ refresh: z.string().optional() }).parse(req.query).refresh ? checkForUpdate() : getUpdateStatus()));
    api.post('/update/install', { preHandler: requireAdmin }, async (req) => {
      const r = await installUpdate();
      await record(db, actor(req), { action: 'update', entity: 'program', after: { version: r.version } });
      return r;
    });

    // ---------- Datensicherung (nur Administrator) ----------
    api.get('/backup/status', { preHandler: requireAdmin }, () => getBackupStatus());
    api.post('/backup/run', { preHandler: requireAdmin }, async (req) => {
      const r = runBackup();
      await record(db, actor(req), { action: 'backup', entity: 'program', after: { file: r.last?.file } });
      return r;
    });

    api.setNotFoundHandler(() => { throw new AppError(404, 'not_found', 'Unbekannte Adresse'); });
  }, { prefix: '/api/v1' });

  // ---------- Oberfläche ausliefern ----------
  const dir = webDir ?? fileURLToPath(new URL('../web', import.meta.url));
  if (existsSync(dir)) {
    await app.register(fastifyStatic, { root: dir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      // Seiten der Oberfläche (ohne Dateiendung) liefert index.html; fehlende Dateien bleiben 404
      const path = req.url.split('?')[0]!;
      if (req.method === 'GET' && !path.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(path)) return reply.sendFile('index.html');
      return reply.status(404).send({ error: { code: 'not_found', message: 'Unbekannte Adresse' } });
    });
  }
  return app;
}
