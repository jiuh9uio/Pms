import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { sql } from 'drizzle-orm';
import '../shared/zod-de.js';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import * as S from '../shared/schemas.js';
import type { Db } from './db/client.js';
import type { users } from './db/schema.js';
import { AppError, forbidden, pgCode, pgMessage } from './lib/errors.js';
import { listAudit, record, type Actor } from './modules/audit.js';
import * as auth from './modules/auth.js';
import * as guestforms from './modules/guestforms.js';
import * as network from './modules/network.js';
import * as quickprint from './modules/quickprint.js';
import { overview } from './modules/overview.js';
import { search } from './modules/search.js';
import { shortcutBat, validHost } from './lib/shortcut.js';
import * as tse from './modules/tse.js';
import * as site from './modules/site.js';
import * as SI from '../shared/site.js';
import * as tsesign from './modules/tsesign.js';
import { guestFormInput } from '../shared/hotel.js';
import * as settings from './modules/settings.js';
import * as usersMod from './modules/users.js';
import { registerBillingRoutes } from './routes-billing.js';
import { registerControlRoutes } from './routes-controls.js';
import { registerEInvoiceRoutes } from './routes-einvoice.js';
import { registerOfferRoutes } from './routes-offers.js';
import { registerHotelRoutes } from './routes-hotel.js';
import { registerRestaurantRoutes } from './routes-restaurant.js';
import { getBackupStatus, runBackup } from './backup.js';
import { getGoLive, purge, setGoLive } from './modules/purge.js';
import { checklist } from './modules/setup.js';
import { getLogo, invoiceNumberState, setInvoiceNumber } from './modules/billing.js';
import * as inbox from './modules/inbox.js';
import * as migration from './modules/migration.js';
import * as team from './modules/team.js';
import * as T from '../shared/team.js';
import * as I from '../shared/inbox.js';
import { mailSendInput, publicArrivalInput, publicCancelInput, publicCredInput, publicStayRequestInput } from '../shared/hotel.js';
import * as guestlink from './modules/guestlink.js';
import { checkForUpdate, getChangelog, getUpdateStatus, installUpdate } from './update.js';

