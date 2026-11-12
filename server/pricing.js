'use strict';
const { db, getSetting } = require('./db');
const { addDays, diffDays, weekday, round2, eachNight, isDate, HttpError } = require('./util');

const ACTIVE = "status NOT IN ('cancelled','no_show')";

/** Belegte Zimmer je Nacht im Zeitraum (ohne die Reservierung excludeId). */
function occupancyMap(from, to, excludeId = 0) {
  const rows = db
    .prepare(`SELECT check_in, check_out FROM reservations WHERE ${ACTIVE} AND check_in < ? AND check_out > ? AND id != ?`)
    .all(to, from, excludeId);
  const map = {};
  for (const r of rows) {
    const a = r.check_in < from ? from : r.check_in;
    const b = r.check_out > to ? to : r.check_out;
    for (const d of eachNight(a, b)) map[d] = (map[d] || 0) + 1;
  }
  return map;
}

function sellableRooms() {
  return db.prepare("SELECT COUNT(*) n FROM rooms WHERE active = 1 AND status != 'ooo'").get().n;
}

/** Preis je Nacht: Grundpreis → Preisregeln (nach Priorität) → Zusatzpersonen → auslastungsabhängig. */
function nightlyPrices(cat, checkIn, checkOut, adults, children, excludeId = 0) {
  const hotel = getSetting('hotel');
  const dyn = getSetting('dynamic');
  const rules = db
    .prepare('SELECT * FROM seasons WHERE active = 1 AND start_date < ? AND end_date >= ? ORDER BY priority, id')
    .all(checkOut, checkIn);
  const occ = dyn.enabled ? occupancyMap(checkIn, checkOut, excludeId) : {};
  const total = dyn.enabled ? sellableRooms() : 0;
  const tiers = [...(dyn.tiers || [])].sort((a, b) => a.from - b.from);

  const extraAdults = Math.max(0, adults - cat.std_occupancy);
  const extraChildren = Math.max(0, adults + children - cat.std_occupancy - extraAdults);
  const personSurcharge =
    extraAdults * cat.extra_person_price +
    extraChildren * cat.extra_person_price * (1 - (Number(hotel.childDiscount) || 0) / 100);

  let minStay = 1;
  const nights = eachNight(checkIn, checkOut).map((date) => {
    let price = cat.base_price;
    const notes = [];
    for (const r of rules) {
      if (date < r.start_date || date > r.end_date) continue;
      if (r.category_id && r.category_id !== cat.id) continue;
      if (r.weekdays && !r.weekdays.split(',').map(Number).includes(weekday(date))) continue;
      if (r.mode === 'fixed') price = r.value;
      else if (r.mode === 'amount') price += r.value;
      else price *= 1 + r.value / 100;
      notes.push(r.name);
      if (date === checkIn && r.min_stay > minStay) minStay = r.min_stay;
    }
    if (personSurcharge) {
      price += personSurcharge;
      notes.push('Zusatzperson');
    }
    if (dyn.enabled && total > 0) {
      const pct = ((occ[date] || 0) / total) * 100;
      const tier = tiers.filter((t) => pct >= t.from).pop();
      if (tier && tier.percent) {
        price *= 1 + tier.percent / 100;
        notes.push(`Auslastung ${Math.round(pct)} % (${tier.percent > 0 ? '+' : ''}${tier.percent} %)`);
      }
    }
    return { date, price: round2(Math.max(0, price)), notes };
  });
  return { nights, minStay };
}

function extraTotal(per, price, qty, nights, persons) {
  const f = { stay: 1, night: nights, person_night: nights * persons, person_stay: persons }[per] ?? 1;
  return round2(price * qty * f);
}

/**
 * Vollständige Preisberechnung. extras: [{extra_id, qty}]
 * Alle Preise sind Bruttopreise; die enthaltene MwSt. wird ausgewiesen.
 */
