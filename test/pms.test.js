'use strict';
process.env.PMS_DB = ':memory:';
const test = require('node:test');
const assert = require('node:assert/strict');
const { db, setSetting, getSetting, encrypt, decrypt } = require('../server/db');
const pricing = require('../server/pricing');
const smart = require('../server/smart');
const { saveReservation, periodStats } = require('../server/routes');

const cat = (name) => db.prepare('SELECT * FROM room_categories WHERE name = ?').get(name);
const room = (no) => db.prepare('SELECT * FROM rooms WHERE number = ?').get(no);
db.prepare('DELETE FROM seasons').run();

test('Grundpreis, Zusatzperson und Kinderermäßigung', () => {
  const dz = cat('Doppelzimmer');
  const q = pricing.quote({ category_id: dz.id, check_in: '2030-03-04', check_out: '2030-03-06', adults: 2 });
  assert.equal(q.nights, 2);
  assert.equal(q.lodging, 218);
  const q2 = pricing.quote({ category_id: dz.id, check_in: '2030-03-04', check_out: '2030-03-06', adults: 2, children: 1 });
  assert.equal(q2.lodging, 218 + 2 * 12.5);
  const q3 = pricing.quote({ category_id: dz.id, check_in: '2030-03-04', check_out: '2030-03-05', adults: 4 });
  assert.ok(q3.warnings.some((w) => /ausgelegt/.test(w)));
});

test('Preisregeln: Prozent, Wochentage, Festpreis, Priorität', () => {
  const dz = cat('Doppelzimmer');
  const ins = db.prepare('INSERT INTO seasons (name, start_date, end_date, category_id, mode, value, weekdays, min_stay, priority) VALUES (?,?,?,?,?,?,?,?,?)');
  ins.run('Messe', '2030-05-01', '2030-05-10', dz.id, 'fixed', 200, '', 3, 1);
  ins.run('Wochenende', '2030-01-01', '2030-12-31', null, 'percent', 10, '5,6', 1, 5);
  // 2030-05-03 ist ein Freitag
  const q = pricing.quote({ category_id: dz.id, check_in: '2030-05-02', check_out: '2030-05-04', adults: 2 });
  assert.deepEqual(q.nightly.map((n) => n.price), [200, 220]);
  assert.ok(q.warnings.some((w) => /Mindestaufenthalt/.test(w)));
  const ez = pricing.quote({ category_id: cat('Einzelzimmer').id, check_in: '2030-05-02', check_out: '2030-05-03', adults: 1 });
  assert.equal(ez.lodging, 79);
  db.prepare('DELETE FROM seasons').run();
});

test('Extras, Kurtaxe und MwSt.-Ausweis', () => {
  setSetting('hotel', { ...getSetting('hotel'), cityTax: 2 });
  const fr = db.prepare("SELECT id FROM extras WHERE name = 'Frühstück'").get().id;
  const q = pricing.quote({ category_id: cat('Doppelzimmer').id, check_in: '2030-03-04', check_out: '2030-03-06', adults: 2, extras: [{ extra_id: fr, qty: 1 }] });
  assert.equal(q.extrasTotal, 56);
  assert.equal(q.cityTax, 8);
  assert.equal(q.total, 218 + 56 + 8);
  const v7 = q.vat.find((v) => v.rate === 7);
  assert.equal(v7.gross, 218);
  assert.equal(v7.net, 203.74);
  setSetting('hotel', { ...getSetting('hotel'), cityTax: 0 });
});

