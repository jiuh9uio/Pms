'use strict';
const { db, getSetting } = require('./db');
const { addDays, diffDays, today, iso, deDate } = require('./util');
const mail = require('./mail');

const MONTHS = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const NUMWORDS = { eine: 1, einen: 1, ein: 1, zwei: 2, drei: 3, vier: 4, fünf: 5, sechs: 6 };

function mkDate(day, month, year, ref) {
  day = Number(day);
  month = Number(month);
  if (!(day >= 1 && day <= 31 && month >= 1 && month <= 12)) return null;
  let y = year ? Number(year) : null;
  if (y !== null && y < 100) y += 2000;
  const build = (yy) => {
    const d = new Date(Date.UTC(yy, month - 1, day));
    return d.getUTCMonth() === month - 1 ? iso(d) : null;
  };
  if (y) return build(y);
  const ry = Number(ref.slice(0, 4));
  const cand = build(ry);
  return cand && cand >= ref ? cand : build(ry + 1);
}

/**
 * Liest aus einer Anfrage-E-Mail Zeitraum, Personenzahl und Zimmerwunsch heraus.
 * Heuristik – das Ergebnis dient als Vorbelegung und wird vom Nutzer geprüft.
 */
function parseInquiry(text, ref = today()) {
  const t = ' ' + String(text || '').replace(/\s+/g, ' ') + ' ';
  const lower = t.toLowerCase();
  const found = [];
  const push = (d, idx) => d && found.push({ d, idx });
  const mon = MONTHS.join('|').replace('märz', 'm(?:ä|ae)rz');
  const monIdx = (s) => MONTHS.indexOf(s.toLowerCase().replace('maerz', 'märz')) + 1;
  let m;

  // „12.-15.03.2027“ / „12. bis 15.3.“
  const r1 = /(?<![\d.])(\d{1,2})\.\s*(?:-|–|bis(?: zum)?|und)\s*(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}|\d{2})(?!\d))?/gi;
  while ((m = r1.exec(t))) {
    const out = mkDate(m[2], m[3], m[4], ref);
    if (out) {
      let inn = mkDate(m[1], m[3], out.slice(0, 4), ref);
      if (inn && inn > out) inn = iso(new Date(Date.UTC(Number(out.slice(0, 4)), Number(m[3]) - 2, Number(m[1]))));
      push(inn, m.index);
      push(out, m.index + 1);
    }
  }
  // „12. bis 15. März 2027“
  const r2 = new RegExp(`(\\d{1,2})\\.?\\s*(?:-|–|bis(?: zum)?|und)\\s*(\\d{1,2})\\.?\\s*(${mon})(?:\\s*(\\d{4}))?`, 'gi');
  while ((m = r2.exec(t))) {
    const out = mkDate(m[2], monIdx(m[3]), m[4], ref);
    if (out) {
      push(mkDate(m[1], monIdx(m[3]), out.slice(0, 4), ref), m.index);
      push(out, m.index + 1);
    }
  }
  if (found.length < 2) {
    const r3 = /(?<![\d.])(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}|\d{2})(?!\d))?/g;
    while ((m = r3.exec(t))) push(mkDate(m[1], m[2], m[3], ref), m.index);
    const r4 = new RegExp(`(\\d{1,2})\\.?\\s*(${mon})(?:\\s*(\\d{4}))?`, 'gi');
    while ((m = r4.exec(t))) push(mkDate(m[1], monIdx(m[2]), m[3], ref), m.index);
  }
  const dates = [...new Set(found.sort((a, b) => a.idx - b.idx).map((x) => x.d))];

  const res = { check_in: null, check_out: null, adults: null, children: 0, category_id: null, isInquiry: false };
  if (dates.length >= 2) {
    [res.check_in, res.check_out] = [dates[0], dates[1]].sort();
    if (res.check_in === res.check_out) res.check_out = null;
  } else if (dates.length === 1) res.check_in = dates[0];
  const nightsM = lower.match(/(\d+|eine|zwei|drei|vier|fünf|sechs)\s*(?:nächte|nacht|übernachtung)/);
  if (res.check_in && !res.check_out && nightsM) {
    const n = Number(nightsM[1]) || NUMWORDS[nightsM[1]];
    if (n > 0 && n < 60) res.check_out = addDays(res.check_in, n);
  }
  const num = (s) => Number(s) || NUMWORDS[s] || null;
  const ad = lower.match(/(\d+|eine|zwei|drei|vier|fünf|sechs)\s*(?:personen|person|erwachsene|pers\.|gäste)/);
  if (ad) res.adults = num(ad[1]);
  else if (/zu zweit|für uns beide|meine frau und ich|mein mann und ich/.test(lower)) res.adults = 2;
  const ch = lower.match(/(\d+|ein|zwei|drei|vier)\s*(?:kinder|kind)\b/);
  if (ch) res.children = num(ch[1]) || 0;
  if (res.adults && res.adults > 20) res.adults = null;

  const cats = db.prepare('SELECT id, name FROM room_categories').all();
  const hit = cats.find((c) => lower.includes(c.name.toLowerCase()));
  if (hit) res.category_id = hit.id;
  res.isInquiry =
    /anfrage|buchen|buchung|reservier|verfügbar|zimmer frei|freies zimmer|übernacht|angebot/.test(lower) || !!res.check_in;
  return res;
}