function quote({ category_id, check_in, check_out, adults = 1, children = 0, extras = [], manual_price = null, exclude_id = 0 }) {
  if (!isDate(check_in) || !isDate(check_out)) throw new HttpError(400, 'Ungültiges Datum');
  const n = diffDays(check_in, check_out);
  if (n < 1) throw new HttpError(400, 'Abreise muss nach der Anreise liegen');
  if (n > 365) throw new HttpError(400, 'Aufenthalt darf maximal 365 Nächte dauern');
  const cat = db.prepare('SELECT * FROM room_categories WHERE id = ?').get(category_id);
  if (!cat) throw new HttpError(400, 'Kategorie nicht gefunden');
  adults = Math.max(1, Number(adults) || 1);
  children = Math.max(0, Number(children) || 0);
  const persons = adults + children;
  const hotel = getSetting('hotel');
  const warnings = [];

  let { nights, minStay } = nightlyPrices(cat, check_in, check_out, adults, children, exclude_id);
  const calculated = round2(nights.reduce((s, x) => s + x.price, 0));
  let lodging = calculated;
  if (manual_price !== null && manual_price !== '' && !isNaN(Number(manual_price))) {
    lodging = round2(Number(manual_price));
    const per = round2(lodging / n);
    nights = nights.map((x, i) => ({
      date: x.date,
      price: i === n - 1 ? round2(lodging - per * (n - 1)) : per,
      notes: ['Manueller Preis'],
    }));
  }
  if (persons > cat.max_persons) warnings.push(`Kategorie ist nur für ${cat.max_persons} Person(en) ausgelegt`);
  if (n < minStay) warnings.push(`Mindestaufenthalt in diesem Zeitraum: ${minStay} Nächte`);

  const extraRows = [];
  for (const e of extras || []) {
    const ex = db.prepare('SELECT * FROM extras WHERE id = ?').get(e.extra_id);
    if (!ex) continue;
    const qty = Math.max(1, Number(e.qty) || 1);
    extraRows.push({
      extra_id: ex.id, name: ex.name, qty, per: ex.per, unit_price: ex.price, vat_rate: ex.vat_rate,
      total: extraTotal(ex.per, ex.price, qty, n, persons),
    });
  }
  const extrasTotal = round2(extraRows.reduce((s, x) => s + x.total, 0));
  const cityTax = round2((Number(hotel.cityTax) || 0) * adults * n);

  const byRate = {};
  const add = (rate, gross) => (byRate[rate] = round2((byRate[rate] || 0) + gross));
  add(Number(hotel.vatLodging) || 0, lodging);
  extraRows.forEach((x) => add(x.vat_rate, x.total));
  const vat = Object.entries(byRate)
    .filter(([, g]) => g)
    .map(([rate, gross]) => {
      const net = round2(gross / (1 + rate / 100));
      return { rate: Number(rate), net, vat: round2(gross - net), gross };
    });

  return {
    category: cat, nights: n, nightly: nights, calculated, lodging, extras: extraRows, extrasTotal, cityTax,
    total: round2(lodging + extrasTotal + cityTax), vat, warnings,
  };
}

/** Freie Zimmer mit Best-Fit-Bewertung: bevorzugt Zimmer, bei denen die Buchung Lücken schließt. */
function freeRooms(checkIn, checkOut, excludeId = 0) {
  const rooms = db
    .prepare(
      `SELECT r.*, c.name AS category_name FROM rooms r JOIN room_categories c ON c.id = r.category_id
       WHERE r.active = 1 AND r.status != 'ooo' AND r.id NOT IN (
         SELECT room_id FROM reservations WHERE ${ACTIVE} AND check_in < ? AND check_out > ? AND id != ?)`
    )
    .all(checkOut, checkIn, excludeId);
  const prev = db.prepare(`SELECT MAX(check_out) d FROM reservations WHERE ${ACTIVE} AND room_id = ? AND check_out <= ? AND id != ?`);
  const next = db.prepare(`SELECT MIN(check_in) d FROM reservations WHERE ${ACTIVE} AND room_id = ? AND check_in >= ? AND id != ?`);
  for (const r of rooms) {
    const p = prev.get(r.id, checkIn, excludeId).d;
    const nx = next.get(r.id, checkOut, excludeId).d;
    const gapBefore = p ? Math.min(30, diffDays(p, checkIn)) : 30;
    const gapAfter = nx ? Math.min(30, diffDays(checkOut, nx)) : 30;
    r.score = gapBefore + gapAfter;
  }
  rooms.sort((a, b) => a.score - b.score || a.number.localeCompare(b.number, 'de', { numeric: true }));
  return rooms;
}

function hasConflict(roomId, checkIn, checkOut, excludeId = 0) {
  return !!db
    .prepare(`SELECT id FROM reservations WHERE ${ACTIVE} AND room_id = ? AND check_in < ? AND check_out > ? AND id != ?`)
    .get(roomId, checkOut, checkIn, excludeId);
}

module.exports = { quote, freeRooms, hasConflict, occupancyMap, sellableRooms, ACTIVE, addDays };
