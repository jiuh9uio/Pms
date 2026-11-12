'use strict';
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { db, getSetting, setSetting, decrypt } = require('./db');
const { deDate, money, diffDays, HttpError } = require('./util');

function config() {
  const m = getSetting('mail');
  return { ...m, pass: decrypt(m.pass) };
}
function isConfigured() {
  const m = getSetting('mail');
  return !!(m.enabled && m.user && m.pass);
}

function transport(m) {
  const port = Number(m.smtpPort) || 587;
  return nodemailer.createTransport({
    host: m.smtpHost, port, secure: port === 465, requireTLS: port !== 465,
    auth: { user: m.user, pass: m.pass },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
  });
}
function imapClient(m) {
  return new ImapFlow({
    host: m.imapHost, port: Number(m.imapPort) || 993, secure: true,
    auth: { user: m.user, pass: m.pass }, logger: false, socketTimeout: 60000,
  });
}

/** Prüft SMTP- und IMAP-Zugang getrennt und liefert verständliche Fehlermeldungen. */
async function testConnection() {
  const m = config();
  if (!m.user || !m.pass) throw new HttpError(400, 'Bitte zuerst GMX-Adresse und Passwort speichern');
  const result = { smtp: 'ok', imap: 'ok' };
  try {
    await transport(m).verify();
  } catch (e) {
    result.smtp = explain(e);
  }
  const client = imapClient(m);
  client.on('error', () => {});
  try {
    await client.connect();
    await client.logout();
  } catch (e) {
    result.imap = explain(e);
  }
  return result;
}

function explain(e) {
  const msg = String(e?.responseText || e?.response || e?.message || e);
  if (e?.authenticationFailed || /auth|credentials|535/i.test(msg))
    return 'Anmeldung fehlgeschlagen. Passwort prüfen und in GMX unter „E-Mail → Einstellungen → POP3/IMAP Abruf“ den Zugriff über IMAP/SMTP aktivieren. Bei aktivierter Zwei-Faktor-Anmeldung ein anwendungsspezifisches Passwort verwenden. (' + msg + ')';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timeout|EAI_AGAIN/i.test(msg + (e?.code || '')))
    return 'Server nicht erreichbar (' + (e?.code || msg) + ')';
  return msg;
}

// ---------- Vorlagen ----------
function salutationLine(g) {
  if (g.salutation === 'Herr') return `Sehr geehrter Herr ${g.last_name}`;
  if (g.salutation === 'Frau') return `Sehr geehrte Frau ${g.last_name}`;
  return `Guten Tag ${[g.first_name, g.last_name].filter(Boolean).join(' ')}`.trim();
}

