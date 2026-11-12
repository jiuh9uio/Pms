'use strict';
// Legt Beispiel-Gäste, -Reservierungen und -E-Mails an: npm run demo
const { db } = require('./db');
const { saveReservation } = require('./routes');
const { addDays, today } = require('./util');

if (db.prepare('SELECT COUNT(*) n FROM guests').get().n > 0) {
  console.log('Es sind bereits Gäste vorhanden – Demodaten wurden nicht angelegt.');
  process.exit(0);
}
const t = today();
const room = (no) => db.prepare('SELECT id FROM rooms WHERE number = ?').get(no).id;
const guests = [
  ['Herr', 'Thomas', 'Brandt', 'thomas.brandt@example.com', '0171 5550101', 'Hamburg', '1978-04-12', ['Geschäftsreisend'], { kennzeichen: 'HH-TB 412', zimmerwunsch: 'ruhig' }, 1],
  ['Frau', 'Julia', 'Winkler', 'julia.winkler@example.com', '0160 5550102', 'München', addDays(t, 1).replace(/^\d{4}/, '1985'), ['Stammgast'], { allergien: 'Nüsse', newsletter: true }, 0],
  ['Herr', 'Mehmet', 'Yilmaz', 'm.yilmaz@example.com', '0151 5550103', 'Köln', '', [], {}, 0],
  ['Frau', 'Sophie', 'Lehmann', 'sophie.lehmann@example.com', '', 'Leipzig', '', ['Familie'], { zimmerwunsch: 'hohe Etage' }, 0],
  ['', 'Familie', 'de Vries', 'devries@example.com', '+31 20 5550104', 'Utrecht', '', ['Familie'], {}, 0],
  ['Herr', 'Karl', 'Neumann', '', '030 5550105', 'Berlin', '', [], {}, 0],
];
const ids = guests.map((g) =>
  db.prepare('INSERT INTO guests (salutation, first_name, last_name, email, phone, city, birthdate, tags, custom, vip, country) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(g[0], g[1], g[2], g[3], g[4], g[5], g[6], JSON.stringify(g[7]), JSON.stringify(g[8]), g[9], 'Deutschland').lastInsertRowid);
const fr = db.prepare("SELECT id FROM extras WHERE name = 'Frühstück'").get().id;
const res = (g, no, from, nights, status, o = {}) =>
  saveReservation({ guest_id: Number(ids[g]), room_id: room(no), check_in: addDays(t, from), check_out: addDays(t, from + nights), status: 'confirmed', adults: 2, ...o }).id;
const set = (id, status) => db.prepare('UPDATE reservations SET status = ? WHERE id = ?').run(status, id);
const pay = (id) => db.prepare("INSERT INTO payments (reservation_id, amount, method, date) SELECT id, total, 'EC-Karte', check_out FROM reservations WHERE id = ?").run(id);

[[1, '103', -60, 3], [1, '103', -30, 2], [1, '201', -12, 4], [0, '101', -20, 2]].forEach(([g, no, from, n]) => {
  const id = res(g, no, from, n, 'confirmed', { adults: g === 0 ? 1 : 2, extras: [{ extra_id: fr, qty: 1 }] });
  set(id, 'checked_out');
  pay(id);
});
set(res(0, '102', -2, 4, 'confirmed', { adults: 1, source: 'Telefon' }), 'checked_in');
set(res(2, '202', -3, 3, 'confirmed', { source: 'Booking.com' }), 'checked_in');
set(res(4, '301', -1, 5, 'confirmed', { children: 2, extras: [{ extra_id: fr, qty: 1 }], source: 'Website' }), 'checked_in');
res(1, '203', 0, 3, 'confirmed', { source: 'E-Mail', extras: [{ extra_id: fr, qty: 1 }] });
res(3, '104', 0, 2, 'confirmed', { source: 'Website' });
res(5, '204', 2, 2, 'confirmed', { adults: 1, source: 'Telefon' });
res(2, '302', 4, 3, 'option', { source: 'E-Mail' });
res(3, '201', 6, 4, 'confirmed', { source: 'Direkt' });
res(0, '101', 9, 2, 'confirmed', { adults: 1 });
db.prepare("UPDATE rooms SET status = 'dirty' WHERE number IN ('104', '201')").run();

const mail = db.prepare('INSERT INTO emails (direction, message_id, from_addr, from_name, to_addr, subject, body, date, guest_id, is_read) VALUES (?,?,?,?,?,?,?,?,?,?)');
const d1 = addDays(t, 20);
const d2 = addDays(t, 23);
const de = (s) => `${s.slice(8)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
mail.run('in', 'demo-1', 'petra.schulz@example.com', 'Petra Schulz', 'hotel@gmx.de', 'Zimmeranfrage',
  `Guten Tag,\n\nwir möchten gerne vom ${de(d1)} bis ${de(d2)} ein Doppelzimmer für 2 Personen buchen. Ist noch etwas frei und was würde es mit Frühstück kosten?\n\nViele Grüße\nPetra Schulz`,
  new Date().toISOString(), null, 0);
mail.run('in', 'demo-2', 'thomas.brandt@example.com', 'Thomas Brandt', 'hotel@gmx.de', 'Späte Anreise',
  'Hallo,\n\nich komme heute erst gegen 22 Uhr an. Ist die Rezeption dann noch besetzt?\n\nGruß\nT. Brandt', new Date(Date.now() - 3600000).toISOString(), Number(ids[0]), 0);
console.log('Demodaten angelegt.');
