'use strict';
const DAY = 86400000;

const toDate = (s) => new Date(s + 'T00:00:00Z');
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(toDate(s).getTime() + n * DAY));
const diffDays = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
const weekday = (s) => toDate(s).getUTCDay(); // 0 = Sonntag
const today = () =>
  new Date().toLocaleDateString('sv-SE', { timeZone: process.env.TZ || 'Europe/Berlin' });
const isDate = (s) =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(toDate(s)) && iso(toDate(s)) === s;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const eachNight = (ci, co) => {
  const out = [];
  for (let d = ci; d < co; d = addDays(d, 1)) out.push(d);
  return out;
};
const deDate = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
const money = (n, cur = 'EUR') =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency: cur }).format(Number(n) || 0);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

module.exports = { toDate, iso, addDays, diffDays, weekday, today, isDate, round2, eachNight, deDate, money, esc, HttpError };