/** Mögliche Dubletten in der Kundenkartei (gleiche E-Mail, Telefonnummer oder Name + Ort/Geburtstag). */
function findDuplicates() {
  const guests = db.prepare('SELECT id, first_name, last_name, email, phone, city, birthdate FROM guests').all();
  const groups = new Map();
  const add = (k, g, reason) => {
    if (!groups.has(k)) groups.set(k, { reason, guests: [] });
    groups.get(k).guests.push(g);
  };
  for (const g of guests) {
    if (g.email) add('e:' + g.email.toLowerCase().trim(), g, 'gleiche E-Mail-Adresse');
    const ph = (g.phone || '').replace(/\D/g, '').replace(/^(0049|49|0)/, '');
    if (ph.length >= 6) add('p:' + ph, g, 'gleiche Telefonnummer');
    const name = `${g.first_name} ${g.last_name}`.toLowerCase().replace(/\s+/g, ' ').trim();
    if (g.first_name && g.last_name) add(`n:${name}|${(g.city || '').toLowerCase()}|${g.birthdate || ''}`, g, 'gleicher Name');
  }
  const seen = new Set();
  const out = [];
  for (const grp of groups.values()) {
    if (grp.guests.length < 2) continue;
    const key = grp.guests.map((g) => g.id).sort((a, b) => a - b).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(grp);
  }
  return out;
}