import { clientKey } from './lib/clientkey.js';

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
  // Videos für die Gästeseite kommen als rohe Datei (nicht als JSON)
  app.addContentTypeParser(['video/mp4', 'video/webm', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: 400 * 1024 * 1024 }, (_req, body, done) => done(null, body));
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
    // Browser-Funktionen, die das Programm nicht braucht, abschalten; Fenster nicht mit fremden Seiten teilen
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    // nur über HTTPS (Server-Betrieb mit COOKIE_SECURE=true): Browser sollen die Seite künftig nur noch verschlüsselt aufrufen
    if (cookieSecure) reply.header('Strict-Transport-Security', 'max-age=31536000');
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

    // ---------- Online-Meldeschein: ohne Anmeldung, nur mit dem Zugangscode aus dem QR-Code ----------
    // Begrenzung je Absender und Minute. IPv6 je /64-Netz (sonst genügt ein Wechsel der Adresse); bei vielen Einträgen
    // werden nur abgelaufene bzw. die ältesten entfernt – nicht alle Zähler auf einmal.
    const limiter = (max: number) => {
      const hits = new Map<string, { n: number; reset: number }>();
      return async (req: FastifyRequest) => {
        const now = Date.now();
        const key = clientKey(req.ip);
        if (hits.size > 5000) {
          for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
          for (const k of hits.keys()) { if (hits.size <= 4000) break; hits.delete(k); }
        }
        const h = hits.get(key);
        if (!h || h.reset < now) { hits.delete(key); hits.set(key, { n: 1, reset: now + 60_000 }); return; }
        if (++h.n > max) throw new AppError(429, 'too_many', 'Zu viele Anfragen – bitte einen Moment warten');
      };
    };
    const publicLimit = limiter(30);
    // Bilder und Video der Gästeseite: eine Seite lädt viele Bilder und das Video in Teilen – daher großzügiger
    const mediaLimit = limiter(400);
    const tokenOf = (req: FastifyRequest) => z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,64}$/) }).parse(req.params).token;
    api.get('/public/guest-form/:token', { preHandler: publicLimit }, (req) => guestforms.publicForm(db, tokenOf(req)));
    api.post('/public/guest-form/:token', { preHandler: publicLimit, bodyLimit: 8 * 1024 }, async (req) => {
      await guestforms.submitForm(db, tokenOf(req), guestFormInput.parse(req.body), req.ip ?? null);
      return { ok: true };
    });

    // Gäste-Link zur Reservierung: ansehen, Ankunftszeit mitteilen, stornieren (ohne Anmeldung, mit Prüfsumme im Link)
    const linkToken = (req: FastifyRequest) => z.object({ token: z.string().regex(/^[0-9a-f]{32}\.[A-Za-z0-9_-]{20,64}$/) }).parse(req.params).token;
    api.get('/public/booking/:token', { preHandler: publicLimit }, (req) => guestlink.linkGate(db, linkToken(req)));
    api.post('/public/booking/:token/open', { preHandler: publicLimit, bodyLimit: 1024 }, (req) => guestlink.publicBooking(db, linkToken(req), publicCredInput.parse(req.body)));
    api.post('/public/booking/:token/arrival', { preHandler: publicLimit, bodyLimit: 4 * 1024 }, (req) => guestlink.setArrival(db, linkToken(req), publicArrivalInput.parse(req.body), req.ip ?? null));
    api.post('/public/booking/:token/request', { preHandler: publicLimit, bodyLimit: 2 * 1024 }, (req) => guestlink.stayRequest(db, linkToken(req), publicStayRequestInput.parse(req.body), req.ip ?? null));
    api.post('/public/booking/:token/cancel', { preHandler: publicLimit, bodyLimit: 1024 }, (req) => guestlink.cancelByGuest(db, linkToken(req), publicCancelInput.parse(req.body), req.ip ?? null));

    // Online-Buchungsanfrage: ohne Anmeldung, nur wenn eingeschaltet; legt eine Nachricht im Posteingang an
    // Gästeseite: öffentliche Angaben, Verfügbarkeit, Fotos. Ein angemeldeter Administrator sieht sie als Vorschau auch vor dem Freischalten.
    const isAdminPreview = async (req: FastifyRequest) => (await auth.authenticate(db, req.cookies[COOKIE]))?.user.role === 'admin';
    api.get('/public/site', { preHandler: publicLimit }, async (req) => site.sitePublic(db, await isAdminPreview(req)));
    api.get('/public/site/availability', { preHandler: publicLimit }, async (req) => site.siteAvailability(db, SI.siteAvailabilityQuery.parse(req.query), await isAdminPreview(req)));
    api.get('/public/site/photo/:id', { preHandler: mediaLimit }, async (req, reply) => {
      const p = await site.publicPhoto(db, idParam(req), await isAdminPreview(req));
      if (!p) return reply.status(404).send({ error: { code: 'not_found', message: 'Kein Foto' } });
      return reply.header('Content-Type', p.mime).header('Cache-Control', 'public, max-age=86400').send(p.data);
    });
    const imageKey = (req: FastifyRequest) => z.object({ key: z.enum(SI.IMAGE_KEYS) }).parse(req.params).key;
    api.get('/public/site/image/:key', { preHandler: mediaLimit }, async (req, reply) => {
      const p = await site.publicSiteImage(db, imageKey(req), await isAdminPreview(req));
      if (!p) return reply.status(404).send({ error: { code: 'not_found', message: 'Kein Bild' } });
      return reply.header('Content-Type', p.mime).header('Cache-Control', 'public, max-age=86400').send(p.data);
    });
    // Video im Startbild – mit Teilabruf (Range), wie ihn Browser, besonders auf iPhone/iPad, für Videos verlangen
    api.get('/public/site/video', { preHandler: mediaLimit }, async (req, reply) => {
      const v = await site.publicSiteVideo(db, await isAdminPreview(req));
      if (!v) return reply.status(404).send({ error: { code: 'not_found', message: 'Kein Video' } });
      const size = v.data.length;
      reply.header('Content-Type', v.mime).header('Accept-Ranges', 'bytes').header('Cache-Control', 'public, max-age=86400');
      const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
      if (!m || (m[1] === '' && m[2] === '')) return reply.header('Content-Length', size).send(v.data);
      let start = m[1] === '' ? size - Number(m[2]) : Number(m[1]);
      let end = m[1] !== '' && m[2] !== '' ? Number(m[2]) : size - 1;
      start = Math.max(0, start); end = Math.min(end, size - 1);
      if (start > end || start >= size) return reply.status(416).header('Content-Range', `bytes */${size}`).send();
      return reply.status(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', end - start + 1).send(v.data.subarray(start, end + 1));
    });
    api.get('/public/site/logo', { preHandler: mediaLimit }, async (req, reply) => {
      const logo = await site.publicSiteLogo(db, await isAdminPreview(req));
      if (!logo) return reply.status(404).send({ error: { code: 'not_found', message: 'Kein Logo' } });
      return reply.header('Content-Type', logo.mime).header('Cache-Control', 'public, max-age=3600').send(logo.data);
    });
    api.post('/public/site/request', { preHandler: publicLimit, bodyLimit: 8 * 1024 }, (req) => inbox.submitSiteRequest(db, SI.siteRequestInput.parse(req.body), req.ip ?? null));
    api.get('/public/booking-request', { preHandler: publicLimit }, () => inbox.webRequestPublic(db));
    api.post('/public/booking-request', { preHandler: publicLimit, bodyLimit: 8 * 1024 }, (req) => inbox.submitWebRequest(db, I.webRequestInput.parse(req.body), req.ip ?? null));

    // ---------- Anmeldung ----------
    api.get('/auth/state', async (req) => {
      const s = await auth.authenticate(db, req.cookies[COOKIE]);
      if (s) return { needsSetup: false, user: usersMod.toUserDto(s.user), guestHome: false };
      const g = await site.getSite(db);
      return { needsSetup: await auth.needsSetup(db), user: null, guestHome: g.enabled && g.homepage };
    });
    // Bremse gegen massenhaftes Ausprobieren von Passwörtern: höchstens 20 Anmeldeversuche je 10 Minuten und Absender
    // (zusätzlich zur Sperre eines Kontos nach 5 Fehlversuchen). Der PMS-Rechner selbst ist ausgenommen.
    const tries = new Map<string, { n: number; reset: number }>();
    const loginLimit = async (req: FastifyRequest) => {
      const ip = req.ip ?? '';
      if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return;
      const now = Date.now();
      if (tries.size > 5000) tries.clear();
      const t = tries.get(ip);
      if (!t || t.reset < now) { tries.set(ip, { n: 1, reset: now + 10 * 60_000 }); return; }
      if (++t.n > 20) throw new AppError(429, 'too_many', 'Zu viele Anmeldeversuche von diesem Gerät. Bitte in einigen Minuten erneut versuchen.');
    };
    api.post('/auth/setup', { preHandler: loginLimit }, async (req, reply) => {
      const r = await auth.setup(db, S.setupInput.parse(req.body), meta(req));
      setCookie(reply, r.token);
      return { user: r.user };
    });
    api.post('/auth/login', { preHandler: loginLimit }, async (req, reply) => {
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

    // Zwei-Faktor-Anmeldung für das eigene Konto
    api.post('/auth/totp/begin', { preHandler: requireUser }, async (req) => auth.totpBegin(db, actor(req), (await settings.getHotel(db)).name || 'PMS'));
    api.post('/auth/totp/confirm', { preHandler: requireUser }, (req) => auth.totpConfirm(db, actor(req), S.totpConfirmInput.parse(req.body).code));
    api.post('/auth/totp/disable', { preHandler: requireUser }, (req) => auth.totpDisable(db, actor(req), S.totpDisableInput.parse(req.body).password));
    api.get('/settings/security', { preHandler: requireUser }, () => auth.getSecurity(db));
    api.put('/settings/security', { preHandler: requireAdmin }, (req) => auth.saveSecurity(db, actor(req), S.securityInput.parse(req.body)));
    // Administrator richtet die Zwei-Faktor-Anmeldung für einen Benutzer ein (Benutzer scannt mit seinem Handy, Code wird hier bestätigt)
    api.post('/users/:id/totp/begin', { preHandler: requireAdmin }, async (req) => auth.totpBegin(db, actor(req), (await settings.getHotel(db)).name || 'PMS', idParam(req)));
    api.post('/users/:id/totp/confirm', { preHandler: requireAdmin }, (req) => auth.totpConfirm(db, actor(req), S.totpConfirmInput.parse(req.body).code, idParam(req)));
    api.post('/users/:id/totp-reset', { preHandler: requireAdmin }, (req) => usersMod.resetTwoFactor(db, actor(req), idParam(req)));

    // Gästeseite einrichten (Administrator)
    api.get('/settings/site', { preHandler: requireAdmin }, () => site.getSite(db));
    api.put('/settings/site', { preHandler: requireAdmin }, (req) => site.saveSite(db, actor(req), SI.siteSettingsInput.parse(req.body)));
    api.put('/settings/site/video', { preHandler: requireAdmin, bodyLimit: site.VIDEO_MAX + 1024 }, (req) => {
      if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'bad_video', 'Bitte eine Videodatei senden');
      return site.saveSiteVideo(db, actor(req), req.body);
    });
    api.delete('/settings/site/video', { preHandler: requireAdmin }, (req) => site.saveSiteVideo(db, actor(req), null));
    api.get('/settings/site/logo', { preHandler: requireAdmin }, () => site.siteLogoState(db));
    api.put('/settings/site/logo', { preHandler: requireAdmin, bodyLimit: 1_500_000 }, (req) => site.saveSiteLogo(db, actor(req), SI.categoryPhotoInput.parse(req.body)));
    api.delete('/settings/site/logo', { preHandler: requireAdmin }, (req) => site.saveSiteLogo(db, actor(req), null));
    api.put('/settings/site/image/:key', { preHandler: requireAdmin, bodyLimit: 1_500_000 }, (req) => site.saveSiteImage(db, actor(req), imageKey(req), SI.categoryPhotoInput.parse(req.body)));
    api.delete('/settings/site/image/:key', { preHandler: requireAdmin }, (req) => site.saveSiteImage(db, actor(req), imageKey(req), null));
    api.get('/categories/:id/photo', { preHandler: requireAdmin }, async (req, reply) => {
      const p = await site.categoryPhoto(db, idParam(req));
      if (!p) return reply.status(404).send({ error: { code: 'not_found', message: 'Kein Foto' } });
      return reply.header('Content-Type', p.mime).header('Cache-Control', 'no-cache').send(p.data);
    });
    api.put('/categories/:id/photo', { preHandler: requireAdmin, bodyLimit: 1_500_000 }, (req) => site.saveCategoryPhoto(db, actor(req), idParam(req), SI.categoryPhotoInput.parse(req.body)));
    api.delete('/categories/:id/photo', { preHandler: requireAdmin }, (req) => site.saveCategoryPhoto(db, actor(req), idParam(req), null));

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
    // Mitteilungen: lesen dürfen alle (die Oberfläche richtet sich danach), ändern nur der Administrator
    api.get('/settings/notices', { preHandler: requireUser }, () => settings.getNotices(db));
    api.put('/settings/notices', { preHandler: requireAdmin }, (req) => settings.saveNotices(db, actor(req), S.noticesInput.parse(req.body)));
    api.put('/settings/hotel', { preHandler: requireAdmin }, (req) => settings.saveHotel(db, actor(req), S.hotelSettings.parse(req.body)));
    api.get('/tax-rates', { preHandler: requireUser }, () => settings.listTaxRates(db));
    api.post('/tax-rates', { preHandler: requireAdmin }, (req) => settings.createTaxRate(db, actor(req), S.taxRateCreateInput.parse(req.body)));
    api.patch('/tax-rates/:id', { preHandler: requireAdmin }, (req) => settings.updateTaxRate(db, actor(req), idParam(req), S.taxRateUpdateInput.parse(req.body)));

    registerHotelRoutes(api, { db, requireUser: requireModule('hotel'), requireAdmin, actor });
    registerRestaurantRoutes(api, { db, requireUser: requireModule('restaurant'), requireAdmin, actor });
    registerControlRoutes(api, { db, requireUser: requireModule('kontrollen'), requireAdmin, actor });
    registerBillingRoutes(api, { db, requireUser: requireModule('hotel'), requireAdmin, actor });
    registerEInvoiceRoutes(api, { db, requireUser: requireModule('erechnung'), requireAdmin, actor });
    registerOfferRoutes(api, { db, requireUser, requireAdmin, actor, publicLimit });

    // ---------- Umzug auf einen anderen Rechner/Server (nur Administrator) ----------
    const pkgPassword = (req: FastifyRequest) => decodeURIComponent(String(req.headers['x-package-password'] ?? ''));
    const pkgBody = (req: FastifyRequest) => { if (!Buffer.isBuffer(req.body)) throw new AppError(400, 'bad_file', 'Bitte das Umzugspaket auswählen'); return req.body; };
    api.post('/settings/migration/export', { preHandler: requireAdmin }, async (req, reply) => {
      const v = z.object({ password: z.string().max(200) }).parse(req.body);
      const r = await migration.exportPackage(db, actor(req), v.password, getUpdateStatus().current);
      return reply.header('Content-Type', 'application/octet-stream').header('Content-Disposition', `attachment; filename="${r.name}"`).send(r.file);
    });
    api.post('/settings/migration/check', { preHandler: requireAdmin, bodyLimit: 400 * 1024 * 1024 }, async (req) => ({ ...migration.summarize(migration.readPackage(pkgBody(req), pkgPassword(req))), target: await migration.targetCounts(db) }));
    api.post('/settings/migration/import', { preHandler: requireAdmin, bodyLimit: 400 * 1024 * 1024 }, async (req) => {
      if (String(req.headers['x-confirm'] ?? '') !== 'UMZUG') throw new AppError(400, 'validation', 'Eingaben prüfen', { confirm: 'Bitte das Wort UMZUG eintippen' });
      return migration.importPackage(db, actor(req), pkgBody(req), pkgPassword(req), {
        adminPassword: decodeURIComponent(String(req.headers['x-admin-password'] ?? '')), overwrite: String(req.headers['x-overwrite'] ?? '') === 'yes',
      });
    });

    // ---------- Programm-Update (nur Administrator) ----------
    api.get('/update/status', { preHandler: requireAdmin }, (req) =>
      (z.object({ refresh: z.string().optional() }).parse(req.query).refresh ? checkForUpdate() : getUpdateStatus()));
    api.get('/update/changelog', { preHandler: requireUser }, () => getChangelog());
    api.post('/update/install', { preHandler: requireAdmin }, async (req) => {
      const r = await installUpdate();
      await record(db, actor(req), { action: 'update', entity: 'program', after: { version: r.version } });
      return r;
    });

    // ---------- Adressen im Hausnetz (nur Administrator) ----------
    api.get('/system/network', { preHandler: requireAdmin }, async (req) => {
      const port = new URL(`http://${req.headers.host ?? 'localhost'}`).port;
      const addresses = Object.values(networkInterfaces()).flat()
        .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `${req.protocol}://${i!.address}${port ? `:${port}` : ''}`);
      if (process.env.PMS_HOSTED === 'true') return { addresses: [(process.env.PUBLIC_URL ?? '').trim()].filter(Boolean), localOnly: false };
      return { addresses, localOnly: (process.env.HOST ?? '') === '127.0.0.1' };
    });

    // ---------- „Heute im Haus“ für das Startmenü ----------
    // ---------- Team: Übergabebuch, Aufgaben, Reparaturen (alle angemeldeten Benutzer) ----------
    const any = { preHandler: requireUser };
    const noteId = (req: FastifyRequest) => z.uuid().parse((req.params as { id: string }).id);
    api.get('/team/notes', any, (req) => team.listNotes(db, actor(req), T.teamListQuery.parse(req.query).view));
    api.get('/team/state', any, (req) => team.teamState(db, actor(req)));
    api.post('/team/notes', any, (req) => team.createNote(db, actor(req), T.teamNoteInput.parse(req.body)));
    api.get('/team/recurring', any, () => team.listRecurring(db));
    api.post('/team/recurring', { preHandler: requireAdmin }, (req) => team.createRecurring(db, actor(req), T.recurringInput.parse(req.body)));
    api.delete('/team/recurring/:id', { preHandler: requireAdmin }, (req) => team.deleteRecurring(db, actor(req), noteId(req)));
    api.post('/team/notes/:id/read', any, (req) => team.markRead(db, actor(req), noteId(req)));
    api.post('/team/notes/:id/done', any, (req) => { const v = T.teamDoneInput.parse(req.body); return team.setDone(db, actor(req), noteId(req), v.done, v.note); });
    // Start-Checkliste und Startwert der Rechnungsnummern (nur Administrator)
    api.get('/setup/checklist', { preHandler: requireAdmin }, () => checklist(db));
    api.get('/settings/invoice-number', { preHandler: requireAdmin }, (req) => invoiceNumberState(db, z.object({ year: z.coerce.number().int().min(2000).max(2100) }).parse(req.query).year));
    api.put('/settings/invoice-number', { preHandler: requireAdmin }, (req) => setInvoiceNumber(db, actor(req), S.invoiceNumberInput.parse(req.body)));
    // Gleichzeitiges Arbeiten: Zähler, der sich mit jeder protokollierten Änderung erhöht – die Oberfläche fragt ihn alle paar
    // Sekunden ab und lädt neu, wenn jemand anderes etwas geändert hat.
    api.get('/sync', { preHandler: requireUser }, async () => {
      const [r] = await db.execute(sql`select coalesce(max(id), 0)::int as rev from audit_log where action not in ('login', 'logout', 'login_failed')`);
      return { rev: Number(r!.rev) };
    });
    // Datei, die auf einem Windows-PC ein Symbol für das PMS als eigenes Fenster anlegt. Enthält nur die Adresse, unter der
    // das PMS gerade aufgerufen wurde – nichts Geheimes; deshalb ohne Anmeldung abrufbar (auch für die Hilfsdatei im Programmordner).
    api.get('/desktop-shortcut.bat', { preHandler: publicLimit }, async (req, reply) => {
      const host = String(req.headers.host ?? '');
      if (!validHost(host)) throw new AppError(400, 'validation', 'Unter dieser Adresse lässt sich keine Verknüpfung erzeugen');
      const proto = cookieSecure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      return reply.header('Content-Type', 'application/bat').header('Content-Disposition', 'attachment; filename="PMS als Programm einrichten.bat"').send(shortcutBat(`${proto}://${host}/`));
    });
    // Hinweis „Internet ist weg“ für alle angemeldeten Benutzer
    api.get('/network/alert', { preHandler: requireUser }, () => network.netAlert(db));
    api.get('/overview', { preHandler: requireUser }, (req) => overview(db, req.user!));

    // ---------- Suche über alle freigegebenen Bereiche ----------
    api.get('/search', { preHandler: requireUser }, (req) => search(db, req.user!, z.object({ q: z.string().trim().min(2, 'Mindestens 2 Zeichen').max(60) }).parse(req.query).q));

    // ---------- Bereich „Schnelldruck“: Info-Zettel auf dem Bondrucker ----------
    const quick = { preHandler: requireModule('schnelldruck') };
    api.get('/quickprint', quick, () => quickprint.overview(db));
    api.post('/quickprint/print', quick, (req) => { const v = S.quickPrintInput.parse(req.body); return quickprint.printSlip(db, actor(req), v.id, v.copies); });
    api.post('/quickprint/text', quick, (req) => quickprint.printText(db, actor(req), S.quickTextInput.parse(req.body)));
    api.get('/quickprint/suggestions', { preHandler: requireAdmin }, () => quickprint.suggestions(db));
    api.post('/quickprint/suggestions', { preHandler: requireAdmin }, (req) => quickprint.addSuggestions(db, actor(req), S.slipSuggestionsInput.parse(req.body).keys));
    api.put('/quickprint/review', { preHandler: requireAdmin }, (req) => quickprint.saveReview(db, actor(req), S.reviewSlipInput.parse(req.body)));
    api.post('/quickprint/templates', { preHandler: requireAdmin }, (req) => quickprint.saveTemplate(db, actor(req), null, S.printTemplateInput.parse(req.body)));
    api.put('/quickprint/templates/:id', { preHandler: requireAdmin }, (req) =>
      quickprint.saveTemplate(db, actor(req), idParam(req), S.printTemplateInput.parse(req.body), z.object({ version: z.number().int() }).parse(req.body).version));
    api.post('/quickprint/templates/:id/remove', { preHandler: requireAdmin }, async (req) => { await quickprint.removeTemplate(db, actor(req), idParam(req)); return { ok: true }; });
    api.get('/settings/front-printer', { preHandler: requireAdmin }, () => quickprint.getFrontPrinter(db));
    api.put('/settings/front-printer', { preHandler: requireAdmin }, (req) => quickprint.saveFrontPrinter(db, actor(req), S.bonPrinterInput.parse(req.body)));
    api.post('/settings/front-printer/test', { preHandler: requireAdmin }, async () => { await quickprint.testFrontPrinter(db); return { ok: true }; });

    // ---------- Bereich „Internet“: Verbindung und Geräte im Hausnetz (Administrator oder Freigabe) ----------
    // ---------- E-Mail-Posteingang ----------
    const email = { preHandler: requireModule('email') };
    api.get('/inbox', email, (req) => inbox.listInbox(db, I.inboxListQuery.parse(req.query)));
    api.get('/inbox/state', email, () => inbox.inboxState(db));
    api.get('/inbox/counts', email, (req) => inbox.inboxCounts(db, I.inboxListQuery.parse(req.query)));
    api.post('/inbox/fetch', email, (req) => inbox.fetchInbox(db, actor(req)));
    api.get('/inbox/:id', email, (req) => inbox.getInboxMail(db, z.uuid().parse((req.params as { id: string }).id)));
    api.patch('/inbox/:id', email, (req) => inbox.updateInboxMail(db, actor(req), z.uuid().parse((req.params as { id: string }).id), I.inboxUpdateInput.parse(req.body)));
    api.delete('/inbox/:id', email, (req) => inbox.deleteInboxMail(db, actor(req), z.uuid().parse((req.params as { id: string }).id)));
    const tpl = (req: FastifyRequest) => z.object({ template: z.enum(I.REPLY_TEMPLATES).default('reply') }).parse(req.query).template;
    api.get('/inbox/:id/mail', email, (req) => inbox.replyDraft(db, z.uuid().parse((req.params as { id: string }).id), tpl(req), S.hasModule(req.user!, 'hotel')));
    api.post('/inbox/:id/mail', email, (req) => inbox.sendReply(db, actor(req), z.uuid().parse((req.params as { id: string }).id), mailSendInput.parse(req.body)));
    api.get('/settings/mail-rules', { preHandler: requireAdmin }, () => inbox.getMailRules(db));
    api.put('/settings/mail-rules', { preHandler: requireAdmin }, (req) => inbox.saveMailRules(db, actor(req), I.mailRulesInput.parse(req.body)));
    api.post('/inbox/reclassify', { preHandler: requireAdmin }, (req) => inbox.reclassify(db, actor(req)));
    api.get('/settings/web-request', { preHandler: requireAdmin }, () => inbox.getWebRequest(db));
    api.put('/settings/web-request', { preHandler: requireAdmin }, (req) => inbox.saveWebRequest(db, actor(req), I.webRequestSettingsInput.parse(req.body)));
    api.get('/settings/inbox', { preHandler: requireAdmin }, () => inbox.getInboxSettings(db));
    api.put('/settings/inbox', { preHandler: requireAdmin }, (req) => inbox.saveInboxSettings(db, actor(req), I.inboxSettingsInput.parse(req.body)));

    const internet = { preHandler: requireModule('internet') };
    api.get('/network/status', internet, () => network.internetStatus());
    api.get('/network/outages', internet, () => network.listOutages(db));
    // FRITZ!Box: Einrichtung nur Administrator; Verbindung neu aufbauen und Neustart für alle mit dem Bereich „Internet“
    api.get('/network/fritz', internet, () => network.getFritz(db));
    api.put('/network/fritz', { preHandler: requireAdmin }, (req) => network.saveFritz(db, actor(req), S.fritzSettingsInput.parse(req.body)));
    api.get('/network/fritz/info', internet, () => network.fritzInfo(db));
    api.post('/network/fritz/action', internet, (req) => network.fritzAction(db, actor(req), S.fritzActionInput.parse(req.body).action));
    api.get('/network/wifi', internet, () => network.getWifi(db));
    api.put('/network/wifi', { preHandler: requireAdmin }, (req) => network.saveWifi(db, actor(req), S.wifiSettingsInput.parse(req.body)));
    api.get('/network/devices', internet, () => network.scan(db));
    api.get('/network/rules', internet, () => network.getRules(db));
    api.put('/network/rules', { preHandler: requireAdmin }, (req) => network.saveRules(db, actor(req), S.netRulesInput.parse(req.body)));
    api.get('/network/usage', internet, () => network.fritzUsage(db));
    api.put('/network/devices/:mac', internet, async (req) => {
      const mac = network.normMac(z.object({ mac: z.string().max(17) }).parse(req.params).mac);
      const b = S.netDeviceNameInput.parse(req.body);
      await network.nameDevice(db, actor(req), mac, b.name, b.kind);
      return { ok: true };
    });

    // ---------- TSE prüfen (nur Administrator) ----------
    api.get('/settings/tse', { preHandler: requireAdmin }, () => tse.getTse(db));
    api.put('/settings/tse', { preHandler: requireAdmin }, (req) => tse.saveTse(db, actor(req), S.tseSettingsInput.parse(req.body)));
    api.get('/tse/info', { preHandler: requireAdmin }, () => tse.tseInfo(db));
    api.post('/tse/selftest', { preHandler: requireAdmin }, (req) => tse.tseSelfTest(db, actor(req)));
    api.post('/tse/print', { preHandler: requireAdmin }, (req) => tse.printTseSheet(db, actor(req)));
    api.post('/tse/register-client', { preHandler: requireAdmin }, (req) => tse.tseRegisterClient(db, actor(req), S.tseRegisterInput.parse(req.body)));
    api.get('/settings/tse-sign', { preHandler: requireAdmin }, () => tsesign.getUse(db));
    api.put('/settings/tse-sign', { preHandler: requireAdmin }, (req) => tsesign.saveUse(db, actor(req), S.tseUseInput.parse(req.body)));
    api.get('/tse/records', { preHandler: requireAdmin }, () => tsesign.listRecords(db));
    api.post('/tse/test-signature', { preHandler: requireAdmin }, (req) => tse.tseTestSignature(db, actor(req), S.tseSignInput.parse(req.body)));

    // ---------- Datensicherung (nur Administrator) ----------
    api.get('/backup/status', { preHandler: requireAdmin }, () => getBackupStatus());
    api.post('/settings/purge', { preHandler: requireAdmin }, (req) => purge(db, actor(req), S.purgeInput.parse(req.body)));
    api.get('/settings/go-live', { preHandler: requireAdmin }, () => getGoLive(db));
    api.post('/settings/go-live', { preHandler: requireAdmin }, (req) => {
      const v = z.object({ password: z.string().max(200), confirm: z.string().max(40) }).parse(req.body);
      return setGoLive(db, actor(req), v.password, v.confirm);
    });
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
      // Links für Gäste und Kunden enthalten einen Punkt im Zugangscode – das sind Seiten, keine Dateien
      const page = /^\/(buchung|angebot|gast)\/[^/]+$/.test(path) || !/\.[a-z0-9]+$/i.test(path);
      if (req.method === 'GET' && !path.startsWith('/api/') && page) return reply.sendFile('index.html');
      return reply.status(404).send({ error: { code: 'not_found', message: 'Unbekannte Adresse' } });
    });
  }
  return app;
}