test('Reservierung: Konflikt, automatische Zuweisung, Dublettenerkennung', () => {
  const r103 = room('103');
  const a = saveReservation({ guest: { first_name: 'Anna', last_name: 'Muster', email: 'anna@example.com' }, room_id: r103.id, check_in: '2030-06-10', check_out: '2030-06-13', adults: 2 });
  assert.ok(a.id);
  assert.throws(() => saveReservation({ guest_id: 1, room_id: r103.id, check_in: '2030-06-12', check_out: '2030-06-14' }), /bereits belegt/);
  // Anschlussbuchung: Best Fit wählt das Zimmer, das lückenlos anschließt
  const b = saveReservation({ guest: { last_name: 'Muster', email: 'ANNA@example.com' }, room_id: 'auto', category_id: r103.category_id, check_in: '2030-06-13', check_out: '2030-06-15' });
  const rb = db.prepare('SELECT * FROM reservations WHERE id = ?').get(b.id);
  assert.equal(rb.room_id, r103.id);
  assert.equal(rb.guest_id, 1);
  assert.ok(b.warnings.some((w) => /bereits in der Kartei/.test(w)));
  // Abreisetag = Anreisetag ist kein Konflikt; Storno gibt das Zimmer frei
  db.prepare("UPDATE reservations SET status = 'cancelled' WHERE id = ?").run(a.id);
  assert.equal(pricing.hasConflict(r103.id, '2030-06-10', '2030-06-13'), false);
});

test('Manueller Preis und Kennzahlen', () => {
  const r = saveReservation({ guest_id: 1, room_id: room('301').id, check_in: '2030-09-01', check_out: '2030-09-04', manual_price: 400 });
  const row = db.prepare('SELECT * FROM reservations WHERE id = ?').get(r.id);
  assert.equal(row.lodging_total, 400);
  assert.equal(round(JSON.parse(row.nightly).reduce((s, n) => s + n.price, 0)), 400);
  const s = periodStats('2030-09-01', '2030-10-01');
  assert.equal(s.nights, 3);
  assert.equal(s.revenue, 400);
  assert.equal(s.capacity, 10 * 30);
});
const round = (n) => Math.round(n * 100) / 100;

test('Auslastungsabhängige Preise', () => {
  setSetting('dynamic', { enabled: true, tiers: [{ from: 0, percent: 0 }, { from: 10, percent: 20 }] });
  // am 01.09.2030 ist 1 von 10 Zimmern belegt → 10 %
  const q = pricing.quote({ category_id: cat('Einzelzimmer').id, check_in: '2030-09-01', check_out: '2030-09-02' });
  assert.equal(q.lodging, 94.8);
  setSetting('dynamic', { enabled: false, tiers: [] });
});

test('Anfrage-Erkennung aus E-Mail-Text', () => {
  const p = smart.parseInquiry('Guten Tag, wir möchten vom 12. bis 15. März 2031 ein Doppelzimmer für 2 Personen und 1 Kind buchen.', '2030-11-01');
  assert.equal(p.check_in, '2031-03-12');
  assert.equal(p.check_out, '2031-03-15');
  assert.equal(p.adults, 2);
  assert.equal(p.children, 1);
  assert.equal(p.category_id, cat('Doppelzimmer').id);
  const p2 = smart.parseInquiry('Haben Sie vom 28.12. - 02.01. noch eine Suite frei? Wir sind zu zweit.', '2030-11-01');
  assert.equal(p2.check_in, '2030-12-28');
  assert.equal(p2.check_out, '2031-01-02');
  assert.equal(p2.adults, 2);
  const p3 = smart.parseInquiry('Anreise am 03.02.2031, drei Nächte, eine Person', '2030-11-01');
  assert.equal(p3.check_in, '2031-02-03');
  assert.equal(p3.check_out, '2031-02-06');
  assert.equal(p3.adults, 1);
  const p4 = smart.parseInquiry('Zimmer vom 5.-8.7.2031 gesucht', '2030-11-01');
  assert.deepEqual([p4.check_in, p4.check_out], ['2031-07-05', '2031-07-08']);
});

test('Dubletten und Passwortverschlüsselung', () => {
  db.prepare("INSERT INTO guests (first_name, last_name, email) VALUES ('A.', 'Muster', 'anna@example.com')").run();
  assert.equal(smart.findDuplicates().length, 1);
  const enc = encrypt('geheim');
  assert.notEqual(enc, 'geheim');
  assert.equal(decrypt(enc), 'geheim');
});