/** Hinweise für das Dashboard. */
function hints() {
  const t = today();
  const auto = getSetting('automation');
  const out = [];
  const q = (sql, ...p) => db.prepare(sql).all(...p);
  const R = `SELECT r.id, r.code, r.check_in, r.check_out, r.total, g.first_name, g.last_name, g.birthdate, g.vip, ro.number, ro.status AS room_status
             FROM reservations r JOIN guests g ON g.id = r.guest_id JOIN rooms ro ON ro.id = r.room_id`;
  const name = (r) => [r.first_name, r.last_name].filter(Boolean).join(' ');

  for (const r of q(`${R} WHERE r.status IN ('confirmed','option') AND r.check_in < ?`, t))
    out.push({ level: 'warn', text: `Überfällige Anreise: ${name(r)} (Zi. ${r.number}, seit ${deDate(r.check_in)}) – einchecken oder als No-Show markieren`, reservation_id: r.id });
  for (const r of q(`${R} WHERE r.status = 'checked_in' AND r.check_out < ?`, t))
    out.push({ level: 'warn', text: `Abreise überfällig: ${name(r)} (Zi. ${r.number}, geplant ${deDate(r.check_out)})`, reservation_id: r.id });
  for (const r of q(`${R} WHERE r.status IN ('confirmed','option') AND r.check_in = ? AND ro.status != 'clean'`, t))
    out.push({ level: 'warn', text: `Zimmer ${r.number} ist noch nicht sauber – heutige Anreise ${name(r)}`, reservation_id: r.id });
  for (const r of q(`${R} WHERE r.status = 'option' AND r.check_in >= ? AND r.check_in <= ?`, t, addDays(t, 7)))
    out.push({ level: 'info', text: `Unbestätigte Option: ${name(r)} ab ${deDate(r.check_in)} – nachfassen`, reservation_id: r.id });
  for (const r of q(
    `${R} WHERE r.status = 'checked_out' AND r.check_out >= ? AND r.total - (SELECT COALESCE(SUM(amount),0) FROM payments WHERE reservation_id = r.id) > 0.005`,
    addDays(t, -60)
  ))
    out.push({ level: 'warn', text: `Offener Betrag nach Abreise: ${name(r)} (${r.code})`, reservation_id: r.id });

  const upcoming = q(`${R} WHERE r.status IN ('confirmed','checked_in') AND r.check_in <= ? AND r.check_out > ?`, addDays(t, 2), t);
  const stays = db.prepare("SELECT COUNT(*) n FROM reservations WHERE guest_id = (SELECT guest_id FROM reservations WHERE id = ?) AND status = 'checked_out'");
  for (const r of upcoming) {
    if (r.birthdate && r.birthdate.length === 10) {
      for (let d = r.check_in > t ? r.check_in : t; d < r.check_out; d = addDays(d, 1))
        if (d.slice(5) === r.birthdate.slice(5)) {
          out.push({ level: 'smart', text: `🎂 ${name(r)} (Zi. ${r.number}) hat am ${deDate(d)} Geburtstag`, reservation_id: r.id });
          break;
        }
    }
    if (r.check_in >= t) {
      const n = stays.get(r.id).n;
      if (r.vip) out.push({ level: 'smart', text: `⭐ VIP-Anreise am ${deDate(r.check_in)}: ${name(r)} (Zi. ${r.number})`, reservation_id: r.id });
      else if (n >= (auto.stammgastStays || 3))
        out.push({ level: 'smart', text: `Stammgast reist am ${deDate(r.check_in)} an: ${name(r)} (${n} frühere Aufenthalte)`, reservation_id: r.id });
    }
  }
  const unread = db.prepare("SELECT COUNT(*) n FROM emails WHERE direction = 'in' AND is_read = 0 AND archived = 0").get().n;
  if (unread) out.push({ level: 'info', text: `${unread} ungelesene E-Mail(s) im Postfach`, view: 'mail' });
  const dup = findDuplicates().length;
  if (dup) out.push({ level: 'info', text: `${dup} mögliche Dublette(n) in der Kundenkartei`, view: 'guests' });
  const ms = getSetting('mailState');
  if (ms.lastError && getSetting('mail').enabled) out.push({ level: 'warn', text: `GMX-Abruf: ${ms.lastError}`, view: 'settings' });
  return out;
}

// ---------- Automatisierung ----------
let lastSync = 0;
let running = false;
async function runAutomation() {
  if (running || !mail.isConfigured()) return;
  running = true;
  try {
    const auto = getSetting('automation');
    const t = today();
    if (auto.autoSync && Date.now() - lastSync >= Math.max(2, Number(auto.syncMinutes) || 10) * 60000) {
      lastSync = Date.now();
      await mail.syncInbox().catch((e) => console.error('[auto] ' + e.message));
    }
    if (auto.preArrival) {
      const days = Math.max(1, Number(auto.preArrivalDays) || 3);
      const rows = db
        .prepare(
          `SELECT r.id FROM reservations r JOIN guests g ON g.id = r.guest_id
           WHERE r.status = 'confirmed' AND r.prearrival_sent = 0 AND g.email != '' AND r.check_in > ? AND r.check_in <= ?
             AND date(r.created_at) < r.check_in`
        )
        .all(t, addDays(t, days));
      for (const r of rows) {
        // Markierung vor dem Versand, damit ein Fehler nicht zu Mehrfachversand führt.
        db.prepare('UPDATE reservations SET prearrival_sent = 1 WHERE id = ?').run(r.id);
        await mail.sendTemplateSafe('prearrival', r.id);
      }
    }
    if (auto.thankYou) {
      const rows = db
        .prepare(
          `SELECT r.id FROM reservations r JOIN guests g ON g.id = r.guest_id
           WHERE r.status = 'checked_out' AND r.thankyou_sent = 0 AND g.email != '' AND r.check_out >= ?`
        )
        .all(addDays(t, -2));
      for (const r of rows) {
        db.prepare('UPDATE reservations SET thankyou_sent = 1 WHERE id = ?').run(r.id);
        await mail.sendTemplateSafe('thankyou', r.id);
      }
    }
  } catch (e) {
    console.error('[auto] ' + e.message);
  } finally {
    running = false;
  }
}

function startScheduler() {
  setTimeout(runAutomation, 5000).unref();
  setInterval(runAutomation, 60000).unref();
}

module.exports = { parseInquiry, findDuplicates, hints, runAutomation, startScheduler, diffDays };
