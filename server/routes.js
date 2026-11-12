'use strict';
const express = require('express');
const { db, getSetting, setSetting, tx, encrypt } = require('./db');
const { addDays, diffDays, today, isDate, round2, eachNight, deDate, HttpError } = require('./util');
const pricing = require('./pricing');
const mail = require('./mail');
const smart = require('./smart');

const router = express.Router();
const STATUSES = ['option', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'];
const INACTIVE = ['cancelled', 'no_show'];
const int = (v) => (v === '' || v == null ? null : parseInt(v, 10));
const idParam = (req) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) throw new HttpError(400, 'Ungültige ID');
  return id;
};

// ---------- Generisches CRUD für Stammdaten ----------
const conv = {
  s: (v) => String(v ?? '').trim(),
  n: (v) => (isNaN(Number(v)) ? 0 : Number(v)),
  i: (v) => (isNaN(parseInt(v, 10)) ? 0 : parseInt(v, 10)),
  b: (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0),
  fk: (v) => (v === '' || v == null || v === 0 || v === '0' ? null : parseInt(v, 10)),
  d: (v) => {
    if (!isDate(v)) throw new HttpError(400, 'Ungültiges Datum');
    return v;
  },
};
function crud(path, table, cols, { order = 'id', required = [], validate } = {}) {
  const pick = (body, partial) => {
    const out = {};
    for (const [c, t] of Object.entries(cols)) {
      if (body[c] === undefined) {
        if (partial) continue;
        if (t === 'b' && c === 'active') { out[c] = 1; continue; }
        if (t === 'd') throw new HttpError(400, 'Datum fehlt');
        continue;
      }
      out[c] = conv[t](body[c]);
    }
    for (const r of required) if (r in out && (out[r] === '' || out[r] == null)) throw new HttpError(400, 'Pflichtfeld fehlt: ' + r);
    if (!partial) for (const r of required) if (!(r in out)) throw new HttpError(400, 'Pflichtfeld fehlt: ' + r);
    if (validate) validate(out);
    return out;
  };
  const wrap = (fn) => {
    try {
      return fn();
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new HttpError(409, 'Dieser Eintrag existiert bereits');
      if (/FOREIGN KEY/.test(e.message)) throw new HttpError(409, 'Eintrag wird noch verwendet und kann nicht gelöscht werden');
      throw e;
    }
  };
  router.get(path, (req, res) => res.json(db.prepare(`SELECT * FROM ${table} ORDER BY ${order}`).all()));
  router.post(path, (req, res) => {
    const d = pick(req.body, false);
    const k = Object.keys(d);
    const r = wrap(() => db.prepare(`INSERT INTO ${table} (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...Object.values(d)));
    res.json(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(r.lastInsertRowid));
  });
  router.put(`${path}/:id`, (req, res) => {
    const d = pick(req.body, true);
    const k = Object.keys(d);
    if (k.length) wrap(() => db.prepare(`UPDATE ${table} SET ${k.map((c) => c + ' = ?').join(',')} WHERE id = ?`).run(...Object.values(d), idParam(req)));
    const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(idParam(req));
    if (!row) throw new HttpError(404, 'Nicht gefunden');
    res.json(row);
  });
  router.delete(`${path}/:id`, (req, res) => {
    wrap(() => db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(idParam(req)));
    res.json({ ok: true });
  });
}

crud('/categories', 'room_categories',
  { name: 's', description: 's', base_price: 'n', std_occupancy: 'i', max_persons: 'i', extra_person_price: 'n', color: 's' },
  { required: ['name'], order: 'base_price, id' });
crud('/rooms', 'rooms',
  { number: 's', category_id: 'fk', floor: 's', status: 's', notes: 's', active: 'b' },
  {
    required: ['number', 'category_id'], order: 'number',
    validate: (d) => {
      if (d.status !== undefined && !['clean', 'dirty', 'ooo'].includes(d.status)) throw new HttpError(400, 'Ungültiger Zimmerstatus');
    },
  });
crud('/seasons', 'seasons',
  { name: 's', start_date: 'd', end_date: 'd', category_id: 'fk', mode: 's', value: 'n', weekdays: 's', min_stay: 'i', priority: 'i', active: 'b' },
  {
    required: ['name'], order: 'priority, start_date',
    validate: (d) => {
      if (d.mode !== undefined && !['percent', 'amount', 'fixed'].includes(d.mode)) throw new HttpError(400, 'Ungültige Regelart');
      if (d.start_date && d.end_date && d.end_date < d.start_date) throw new HttpError(400, 'Ende liegt vor dem Beginn');
      if (d.weekdays !== undefined) d.weekdays = d.weekdays.split(',').map((x) => x.trim()).filter((x) => /^[0-6]$/.test(x)).join(',');
      if (d.min_stay !== undefined) d.min_stay = Math.max(1, d.min_stay);
    },
  });
crud('/extras', 'extras', { name: 's', price: 'n', per: 's', vat_rate: 'n', active: 'b' }, {
  required: ['name'],
  validate: (d) => {
    if (d.per !== undefined && !['stay', 'night', 'person_night', 'person_stay'].includes(d.per)) throw new HttpError(400, 'Ungültige Berechnungsart');
  },
});
crud('/templates', 'email_templates', { key: 's', name: 's', subject: 's', body: 's' }, { required: ['name', 'subject'] });

// ---------- Einstellungen ----------
const SETTING_KEYS = ['hotel', 'mail', 'automation', 'dynamic', 'guestStd', 'guestFields'];
function publicSetting(key) {
  const v = getSetting(key);
  if (key === 'mail') {
    const { pass, ...rest } = v;
    return { ...rest, hasPass: !!pass };
  }
  return v;
}
const slug = (s) =>
  String(s).toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

router.get('/bootstrap', (req, res) => {
  const out = {};
  for (const k of SETTING_KEYS) out[k] = publicSetting(k);
  out.mailState = getSetting('mailState');
  out.categories = db.prepare('SELECT * FROM room_categories ORDER BY base_price, id').all();
  out.rooms = db.prepare('SELECT * FROM rooms ORDER BY number').all();
  out.extras = db.prepare('SELECT * FROM extras ORDER BY id').all();
  out.templates = db.prepare('SELECT * FROM email_templates ORDER BY id').all();
  out.today = today();
  res.json(out);
});

router.put('/settings/:key', (req, res) => {
  const key = req.params.key;
  if (!SETTING_KEYS.includes(key)) throw new HttpError(404, 'Unbekannte Einstellung');
  let v = req.body;
  if (key === 'guestFields') {
    if (!Array.isArray(v)) throw new HttpError(400, 'Liste erwartet');
    const seen = new Set();
    v = v.filter((f) => f && String(f.label || '').trim()).map((f) => {
      let k = slug(f.key || f.label) || 'feld';
      while (seen.has(k)) k += '_2';
      seen.add(k);
      const type = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'].includes(f.type) ? f.type : 'text';
      const options = Array.isArray(f.options) ? f.options : String(f.options || '').split(',');
      return { key: k, label: String(f.label).trim(), type, options: options.map((o) => String(o).trim()).filter(Boolean), inList: !!f.inList, required: !!f.required };
    });
  } else {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new HttpError(400, 'Objekt erwartet');
    const cur = getSetting(key);
    if (key === 'mail') {
      const { hasPass, pass, ...rest } = v;
      v = { ...cur, ...rest, pass: pass ? encrypt(pass) : cur.pass };
      v.user = String(v.user || '').trim();
      setSetting('mailState', { ...getSetting('mailState'), lastError: '' });
    } else if (key === 'dynamic') {
      v = {
        enabled: !!v.enabled,
        tiers: (Array.isArray(v.tiers) ? v.tiers : []).map((t) => ({ from: Math.min(100, Math.max(0, Number(t.from) || 0)), percent: Number(t.percent) || 0 })).sort((a, b) => a.from - b.from),
      };
    } else v = { ...cur, ...v };
  }
  setSetting(key, v);
  res.json(publicSetting(key));
});

// ---------- Gäste ----------
const GUEST_COLS = ['salutation', 'first_name', 'last_name', 'company', 'email', 'phone', 'street', 'zip', 'city', 'country', 'birthdate', 'nationality', 'id_number', 'notes'];
function guestData(body, partial = false) {
  const d = {};
  for (const c of GUEST_COLS) if (body[c] !== undefined) d[c] = String(body[c] ?? '').trim();
  if (d.birthdate && !isDate(d.birthdate)) throw new HttpError(400, 'Ungültiges Geburtsdatum');
  if (d.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.email)) throw new HttpError(400, 'Ungültige E-Mail-Adresse');
  if (!partial && !d.last_name) throw new HttpError(400, 'Nachname fehlt');
  if (partial && d.last_name === '') throw new HttpError(400, 'Nachname fehlt');
  if (body.tags !== undefined) d.tags = JSON.stringify((Array.isArray(body.tags) ? body.tags : String(body.tags).split(',')).map((t) => String(t).trim()).filter(Boolean));
  if (body.custom !== undefined && body.custom && typeof body.custom === 'object') {
    const fields = getSetting('guestFields');
    const c = {};
    for (const f of fields) if (body.custom[f.key] !== undefined) c[f.key] = f.type === 'checkbox' ? !!body.custom[f.key] : String(body.custom[f.key] ?? '');
    d.custom = JSON.stringify(c);
  }
  if (body.vip !== undefined) d.vip = body.vip ? 1 : 0;
  if (body.blocked !== undefined) d.blocked = body.blocked ? 1 : 0;
  return d;
}
const parseGuest = (g) => g && { ...g, tags: JSON.parse(g.tags || '[]'), custom: JSON.parse(g.custom || '{}') };
function insertGuest(body) {
  const d = guestData(body);
  const k = Object.keys(d);
  return db.prepare(`INSERT INTO guests (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...Object.values(d)).lastInsertRowid;
}
const GUEST_LIST = `SELECT g.*,
  (SELECT COUNT(*) FROM reservations r WHERE r.guest_id = g.id AND r.status IN ('checked_out','checked_in')) AS stays,
  (SELECT MAX(check_out) FROM reservations r WHERE r.guest_id = g.id AND r.status IN ('checked_out','checked_in')) AS last_stay,
  (SELECT COALESCE(SUM(total),0) FROM reservations r WHERE r.guest_id = g.id AND r.status IN ('checked_out','checked_in')) AS revenue
  FROM guests g`;

function listGuests(q) {
  if (!q) return db.prepare(`${GUEST_LIST} ORDER BY g.last_name COLLATE NOCASE, g.first_name COLLATE NOCASE LIMIT 1000`).all();
  const like = '%' + String(q).replace(/[%_]/g, '') + '%';
  return db
    .prepare(
      `${GUEST_LIST} WHERE g.first_name || ' ' || g.last_name LIKE ?1 OR g.last_name || ' ' || g.first_name LIKE ?1 OR g.email LIKE ?1
       OR g.phone LIKE ?1 OR g.company LIKE ?1 OR g.city LIKE ?1 OR g.tags LIKE ?1 OR g.custom LIKE ?1
       ORDER BY g.last_name COLLATE NOCASE, g.first_name COLLATE NOCASE LIMIT 300`
    )
    .all(like);
}

router.get('/guests', (req, res) => res.json(listGuests(req.query.q).map(parseGuest)));
router.get('/guests/duplicates', (req, res) => res.json(smart.findDuplicates()));
router.get('/guests/export.csv', (req, res) => {
  const fields = getSetting('guestFields');
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // keine Formelausführung in Excel
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const head = ['ID', 'Anrede', 'Vorname', 'Nachname', 'Firma', 'E-Mail', 'Telefon', 'Straße', 'PLZ', 'Ort', 'Land', 'Geburtsdatum', 'Tags', 'VIP', 'Aufenthalte', 'Umsatz', ...fields.map((f) => f.label)];
  const rows = listGuests().map(parseGuest).map((g) =>
    [g.id, g.salutation, g.first_name, g.last_name, g.company, g.email, g.phone, g.street, g.zip, g.city, g.country, g.birthdate, g.tags.join(', '), g.vip ? 'ja' : '', g.stays, String(round2(g.revenue)).replace('.', ','),
      ...fields.map((f) => (f.type === 'checkbox' ? (g.custom[f.key] ? 'ja' : '') : g.custom[f.key] ?? ''))].map(cell).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="gaeste.csv"');
  res.send('﻿' + [head.map(cell).join(';'), ...rows].join('\r\n'));
});
router.get('/guests/:id', (req, res) => {
  const id = idParam(req);
  const g = parseGuest(db.prepare(`${GUEST_LIST} WHERE g.id = ?`).get(id));
  if (!g) throw new HttpError(404, 'Gast nicht gefunden');
  g.reservations = db
    .prepare(
      `SELECT r.id, r.code, r.check_in, r.check_out, r.status, r.total, ro.number AS room_number, c.name AS category_name
       FROM reservations r JOIN rooms ro ON ro.id = r.room_id JOIN room_categories c ON c.id = r.category_id
       WHERE r.guest_id = ? ORDER BY r.check_in DESC`
    )
    .all(id);
  g.emails = db.prepare('SELECT id, direction, subject, date, status, from_addr, to_addr FROM emails WHERE guest_id = ? ORDER BY date DESC LIMIT 100').all(id);
  g.nights = g.reservations.filter((r) => ['checked_out', 'checked_in'].includes(r.status)).reduce((s, r) => s + diffDays(r.check_in, r.check_out), 0);
  g.stammgast = g.stays >= (getSetting('automation').stammgastStays || 3);
  res.json(g);
});
router.post('/guests', (req, res) => {
  const id = insertGuest(req.body);
  const email = String(req.body.email || '').trim();
  const dup = email ? db.prepare('SELECT id, first_name, last_name FROM guests WHERE lower(email) = lower(?) AND id != ?').get(email, id) : null;
  if (email) db.prepare('UPDATE emails SET guest_id = ? WHERE guest_id IS NULL AND (lower(from_addr) = lower(?) OR lower(to_addr) = lower(?))').run(id, email, email);
  res.json({ ...parseGuest(db.prepare('SELECT * FROM guests WHERE id = ?').get(id)), duplicate: dup || null });
});
router.put('/guests/:id', (req, res) => {
  const id = idParam(req);
  const d = guestData(req.body, true);
  const k = Object.keys(d);
  if (k.length) db.prepare(`UPDATE guests SET ${k.map((c) => c + ' = ?').join(',')} WHERE id = ?`).run(...Object.values(d), id);
  const g = db.prepare('SELECT * FROM guests WHERE id = ?').get(id);
  if (!g) throw new HttpError(404, 'Gast nicht gefunden');
  res.json(parseGuest(g));
});
router.delete('/guests/:id', (req, res) => {
  const id = idParam(req);
  if (db.prepare('SELECT 1 FROM reservations WHERE guest_id = ?').get(id))
    throw new HttpError(409, 'Gast hat Reservierungen und kann nicht gelöscht werden. Nutzen Sie stattdessen „Anonymisieren“.');
  db.prepare('DELETE FROM guests WHERE id = ?').run(id);
  res.json({ ok: true });
});
// DSGVO: personenbezogene Daten entfernen, Buchungen bleiben für die Buchhaltung erhalten.
router.post('/guests/:id/anonymize', (req, res) => {
  const id = idParam(req);
  tx(() => {
    db.prepare(
      `UPDATE guests SET salutation='', first_name='', last_name='Anonymisiert', company='', email='', phone='', street='', zip='', city='',
       country='', birthdate='', nationality='', id_number='', notes='', tags='[]', custom='{}', vip=0 WHERE id = ?`
    ).run(id);
    db.prepare('DELETE FROM emails WHERE guest_id = ?').run(id);
  });
  res.json({ ok: true });
});
router.post('/guests/merge', (req, res) => {
  const keep = int(req.body.keep_id);
  const remove = int(req.body.remove_id);
  const a = db.prepare('SELECT * FROM guests WHERE id = ?').get(keep);
  const b = db.prepare('SELECT * FROM guests WHERE id = ?').get(remove);
  if (!a || !b || keep === remove) throw new HttpError(400, 'Ungültige Auswahl');
  tx(() => {
    const upd = {};
    for (const c of GUEST_COLS) if (!a[c] && b[c]) upd[c] = b[c];
    if (a.notes && b.notes && a.notes !== b.notes) upd.notes = a.notes + '\n' + b.notes;
    upd.tags = JSON.stringify([...new Set([...JSON.parse(a.tags), ...JSON.parse(b.tags)])]);
    upd.custom = JSON.stringify({ ...JSON.parse(b.custom), ...Object.fromEntries(Object.entries(JSON.parse(a.custom)).filter(([, v]) => v !== '' && v != null)) });
    upd.vip = a.vip || b.vip ? 1 : 0;
    const k = Object.keys(upd);
    db.prepare(`UPDATE guests SET ${k.map((c) => c + ' = ?').join(',')} WHERE id = ?`).run(...Object.values(upd), keep);
    db.prepare('UPDATE reservations SET guest_id = ? WHERE guest_id = ?').run(keep, remove);
    db.prepare('UPDATE emails SET guest_id = ? WHERE guest_id = ?').run(keep, remove);
    db.prepare('DELETE FROM guests WHERE id = ?').run(remove);
  });
  res.json({ ok: true });
});

// ---------- Reservierungen ----------
const RES_SELECT = `SELECT r.*, g.first_name, g.last_name, g.email AS guest_email, g.phone AS guest_phone, g.vip, g.blocked,
  ro.number AS room_number, ro.status AS room_status, c.name AS category_name, c.color,
  (SELECT COALESCE(SUM(amount),0) FROM payments p WHERE p.reservation_id = r.id) AS paid
  FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN rooms ro ON ro.id = r.room_id JOIN room_categories c ON c.id = r.category_id`;
const shape = (r) => r && { ...r, nightly: undefined, balance: round2(r.total - r.paid), nights: diffDays(r.check_in, r.check_out) };

function getReservation(id) {
  const r = db.prepare(`${RES_SELECT} WHERE r.id = ?`).get(id);
  if (!r) throw new HttpError(404, 'Reservierung nicht gefunden');
  const out = shape(r);
  out.nightly = JSON.parse(r.nightly || '[]');
  out.extras = db.prepare('SELECT * FROM reservation_extras WHERE reservation_id = ? ORDER BY id').all(id);
  out.payments = db.prepare('SELECT * FROM payments WHERE reservation_id = ? ORDER BY date, id').all(id);
  return out;
}

function saveReservation(body, id = null) {
  const existing = id ? db.prepare('SELECT * FROM reservations WHERE id = ?').get(id) : null;
  if (id && !existing) throw new HttpError(404, 'Reservierung nicht gefunden');
  const val = (k, def) => (body[k] !== undefined ? body[k] : existing ? existing[k] : def);
  const warnings = [];

  const check_in = val('check_in');
  const check_out = val('check_out');
  const adults = Math.max(1, int(val('adults', 1)) || 1);
  const children = Math.max(0, int(val('children', 0)) || 0);
  const status = val('status', 'confirmed');
  if (!STATUSES.includes(status)) throw new HttpError(400, 'Ungültiger Status');
  const manualRaw = val('manual_price', null);
  const manual_price = manualRaw === '' || manualRaw == null ? null : Number(manualRaw);
  if (manual_price !== null && (isNaN(manual_price) || manual_price < 0)) throw new HttpError(400, 'Ungültiger manueller Preis');

  return tx(() => {
    // Gast: vorhandene ID oder neuer Gast (bei gleicher E-Mail wird der bestehende Eintrag verwendet)
    let guest_id = int(val('guest_id'));
    if (!guest_id && body.guest) {
      const email = String(body.guest.email || '').trim();
      const found = email ? db.prepare('SELECT id FROM guests WHERE lower(email) = lower(?) ORDER BY id LIMIT 1').get(email) : null;
      if (found) {
        guest_id = found.id;
        warnings.push('Gast mit dieser E-Mail-Adresse war bereits in der Kartei und wurde zugeordnet');
      } else guest_id = insertGuest(body.guest);
    }
    const guest = guest_id && db.prepare('SELECT * FROM guests WHERE id = ?').get(guest_id);
    if (!guest) throw new HttpError(400, 'Bitte einen Gast auswählen oder anlegen');
    if (guest.blocked) warnings.push('Achtung: Gast ist in der Kartei als gesperrt markiert');

    if (!isDate(check_in) || !isDate(check_out) || check_out <= check_in) throw new HttpError(400, 'Bitte gültigen Zeitraum angeben');

    // Zimmer: fest gewählt oder automatische Zuweisung (Best Fit)
    let room_id = body.room_id === 'auto' ? null : int(val('room_id'));
    let category_id = int(val('category_id'));
    const active = !INACTIVE.includes(status);
    if (!room_id) {
      if (!category_id) throw new HttpError(400, 'Bitte Kategorie oder Zimmer wählen');
      const free = pricing.freeRooms(check_in, check_out, id || 0).filter((r) => r.category_id === category_id);
      if (!free.length) throw new HttpError(409, 'In dieser Kategorie ist im Zeitraum kein Zimmer frei');
      room_id = free[0].id;
    }
    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(room_id);
    if (!room) throw new HttpError(400, 'Zimmer nicht gefunden');
    if (!category_id) category_id = room.category_id;
    if (active && pricing.hasConflict(room_id, check_in, check_out, id || 0))
      throw new HttpError(409, `Zimmer ${room.number} ist im gewählten Zeitraum bereits belegt`);
    if (active && room.status === 'ooo' && !['checked_out'].includes(status)) warnings.push(`Zimmer ${room.number} ist als „außer Betrieb“ markiert`);

    let extras = body.extras;
    if (extras === undefined && existing)
      extras = db.prepare('SELECT extra_id, qty FROM reservation_extras WHERE reservation_id = ?').all(id);
    const q = pricing.quote({ category_id, check_in, check_out, adults, children, extras: extras || [], manual_price, exclude_id: id || 0 });
    warnings.push(...q.warnings);

    const data = {
      guest_id, room_id, category_id, check_in, check_out, adults, children, status,
      source: String(val('source', '') || ''), notes: String(val('notes', '') || ''), manual_price,
      lodging_total: q.lodging, extras_total: q.extrasTotal, city_tax_total: q.cityTax, total: q.total,
      nightly: JSON.stringify(q.nightly),
    };
    const k = Object.keys(data);
    if (existing) {
      db.prepare(`UPDATE reservations SET ${k.map((c) => c + ' = ?').join(',')}, updated_at = datetime('now') WHERE id = ?`).run(...Object.values(data), id);
    } else {
      id = Number(db.prepare(`INSERT INTO reservations (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...Object.values(data)).lastInsertRowid);
      db.prepare('UPDATE reservations SET code = ? WHERE id = ?').run(`B${check_in.slice(2, 4)}-${String(id).padStart(5, '0')}`, id);
    }
    db.prepare('DELETE FROM reservation_extras WHERE reservation_id = ?').run(id);
    const ins = db.prepare('INSERT INTO reservation_extras (reservation_id, extra_id, name, qty, per, unit_price, vat_rate, total) VALUES (?,?,?,?,?,?,?,?)');
    for (const e of q.extras) ins.run(id, e.extra_id, e.name, e.qty, e.per, e.unit_price, e.vat_rate, e.total);
    return { id, warnings, becameConfirmed: status === 'confirmed' && (!existing || existing.status === 'option') };
  });
}

function maybeConfirm(id, allow) {
  if (!allow || !getSetting('automation').confirmOnBooking) return false;
  const r = db.prepare('SELECT confirmation_sent, guest_id FROM reservations WHERE id = ?').get(id);
  const g = db.prepare('SELECT email FROM guests WHERE id = ?').get(r.guest_id);
  if (r.confirmation_sent || !g.email || !mail.isConfigured()) return false;
  db.prepare('UPDATE reservations SET confirmation_sent = 1 WHERE id = ?').run(id);
  mail.sendTemplateSafe('confirmation', id).then((ok) => {
    if (!ok) db.prepare('UPDATE reservations SET confirmation_sent = 0 WHERE id = ?').run(id);
  });
  return true;
}

router.get('/reservations', (req, res) => {
  const { from, to, status, q, guest_id } = req.query;
  const where = [];
  const p = [];
  if (isDate(from)) { where.push('r.check_out >= ?'); p.push(from); }
  if (isDate(to)) { where.push('r.check_in <= ?'); p.push(to); }
  if (status === 'active') where.push("r.status NOT IN ('cancelled','no_show')");
  else if (STATUSES.includes(status)) { where.push('r.status = ?'); p.push(status); }
  if (guest_id) { where.push('r.guest_id = ?'); p.push(int(guest_id)); }
  if (q) {
    const like = '%' + String(q).replace(/[%_]/g, '') + '%';
    where.push("(g.first_name || ' ' || g.last_name LIKE ? OR r.code LIKE ? OR ro.number LIKE ? OR g.company LIKE ?)");
    p.push(like, like, like, like);
  }
  const rows = db.prepare(`${RES_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.check_in DESC, r.id DESC LIMIT 500`).all(...p);
  res.json(rows.map(shape));
});
router.get('/reservations/:id', (req, res) => res.json(getReservation(idParam(req))));
router.post('/reservations', (req, res) => {
  const r = saveReservation(req.body);
  const mailQueued = maybeConfirm(r.id, r.becameConfirmed && req.body.send_confirmation !== false);
  res.json({ ...getReservation(r.id), warnings: r.warnings, mailQueued });
});
router.put('/reservations/:id', (req, res) => {
  const r = saveReservation(req.body, idParam(req));
  const mailQueued = maybeConfirm(r.id, r.becameConfirmed && req.body.send_confirmation !== false);
  res.json({ ...getReservation(r.id), warnings: r.warnings, mailQueued });
});
router.delete('/reservations/:id', (req, res) => {
  const r = db.prepare('SELECT status, invoice_no FROM reservations WHERE id = ?').get(idParam(req));
  if (!r) throw new HttpError(404, 'Reservierung nicht gefunden');
  if (r.invoice_no) throw new HttpError(409, 'Reservierungen mit Rechnung können nicht gelöscht werden');
  if (!INACTIVE.includes(r.status) && r.status !== 'option') throw new HttpError(409, 'Nur stornierte Reservierungen oder Optionen können gelöscht werden');
  db.prepare('DELETE FROM reservations WHERE id = ?').run(idParam(req));
  res.json({ ok: true });
});

router.post('/reservations/:id/status', async (req, res) => {
  const id = idParam(req);
  const next = req.body.status;
  const r = db.prepare('SELECT * FROM reservations WHERE id = ?').get(id);
  if (!r) throw new HttpError(404, 'Reservierung nicht gefunden');
  const allowed = {
    option: ['confirmed', 'cancelled', 'no_show', 'checked_in'],
    confirmed: ['option', 'checked_in', 'cancelled', 'no_show'],
    checked_in: ['checked_out', 'confirmed'],
    checked_out: ['checked_in'],
    cancelled: ['confirmed', 'option'],
    no_show: ['confirmed'],
  };
  if (!allowed[r.status]?.includes(next)) throw new HttpError(409, 'Dieser Statuswechsel ist nicht möglich');
  if (INACTIVE.includes(r.status) && pricing.hasConflict(r.room_id, r.check_in, r.check_out, id))
    throw new HttpError(409, 'Zimmer ist im Zeitraum inzwischen anderweitig belegt');
  const auto = getSetting('automation');
  tx(() => {
    db.prepare("UPDATE reservations SET status = ?, updated_at = datetime('now') WHERE id = ?").run(next, id);
    if (next === 'checked_out' && auto.dirtyOnCheckout) db.prepare("UPDATE rooms SET status = 'dirty' WHERE id = ? AND status = 'clean'").run(r.room_id);
  });
  let mailQueued = false;
  if (next === 'confirmed' && r.status === 'option') mailQueued = maybeConfirm(id, true);
  if (next === 'cancelled' && req.body.notify) mailQueued = await mail.sendTemplateSafe('cancellation', id);
  res.json({ ...getReservation(id), mailQueued });
});

router.post('/reservations/:id/payments', (req, res) => {
  const id = idParam(req);
  const amount = round2(Number(req.body.amount));
  if (!amount || isNaN(amount)) throw new HttpError(400, 'Ungültiger Betrag');
  if (!db.prepare('SELECT 1 FROM reservations WHERE id = ?').get(id)) throw new HttpError(404, 'Reservierung nicht gefunden');
  const date = isDate(req.body.date) ? req.body.date : today();
  db.prepare('INSERT INTO payments (reservation_id, amount, method, date, note) VALUES (?,?,?,?,?)').run(id, amount, String(req.body.method || ''), date, String(req.body.note || ''));
  res.json(getReservation(id));
});
router.delete('/payments/:id', (req, res) => {
  const p = db.prepare('SELECT reservation_id FROM payments WHERE id = ?').get(idParam(req));
  if (!p) throw new HttpError(404, 'Zahlung nicht gefunden');
  db.prepare('DELETE FROM payments WHERE id = ?').run(idParam(req));
  res.json(getReservation(p.reservation_id));
});
router.post('/reservations/:id/invoice', (req, res) => {
  const id = idParam(req);
  tx(() => {
    const r = db.prepare('SELECT invoice_no FROM reservations WHERE id = ?').get(id);
    if (!r) throw new HttpError(404, 'Reservierung nicht gefunden');
    if (r.invoice_no) return;
    const c = getSetting('counters');
    c.invoice = (c.invoice || 0) + 1;
    setSetting('counters', c);
    const t = today();
    const no = `${getSetting('hotel').invoicePrefix || ''}${t.slice(0, 4)}-${String(c.invoice).padStart(4, '0')}`;
    db.prepare('UPDATE reservations SET invoice_no = ?, invoice_date = ? WHERE id = ?').run(no, t, id);
  });
  res.json(getReservation(id));
});

router.post('/quote', (req, res) => {
  const b = req.body;
  const q = pricing.quote({ ...b, category_id: int(b.category_id), exclude_id: int(b.exclude_id) || 0 });
  res.json(q);
});
router.get('/availability', (req, res) => {
  const { check_in, check_out } = req.query;
  if (!isDate(check_in) || !isDate(check_out) || check_out <= check_in) throw new HttpError(400, 'Bitte gültigen Zeitraum angeben');
  res.json(pricing.freeRooms(check_in, check_out, int(req.query.exclude_id) || 0));
});

// ---------- Belegungsplan ----------
router.get('/calendar', (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : today();
  const days = Math.min(62, Math.max(7, int(req.query.days) || 21));
  const to = addDays(from, days);
  res.json({
    from, days,
    rooms: db.prepare('SELECT r.*, c.name AS category_name, c.color FROM rooms r JOIN room_categories c ON c.id = r.category_id WHERE r.active = 1 ORDER BY r.number').all(),
    reservations: db.prepare(`${RES_SELECT} WHERE r.status NOT IN ('cancelled','no_show') AND r.check_in < ? AND r.check_out > ? ORDER BY r.check_in`).all(to, from).map(shape),
    occupancy: pricing.occupancyMap(from, to),
    sellable: pricing.sellableRooms(),
  });
});

// ---------- Kennzahlen ----------
function periodStats(from, to) {
  const rows = db
    .prepare("SELECT check_in, check_out, nightly, source FROM reservations WHERE status IN ('confirmed','checked_in','checked_out') AND check_in < ? AND check_out > ?")
    .all(to, from);
  let nights = 0;
  let revenue = 0;
  const sources = {};
  for (const r of rows) {
    for (const n of JSON.parse(r.nightly || '[]')) {
      if (n.date >= from && n.date < to) {
        nights++;
        revenue += n.price;
        sources[r.source || 'Direkt'] = (sources[r.source || 'Direkt'] || 0) + n.price;
      }
    }
  }
  const capacity = pricing.sellableRooms() * diffDays(from, to);
  return {
    nights, revenue: round2(revenue), capacity,
    occupancy: capacity ? round2((nights / capacity) * 100) : 0,
    adr: nights ? round2(revenue / nights) : 0,
    revpar: capacity ? round2(revenue / capacity) : 0,
    sources,
  };
}

router.get('/dashboard', (req, res) => {
  const t = today();
  const list = (where, ...p) => db.prepare(`${RES_SELECT} WHERE ${where} ORDER BY ro.number`).all(...p).map(shape);
  const sellable = pricing.sellableRooms();
  const occ = pricing.occupancyMap(t, addDays(t, 14));
  const monthStart = t.slice(0, 8) + '01';
  const nextMonth = addDays(monthStart, 32).slice(0, 8) + '01';
  res.json({
    today: t, sellable,
    occupiedTonight: occ[t] || 0,
    arrivals: list("r.status IN ('confirmed','option') AND r.check_in = ?", t),
    departures: list("r.status = 'checked_in' AND r.check_out <= ?", t),
    inhouse: list("r.status = 'checked_in'"),
    month: periodStats(monthStart, nextMonth),
    forecast: eachNight(t, addDays(t, 14)).map((d) => ({ date: d, occupied: occ[d] || 0 })),
    rooms: db.prepare('SELECT status, COUNT(*) n FROM rooms WHERE active = 1 GROUP BY status').all(),
    hints: smart.hints(),
    mailConfigured: mail.isConfigured(),
  });
});
router.get('/reports', (req, res) => {
  const year = int(req.query.year) || Number(today().slice(0, 4));
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const from = `${year}-${String(m).padStart(2, '0')}-01`;
    const to = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`;
    months.push({ month: m, ...periodStats(from, to) });
  }
  res.json({ year, months, total: periodStats(`${year}-01-01`, `${year + 1}-01-01`) });
});

// ---------- E-Mail (GMX) ----------
router.post('/mail/test', async (req, res) => res.json(await mail.testConnection()));
router.post('/mail/sync', async (req, res) => res.json(await mail.syncInbox()));
router.post('/mail/render', (req, res) => {
  res.json(mail.renderTemplate(int(req.body.template_id), { reservation_id: int(req.body.reservation_id), guest_id: int(req.body.guest_id) }));
});
router.post('/mail/send', async (req, res) => {
  const b = req.body;
  let in_reply_to = null;
  if (b.reply_to_email_id) in_reply_to = db.prepare('SELECT message_id FROM emails WHERE id = ?').get(int(b.reply_to_email_id))?.message_id || null;
  if (in_reply_to && in_reply_to.startsWith('uid-')) in_reply_to = null;
  const r = await mail.sendMail({
    to: String(b.to || '').trim(), subject: String(b.subject || ''), body: String(b.body || ''),
    guest_id: int(b.guest_id), reservation_id: int(b.reservation_id), template: String(b.template || ''), in_reply_to,
  });
  res.json(r);
});
router.get('/emails', (req, res) => {
  const box = req.query.box;
  const where = [];
  const p = [];
  if (box === 'out') where.push("e.direction = 'out'");
  else if (box === 'archive') where.push("e.direction = 'in' AND e.archived = 1");
  else where.push("e.direction = 'in' AND e.archived = 0");
  if (req.query.q) {
    const like = '%' + String(req.query.q).replace(/[%_]/g, '') + '%';
    where.push('(e.subject LIKE ? OR e.from_addr LIKE ? OR e.from_name LIKE ? OR e.to_addr LIKE ? OR e.body LIKE ?)');
    p.push(like, like, like, like, like);
  }
  res.json(
    db.prepare(
      `SELECT e.id, e.direction, e.from_addr, e.from_name, e.to_addr, e.subject, e.date, e.guest_id, e.reservation_id, e.status, e.is_read, e.template,
        substr(e.body, 1, 140) AS preview, g.first_name, g.last_name
       FROM emails e LEFT JOIN guests g ON g.id = e.guest_id WHERE ${where.join(' AND ')} ORDER BY e.date DESC LIMIT 300`
    ).all(...p)
  );
});
router.get('/emails/:id', (req, res) => {
  const id = idParam(req);
  const e = db.prepare('SELECT e.*, g.first_name, g.last_name FROM emails e LEFT JOIN guests g ON g.id = e.guest_id WHERE e.id = ?').get(id);
  if (!e) throw new HttpError(404, 'E-Mail nicht gefunden');
  if (!e.is_read) db.prepare('UPDATE emails SET is_read = 1 WHERE id = ?').run(id);
  if (e.direction === 'in') e.inquiry = smart.parseInquiry(`${e.subject}\n${e.body}`, e.date.slice(0, 10) < today() ? today() : e.date.slice(0, 10));
  res.json(e);
});
router.put('/emails/:id', (req, res) => {
  const id = idParam(req);
  const b = req.body;
  if (b.archived !== undefined) db.prepare('UPDATE emails SET archived = ? WHERE id = ?').run(b.archived ? 1 : 0, id);
  if (b.is_read !== undefined) db.prepare('UPDATE emails SET is_read = ? WHERE id = ?').run(b.is_read ? 1 : 0, id);
  if (b.guest_id !== undefined) db.prepare('UPDATE emails SET guest_id = ? WHERE id = ?').run(int(b.guest_id), id);
  res.json({ ok: true });
});
router.delete('/emails/:id', (req, res) => {
  db.prepare('DELETE FROM emails WHERE id = ?').run(idParam(req));
  res.json({ ok: true });
});

module.exports = { router, getReservation, saveReservation, periodStats };
