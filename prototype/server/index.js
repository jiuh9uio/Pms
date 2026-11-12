'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db, getSetting, setSetting } = require('./db');
const { HttpError, esc, deDate, money, round2 } = require('./util');
const { router, getReservation } = require('./routes');
const smart = require('./smart');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'");
  next();
});

// ---------- Anmeldung ----------
const SESSION_DAYS = 14;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const cookieToken = (req) => /(?:^|;\s*)pms_sid=([a-f0-9]{64})/.exec(req.headers.cookie || '')?.[1];
function loggedIn(req) {
  const t = cookieToken(req);
  if (!t) return false;
  const s = db.prepare('SELECT expires FROM sessions WHERE token_hash = ?').get(sha(t));
  return !!s && s.expires > Date.now();
}
function startSession(req, res) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token_hash, expires) VALUES (?, ?)').run(sha(token), Date.now() + SESSION_DAYS * 86400000);
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `pms_sid=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}
const attempts = new Map();
function throttle(req) {
  const ip = req.ip;
  const a = attempts.get(ip) || { n: 0, until: 0 };
  if (a.until > Date.now()) throw new HttpError(429, 'Zu viele Fehlversuche. Bitte kurz warten.');
  return {
    fail() {
      a.n++;
      if (a.n >= 5) { a.until = Date.now() + 60000; a.n = 0; }
      attempts.set(ip, a);
    },
    ok: () => attempts.delete(ip),
  };
}
function setPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) throw new HttpError(400, 'Das Passwort muss mindestens 8 Zeichen haben');
  const salt = crypto.randomBytes(16).toString('hex');
  setSetting('auth', { salt, hash: hashPw(pw, salt) });
}
function checkPassword(pw) {
  const a = getSetting('auth');
  if (!a.hash || typeof pw !== 'string') return false;
  return crypto.timingSafeEqual(Buffer.from(hashPw(pw, a.salt), 'hex'), Buffer.from(a.hash, 'hex'));
}

app.get('/api/auth/state', (req, res) => res.json({ needsSetup: !getSetting('auth').hash, loggedIn: loggedIn(req) }));
app.post('/api/auth/setup', (req, res) => {
  if (getSetting('auth').hash) throw new HttpError(403, 'Bereits eingerichtet');
  setPassword(req.body.password);
  startSession(req, res);
  res.json({ ok: true });
});
app.post('/api/auth/login', (req, res) => {
  const t = throttle(req);
  if (!checkPassword(req.body.password)) {
    t.fail();
    throw new HttpError(401, 'Falsches Passwort');
  }
  t.ok();
  startSession(req, res);
  res.json({ ok: true });
});
app.post('/api/auth/logout', (req, res) => {
  const t = cookieToken(req);
  if (t) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(t));
  res.setHeader('Set-Cookie', 'pms_sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});
const requireAuth = (req, res, next) => (loggedIn(req) ? next() : next(new HttpError(401, 'Nicht angemeldet')));
app.post('/api/auth/password', requireAuth, (req, res) => {
  if (!checkPassword(req.body.current)) throw new HttpError(400, 'Aktuelles Passwort ist falsch');
  setPassword(req.body.password);
  db.prepare('DELETE FROM sessions').run();
  startSession(req, res);
  res.json({ ok: true });
});

app.use('/api', requireAuth, router);

// ---------- Rechnung (Druckansicht) ----------
const PER = { stay: 'pro Aufenthalt', night: 'pro Nacht', person_night: 'pro Person/Nacht', person_stay: 'pro Person' };
app.get('/invoice/:id', (req, res) => {
  if (!loggedIn(req)) return res.redirect('/');
  const r = getReservation(parseInt(req.params.id, 10));
  const g = db.prepare('SELECT * FROM guests WHERE id = ?').get(r.guest_id);
  const h = getSetting('hotel');
  const m = (n) => money(n, h.currency);
  // Nächte mit gleichem Preis zusammenfassen
  const groups = [];
  for (const n of r.nightly) {
    const last = groups[groups.length - 1];
    if (last && last.price === n.price) { last.qty++; last.to = n.date; }
    else groups.push({ price: n.price, qty: 1, from: n.date, to: n.date });
  }
  const rows = groups.map((x) =>
    `<tr><td>Übernachtung ${esc(r.category_name)}, Zimmer ${esc(r.room_number)}<br><small>${deDate(x.from)}${x.qty > 1 ? ' – ' + deDate(x.to) : ''}</small></td>
     <td class="r">${x.qty}</td><td class="r">${m(x.price)}</td><td class="r">${h.vatLodging} %</td><td class="r">${m(x.price * x.qty)}</td></tr>`);
  for (const e of r.extras)
    rows.push(`<tr><td>${esc(e.name)}<br><small>${PER[e.per] || ''}</small></td><td class="r">${e.qty}</td><td class="r">${m(e.unit_price)}</td><td class="r">${e.vat_rate} %</td><td class="r">${m(e.total)}</td></tr>`);
  if (r.city_tax_total) rows.push(`<tr><td>Kurtaxe / Gästebeitrag</td><td class="r"></td><td class="r"></td><td class="r">–</td><td class="r">${m(r.city_tax_total)}</td></tr>`);
  const byRate = {};
  byRate[h.vatLodging] = r.lodging_total;
  for (const e of r.extras) byRate[e.vat_rate] = round2((byRate[e.vat_rate] || 0) + e.total);
  const vatRows = Object.entries(byRate).filter(([, gross]) => gross).map(([rate, gross]) => {
    const net = round2(gross / (1 + rate / 100));
    return `<tr><td>Netto ${rate} %: ${m(net)}</td><td class="r">MwSt. ${rate} %: ${m(gross - net)}</td></tr>`;
  });
  const addr = [g.company, [g.salutation, g.first_name, g.last_name].filter(Boolean).join(' '), g.street, [g.zip, g.city].filter(Boolean).join(' '), g.country]
    .filter(Boolean).map(esc).join('<br>');
  res.send(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${r.invoice_no ? 'Rechnung ' + esc(r.invoice_no) : 'Rechnungsentwurf'}</title>
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/invoice.css"></head><body>
<div class="bar noprint"><button id="print">Drucken / als PDF speichern</button>${r.invoice_no ? '' : '<span>Entwurf – Rechnungsnummer wird in der Reservierung über „Rechnung erstellen“ vergeben.</span>'}</div>
<main>
<header><div><h1>${esc(h.name)}</h1><p>${[h.street, [h.zip, h.city].filter(Boolean).join(' '), h.phone, h.email, h.website].filter(Boolean).map(esc).join(' · ')}</p></div></header>
<section class="meta"><address>${addr}</address>
<table><tr><td>${r.invoice_no ? 'Rechnungsnr.' : 'Entwurf'}</td><td>${esc(r.invoice_no || '–')}</td></tr>
<tr><td>Datum</td><td>${deDate(r.invoice_date || new Date().toISOString().slice(0, 10))}</td></tr>
<tr><td>Buchungsnr.</td><td>${esc(r.code)}</td></tr>
<tr><td>Aufenthalt</td><td>${deDate(r.check_in)} – ${deDate(r.check_out)}</td></tr></table></section>
<h2>${r.invoice_no ? 'Rechnung' : 'Rechnungsentwurf'}</h2>
<table class="pos"><thead><tr><th>Leistung</th><th class="r">Menge</th><th class="r">Einzelpreis</th><th class="r">MwSt.</th><th class="r">Betrag</th></tr></thead>
<tbody>${rows.join('')}</tbody>
<tfoot><tr><td colspan="4">Gesamtbetrag (brutto)</td><td class="r">${m(r.total)}</td></tr>
${r.paid ? `<tr class="light"><td colspan="4">Bereits bezahlt</td><td class="r">${m(-r.paid)}</td></tr><tr><td colspan="4">Offener Betrag</td><td class="r">${m(r.balance)}</td></tr>` : ''}</tfoot></table>
<table class="vat">${vatRows.join('')}</table>
<footer><p>${esc(h.invoiceFooter).replace(/\n/g, '<br>')}</p><p>${[h.taxId && 'USt-IdNr./Steuernr.: ' + h.taxId, h.bank].filter(Boolean).map(esc).join(' · ')}</p></footer>
</main><script src="/invoice.js"></script></body></html>`);
});

app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Interner Fehler' : err.message });
});

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  app.listen(port, host, () => {
    console.log(`Hotel-PMS läuft auf http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    smart.startScheduler();
  });
}

module.exports = app;
