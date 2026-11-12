'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.PMS_DATA_DIR || path.join(__dirname, '..', 'data');
const IN_MEMORY = process.env.PMS_DB === ':memory:';
if (!IN_MEMORY) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(IN_MEMORY ? ':memory:' : path.join(DATA_DIR, 'pms.db'));
db.exec('PRAGMA foreign_keys = ON;');
if (!IN_MEMORY) db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS room_categories (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, description TEXT DEFAULT '',
  base_price REAL NOT NULL DEFAULT 0, std_occupancy INTEGER NOT NULL DEFAULT 2,
  max_persons INTEGER NOT NULL DEFAULT 2, extra_person_price REAL NOT NULL DEFAULT 0,
  color TEXT DEFAULT '#3b6fd4'
);
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL REFERENCES room_categories(id),
  floor TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'clean',
  notes TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS seasons (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL,
  category_id INTEGER REFERENCES room_categories(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'percent', value REAL NOT NULL DEFAULT 0,
  weekdays TEXT DEFAULT '', min_stay INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS extras (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0,
  per TEXT NOT NULL DEFAULT 'stay', vat_rate REAL NOT NULL DEFAULT 19, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS guests (
  id INTEGER PRIMARY KEY, salutation TEXT DEFAULT '', first_name TEXT DEFAULT '', last_name TEXT NOT NULL,
  company TEXT DEFAULT '', email TEXT DEFAULT '', phone TEXT DEFAULT '',
  street TEXT DEFAULT '', zip TEXT DEFAULT '', city TEXT DEFAULT '', country TEXT DEFAULT '',
  birthdate TEXT DEFAULT '', nationality TEXT DEFAULT '', id_number TEXT DEFAULT '',
  notes TEXT DEFAULT '', tags TEXT NOT NULL DEFAULT '[]', custom TEXT NOT NULL DEFAULT '{}',
  vip INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_guests_email ON guests(email);
CREATE TABLE IF NOT EXISTS reservations (
  id INTEGER PRIMARY KEY, code TEXT,
  guest_id INTEGER NOT NULL REFERENCES guests(id),
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  category_id INTEGER NOT NULL REFERENCES room_categories(id),
  check_in TEXT NOT NULL, check_out TEXT NOT NULL,
  adults INTEGER NOT NULL DEFAULT 1, children INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'confirmed', source TEXT DEFAULT '', notes TEXT DEFAULT '',
  manual_price REAL, lodging_total REAL NOT NULL DEFAULT 0, extras_total REAL NOT NULL DEFAULT 0,
  city_tax_total REAL NOT NULL DEFAULT 0, total REAL NOT NULL DEFAULT 0, nightly TEXT NOT NULL DEFAULT '[]',
  invoice_no TEXT, invoice_date TEXT,
  confirmation_sent INTEGER NOT NULL DEFAULT 0, prearrival_sent INTEGER NOT NULL DEFAULT 0,
  thankyou_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_res_room ON reservations(room_id, check_in, check_out);
CREATE INDEX IF NOT EXISTS idx_res_guest ON reservations(guest_id);
CREATE TABLE IF NOT EXISTS reservation_extras (
  id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  extra_id INTEGER, name TEXT NOT NULL, qty REAL NOT NULL DEFAULT 1, per TEXT NOT NULL DEFAULT 'stay',
  unit_price REAL NOT NULL, vat_rate REAL NOT NULL, total REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY, reservation_id INTEGER NOT NULL REFERENCES reservations(id) ON DELETE CASCADE,
  amount REAL NOT NULL, method TEXT DEFAULT '', date TEXT NOT NULL, note TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY, direction TEXT NOT NULL, message_id TEXT UNIQUE,
  from_addr TEXT DEFAULT '', from_name TEXT DEFAULT '', to_addr TEXT DEFAULT '',
  subject TEXT DEFAULT '', body TEXT DEFAULT '', date TEXT NOT NULL,
  guest_id INTEGER REFERENCES guests(id) ON DELETE SET NULL,
  reservation_id INTEGER REFERENCES reservations(id) ON DELETE SET NULL,
  template TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'ok', error TEXT DEFAULT '',
  is_read INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_emails_guest ON emails(guest_id);
CREATE TABLE IF NOT EXISTS email_templates (
  id INTEGER PRIMARY KEY, key TEXT DEFAULT '', name TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL
);
`);

const DEFAULTS = {
  hotel: {
    name: 'Mein Hotel', street: '', zip: '', city: '', country: 'Deutschland', phone: '', email: '',
    website: '', taxId: '', bank: '', currency: 'EUR', checkinTime: '15:00', checkoutTime: '11:00',
    vatLodging: 7, cityTax: 0, childDiscount: 50, invoicePrefix: 'RE-', invoiceFooter: '',
  },
  mail: {
    enabled: false, user: '', pass: '', fromName: '',
    smtpHost: 'mail.gmx.net', smtpPort: 587, imapHost: 'imap.gmx.net', imapPort: 993, signature: '',
  },
  automation: {
    confirmOnBooking: true, preArrival: true, preArrivalDays: 3, thankYou: true,
    autoSync: true, syncMinutes: 10, dirtyOnCheckout: true, stammgastStays: 3,
  },
  dynamic: { enabled: false, tiers: [{ from: 0, percent: 0 }, { from: 70, percent: 10 }, { from: 90, percent: 20 }] },
  guestStd: { company: true, birthdate: true, nationality: true, id_number: true, address: true },
  guestFields: [
    { key: 'kennzeichen', label: 'Kfz-Kennzeichen', type: 'text', inList: false },
    { key: 'allergien', label: 'Allergien / Unverträglichkeiten', type: 'textarea', inList: false },
    { key: 'zimmerwunsch', label: 'Zimmerwunsch', type: 'select', options: ['egal', 'ruhig', 'hohe Etage', 'Erdgeschoss'], inList: true },
    { key: 'newsletter', label: 'Newsletter erwünscht', type: 'checkbox', inList: false },
  ],
  mailState: { lastUid: 0, uidValidity: '', lastSync: '', lastError: '' },
  auth: { hash: '', salt: '' },
  counters: { invoice: 0 },
};

const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

function getSetting(key) {
  const row = getStmt.get(key);
  const def = DEFAULTS[key];
  if (!row) return def === undefined ? null : structuredClone(def);
  const val = JSON.parse(row.value);
  if (def && !Array.isArray(def) && typeof def === 'object') return { ...structuredClone(def), ...val };
  return val;
}
function setSetting(key, value) {
  setStmt.run(key, JSON.stringify(value));
}

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// --- Verschlüsselung für das Mail-Passwort (AES-256-GCM, Schlüssel liegt neben der DB) ---
let secretKey;
function key() {
  if (secretKey) return secretKey;
  if (IN_MEMORY) return (secretKey = crypto.randomBytes(32));
  const file = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600 });
  return (secretKey = fs.readFileSync(file));
}
function encrypt(plain) {
  if (!plain) return '';
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
function decrypt(b64) {
  if (!b64) return '';
  try {
    const buf = Buffer.from(b64, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return '';
  }
}

// --- Erstbefüllung ---
function seed() {
  if (db.prepare('SELECT COUNT(*) n FROM room_categories').get().n > 0) return;
  tx(() => {
    const cat = db.prepare(
      'INSERT INTO room_categories (name, description, base_price, std_occupancy, max_persons, extra_person_price, color) VALUES (?,?,?,?,?,?,?)'
    );
    const ez = cat.run('Einzelzimmer', 'Gemütliches Zimmer für eine Person', 79, 1, 1, 0, '#2f8f83').lastInsertRowid;
    const dz = cat.run('Doppelzimmer', 'Doppelbett, Dusche/WC', 109, 2, 3, 25, '#3b6fd4').lastInsertRowid;
    const su = cat.run('Suite', 'Wohn- und Schlafbereich, Balkon', 169, 2, 4, 30, '#8a5cc7').lastInsertRowid;
    const room = db.prepare('INSERT INTO rooms (number, category_id, floor) VALUES (?,?,?)');
    [['101', ez, '1'], ['102', ez, '1'], ['103', dz, '1'], ['104', dz, '1'], ['201', dz, '2'],
      ['202', dz, '2'], ['203', dz, '2'], ['204', ez, '2'], ['301', su, '3'], ['302', su, '3']]
      .forEach((r) => room.run(...r));
    const ex = db.prepare('INSERT INTO extras (name, price, per, vat_rate) VALUES (?,?,?,?)');
    ex.run('Frühstück', 14, 'person_night', 19);
    ex.run('Parkplatz', 8, 'night', 19);
    ex.run('Haustier', 10, 'night', 7);
    ex.run('Spätabreise (bis 14 Uhr)', 20, 'stay', 7);
    const y = new Date().getFullYear();
    const se = db.prepare(
      'INSERT INTO seasons (name, start_date, end_date, category_id, mode, value, weekdays, min_stay, priority) VALUES (?,?,?,?,?,?,?,?,?)'
    );
    se.run('Hauptsaison Sommer', `${y + 1}-07-01`, `${y + 1}-08-31`, null, 'percent', 20, '', 2, 10);
    se.run('Wochenendzuschlag', `${y}-01-01`, `${y + 5}-12-31`, null, 'percent', 10, '5,6', 1, 20);
    const t = db.prepare('INSERT INTO email_templates (key, name, subject, body) VALUES (?,?,?,?)');
    t.run('confirmation', 'Buchungsbestätigung', 'Ihre Buchungsbestätigung {{buchungsnr}} – {{hotel}}',
      `{{anrede}},

vielen Dank für Ihre Reservierung. Wir bestätigen Ihnen gerne:

Buchungsnummer: {{buchungsnr}}
Anreise: {{anreise}} (ab {{checkin_zeit}} Uhr)
Abreise: {{abreise}} (bis {{checkout_zeit}} Uhr)
Nächte: {{naechte}}
Zimmer: {{kategorie}}
Personen: {{personen}}
Gesamtpreis: {{gesamtpreis}}

Wir freuen uns auf Ihren Besuch!

{{signatur}}`);
    t.run('prearrival', 'Anreise-Erinnerung', 'Bald ist es so weit – Ihre Anreise am {{anreise}}',
      `{{anrede}},

in wenigen Tagen begrüßen wir Sie bei uns im {{hotel}}.

Anreise: {{anreise}} ab {{checkin_zeit}} Uhr
Abreise: {{abreise}}
Buchungsnummer: {{buchungsnr}}

Falls Sie später anreisen oder besondere Wünsche haben, antworten Sie einfach auf diese E-Mail.

Gute Anreise!

{{signatur}}`);
    t.run('thankyou', 'Dankeschön nach Abreise', 'Vielen Dank für Ihren Aufenthalt im {{hotel}}',
      `{{anrede}},

herzlichen Dank für Ihren Aufenthalt bei uns. Wir hoffen, Sie hatten eine angenehme Zeit
und würden uns freuen, Sie bald wieder begrüßen zu dürfen.

{{signatur}}`);
    t.run('offer', 'Angebot', 'Ihr Angebot vom {{hotel}}',
      `{{anrede}},

vielen Dank für Ihre Anfrage. Gerne bieten wir Ihnen an:

Zeitraum: {{anreise}} – {{abreise}} ({{naechte}} Nächte)
Zimmer: {{kategorie}}
Personen: {{personen}}
Gesamtpreis: {{gesamtpreis}}

Das Zimmer ist unverbindlich für Sie vorgemerkt. Bitte bestätigen Sie uns die Buchung per E-Mail.

{{signatur}}`);
    t.run('cancellation', 'Stornobestätigung', 'Stornierung Ihrer Buchung {{buchungsnr}}',
      `{{anrede}},

hiermit bestätigen wir die Stornierung Ihrer Buchung {{buchungsnr}} ({{anreise}} – {{abreise}}).

Wir würden uns freuen, Sie ein anderes Mal bei uns begrüßen zu dürfen.

{{signatur}}`);
  });
}
seed();

module.exports = { db, getSetting, setSetting, tx, encrypt, decrypt, DEFAULTS, DATA_DIR };