function context({ reservation_id, guest_id }) {
  const hotel = getSetting('hotel');
  const m = getSetting('mail');
  const ctx = {
    hotel: hotel.name, hotel_telefon: hotel.phone, hotel_email: hotel.email || m.user, hotel_website: hotel.website,
    hotel_adresse: [hotel.street, [hotel.zip, hotel.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    checkin_zeit: hotel.checkinTime, checkout_zeit: hotel.checkoutTime,
    signatur: m.signature || `Mit freundlichen Grüßen\n${hotel.name}`,
  };
  let guest = null;
  if (reservation_id) {
    const r = db
      .prepare(
        `SELECT r.*, c.name AS category_name, ro.number AS room_number FROM reservations r
         JOIN room_categories c ON c.id = r.category_id JOIN rooms ro ON ro.id = r.room_id WHERE r.id = ?`
      )
      .get(reservation_id);
    if (r) {
      guest_id = r.guest_id;
      const paid = db.prepare('SELECT COALESCE(SUM(amount),0) s FROM payments WHERE reservation_id = ?').get(r.id).s;
      Object.assign(ctx, {
        buchungsnr: r.code, anreise: deDate(r.check_in), abreise: deDate(r.check_out),
        naechte: diffDays(r.check_in, r.check_out), kategorie: r.category_name, zimmer: r.room_number,
        personen: r.children ? `${r.adults} Erw. + ${r.children} Kind(er)` : String(r.adults),
        gesamtpreis: money(r.total, hotel.currency), offen: money(r.total - paid, hotel.currency),
      });
    }
  }
  if (guest_id) guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(guest_id);
  if (guest) {
    Object.assign(ctx, {
      anrede: salutationLine(guest), vorname: guest.first_name, nachname: guest.last_name, firma: guest.company,
    });
  } else ctx.anrede = 'Guten Tag';
  return { ctx, guest };
}

function render(text, ctx) {
  return String(text || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k) => (ctx[k.toLowerCase()] ?? ''));
}

function renderTemplate(templateIdOrKey, ids) {
  const tpl =
    typeof templateIdOrKey === 'number'
      ? db.prepare('SELECT * FROM email_templates WHERE id = ?').get(templateIdOrKey)
      : db.prepare('SELECT * FROM email_templates WHERE key = ? ORDER BY id LIMIT 1').get(templateIdOrKey);
  if (!tpl) throw new HttpError(404, 'Vorlage nicht gefunden');
  const { ctx, guest } = context(ids);
  return { subject: render(tpl.subject, ctx), body: render(tpl.body, ctx), to: guest?.email || '', template: tpl.key || tpl.name };
}

// ---------- Senden ----------
const insertMail = db.prepare(
  `INSERT INTO emails (direction, message_id, from_addr, from_name, to_addr, subject, body, date, guest_id, reservation_id, template, status, error, is_read)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
);

function guestByEmail(addr) {
  if (!addr) return null;
  return db.prepare('SELECT id FROM guests WHERE lower(email) = lower(?) ORDER BY id LIMIT 1').get(addr)?.id || null;
}

async function sendMail({ to, subject, body, guest_id = null, reservation_id = null, template = '', in_reply_to = null }) {
  const m = config();
  if (!m.enabled || !m.user || !m.pass) throw new HttpError(400, 'GMX-Konto ist nicht eingerichtet (Einstellungen → GMX)');
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) throw new HttpError(400, 'Ungültige Empfängeradresse');
  const hotel = getSetting('hotel');
  const fromName = m.fromName || hotel.name;
  if (!guest_id) guest_id = guestByEmail(to);
  const now = new Date().toISOString();
  try {
    const info = await transport(m).sendMail({
      from: { name: fromName, address: m.user }, to, subject, text: body,
      ...(in_reply_to ? { inReplyTo: in_reply_to, references: in_reply_to } : {}),
    });
    const r = insertMail.run('out', info.messageId || null, m.user, fromName, to, subject, body, now, guest_id, reservation_id, template, 'ok', '', 1);
    return { id: r.lastInsertRowid };
  } catch (e) {
    const err = explain(e);
    insertMail.run('out', null, m.user, fromName, to, subject, body, now, guest_id, reservation_id, template, 'error', err, 1);
    throw new HttpError(502, 'Versand fehlgeschlagen: ' + err);
  }
}

/** Vorlage an den Gast einer Reservierung senden; Fehler werden protokolliert, nicht geworfen. */
async function sendTemplateSafe(key, reservation_id) {
  try {
    if (!isConfigured()) return false;
    const r = renderTemplate(key, { reservation_id });
    if (!r.to) return false;
    await sendMail({ to: r.to, subject: r.subject, body: r.body, reservation_id, template: key });
    return true;
  } catch (e) {
    console.error(`[mail] ${key} für Reservierung ${reservation_id}: ${e.message}`);
    return false;
  }
}

// ---------- Abrufen (IMAP) ----------
let syncing = false;
async function syncInbox() {
  const m = config();
  if (!m.enabled || !m.user || !m.pass) throw new HttpError(400, 'GMX-Konto ist nicht eingerichtet (Einstellungen → GMX)');
  if (syncing) return { fetched: 0, busy: true };
  syncing = true;
  const state = getSetting('mailState');
  const client = imapClient(m);
  client.on('error', () => {});
  let fetched = 0;
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const validity = String(client.mailbox.uidValidity);
      if (state.uidValidity !== validity) {
        state.uidValidity = validity;
        state.lastUid = 0;
      }
      let uids;
      if (state.lastUid > 0) {
        uids = (await client.search({ uid: `${state.lastUid + 1}:*` }, { uid: true })) || [];
        uids = uids.filter((u) => u > state.lastUid);
      } else {
        uids = (await client.search({ since: new Date(Date.now() - 30 * 86400000) }, { uid: true })) || [];
      }
      uids = uids.slice(-200);
      if (uids.length) {
        for await (const msg of client.fetch(uids, { uid: true, source: { maxLength: 2 * 1024 * 1024 } }, { uid: true })) {
          try {
            const p = await simpleParser(msg.source, { skipImageLinks: true });
            const from = p.from?.value?.[0] || {};
            const addr = (from.address || '').toLowerCase();
            if (addr === m.user.toLowerCase()) continue;
            const mid = p.messageId || `uid-${validity}-${msg.uid}`;
            if (db.prepare('SELECT 1 FROM emails WHERE message_id = ?').get(mid)) continue;
            insertMail.run('in', mid, addr, from.name || '', m.user, p.subject || '(kein Betreff)',
              (p.text || '').slice(0, 100000), (p.date || new Date()).toISOString(), guestByEmail(addr), null, '', 'ok', '', 0);
            fetched++;
          } catch (e) {
            console.error('[mail] Nachricht konnte nicht gelesen werden:', e.message);
          } finally {
            if (msg.uid > state.lastUid) state.lastUid = msg.uid;
          }
        }
      }
    } finally {
      lock.release();
    }
    await client.logout();
    state.lastSync = new Date().toISOString();
    state.lastError = '';
    setSetting('mailState', state);
    return { fetched };
  } catch (e) {
    state.lastError = explain(e);
    setSetting('mailState', state);
    try { client.close(); } catch {}
    throw new HttpError(502, 'Abruf fehlgeschlagen: ' + state.lastError);
  } finally {
    syncing = false;
  }
}

module.exports = { isConfigured, testConnection, renderTemplate, sendMail, sendTemplateSafe, syncInbox, guestByEmail };
