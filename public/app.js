'use strict';
/* Hotel-PMS – Oberfläche (ohne Build-Schritt, reines JavaScript) */

// ---------- Helfer ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let B = null; // Stammdaten & Einstellungen
const money = (n) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: B?.hotel.currency || 'EUR' }).format(n || 0);
const dd = (s) => (s ? `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}` : '');
const dt = (s) => (s ? new Date(s).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const D = (s) => new Date(s + 'T00:00:00Z');
const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diff = (a, b) => Math.round((D(b) - D(a)) / 864e5);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const WD = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const STATUS = { option: 'Option', confirmed: 'Bestätigt', checked_in: 'Im Haus', checked_out: 'Abgereist', cancelled: 'Storniert', no_show: 'No-Show' };
const ROOMSTATUS = { clean: 'Sauber', dirty: 'Schmutzig', ooo: 'Außer Betrieb' };
const PER = { stay: 'pro Aufenthalt', night: 'pro Nacht', person_night: 'pro Person und Nacht', person_stay: 'pro Person' };
const gname = (g) => [g.first_name, g.last_name].filter(Boolean).join(' ');
const badge = (st) => `<span class="st st-${st}">${STATUS[st] || st}</span>`;
const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

async function api(method, url, body) {
  const r = await fetch('/api' + url, {
    method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401 && !url.startsWith('/auth')) { showAuth(); throw new Error('Bitte erneut anmelden'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Fehler ' + r.status);
  return j;
}

function toast(msg, type = 'ok') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toasts').append(t);
  setTimeout(() => t.remove(), type === 'err' ? 7000 : 3500);
}

function F(label, name, value, o = {}) {
  const t = o.type || 'text';
  const a = `name="${name}" ${o.required ? 'required' : ''} ${o.attrs || ''}`;
  if (t === 'checkbox')
    return `<label class="f check${o.wide ? ' wide' : ''}"><input type="checkbox" ${a} ${value ? 'checked' : ''}><span>${esc(label)}</span></label>`;
  let input;
  if (t === 'select')
    input = `<select ${a}>${o.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  else if (t === 'textarea') input = `<textarea ${a} rows="${o.rows || 3}">${esc(value ?? '')}</textarea>`;
  else input = `<input type="${t}" ${a} value="${esc(value ?? '')}" ${t === 'number' ? `step="${o.step || 'any'}"` : ''}>`;
  return `<label class="f${o.wide ? ' wide' : ''}"><span>${esc(label)}</span>${input}${o.hint ? `<small>${esc(o.hint)}</small>` : ''}</label>`;
}

function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
    const parts = el.name.split('.');
    let o = out;
    while (parts.length > 1) o = o[parts[0]] ??= {}, parts.shift();
    o[parts[0]] = v;
  }
  return out;
}

function modal({ title, body, wide, save = 'Speichern', onSubmit, footer = '' }) {
  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.innerHTML = `<form class="modal${wide ? ' wide' : ''}"><header><h2>${esc(title)}</h2><button type="button" class="x" data-close aria-label="Schließen">×</button></header>
    <div class="mbody">${body}</div>
    <footer><div class="left">${footer}</div><button type="button" class="btn" data-close>${onSubmit ? 'Abbrechen' : 'Schließen'}</button>${onSubmit ? `<button class="btn primary">${esc(save)}</button>` : ''}</footer></form>`;
  const form = $('form', ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape' && $$('.overlay').at(-1) === ov) close(); };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) close(); });
  ov.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) close(); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!onSubmit) return;
    const btn = $('footer .primary', form);
    btn.disabled = true;
    try { await onSubmit(readForm(form), close); } catch (err) { toast(err.message, 'err'); }
    btn.disabled = false;
  });
  document.body.insertBefore(ov, $('#toasts'));
  const first = $('.mbody input:not([type=checkbox]):not([type=hidden]), .mbody select, .mbody textarea', ov);
  if (first && !wide) first.focus();
  return { el: ov, form, close };
}

/** Bearbeiten-Dialog für einfache Stammdaten. fields: [label, name, optionen] */
function editRow(title, path, fields, row, done) {
  const m = modal({
    title,
    body: `<div class="grid">${fields.map(([l, n, o = {}]) => F(l, n, row?.[n] ?? o.def ?? '', o)).join('')}</div>`,
    footer: row?.id ? '<button type="button" class="btn danger" data-del>Löschen</button>' : '',
    onSubmit: async (d, close) => {
      await api(row?.id ? 'PUT' : 'POST', path + (row?.id ? '/' + row.id : ''), d);
      close();
      await loadBoot();
      done?.();
    },
  });
  $('[data-del]', m.el)?.addEventListener('click', async () => {
    if (!confirm('Wirklich löschen?')) return;
    try {
      await api('DELETE', `${path}/${row.id}`);
      m.close();
      await loadBoot();
      done?.();
    } catch (e) { toast(e.message, 'err'); }
  });
}

// ---------- Start, Anmeldung, Navigation ----------
let view = 'dashboard';
const V = {};
const A = {};

async function loadBoot() {
  B = await api('GET', '/bootstrap');
  $('#brand').textContent = B.hotel.name || 'Hotel-PMS';
  document.title = (B.hotel.name || 'Hotel') + ' – PMS';
}
async function showAuth() {
  const st = await fetch('/api/auth/state').then((r) => r.json());
  if (st.loggedIn) return start();
  $('#app').hidden = true;
  $('#auth').hidden = false;
  $('#authmsg').textContent = st.needsSetup ? 'Willkommen! Bitte legen Sie ein Passwort für den Zugang fest (mind. 8 Zeichen).' : 'Bitte melden Sie sich an.';
  $('#authbtn').textContent = st.needsSetup ? 'Passwort festlegen' : 'Anmelden';
  $('#authform').dataset.mode = st.needsSetup ? 'setup' : 'login';
  $('#authform input').focus();
}
$('#authform').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('POST', '/auth/' + e.target.dataset.mode, readForm(e.target));
    e.target.reset();
    start();
  } catch (err) { toast(err.message, 'err'); }
});
async function start() {
  await loadBoot();
  $('#auth').hidden = true;
  $('#app').hidden = false;
  go(location.hash.slice(1) || 'dashboard');
}
async function go(v) {
  if (!V[v]) v = 'dashboard';
  view = v;
  if (location.hash.slice(1) !== v) history.replaceState(null, '', '#' + v);
  $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.view === v));
  await refresh();
}
async function refresh() {
  try { await V[view](); } catch (e) { toast(e.message, 'err'); }
}
window.addEventListener('hashchange', () => go(location.hash.slice(1)));
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el || !A[el.dataset.act]) return;
  e.preventDefault();
  try { await A[el.dataset.act](el.dataset, el); } catch (err) { toast(err.message, 'err'); }
});
A.logout = async () => { await api('POST', '/auth/logout'); showAuth(); };
A.go = (d) => go(d.view);
A.res = (d) => resModal(Number(d.id));
A.guest = (d) => guestModal(Number(d.id));
A.newres = (d) => resModal(null, { room_id: d.room ? Number(d.room) : undefined, check_in: d.date, check_out: d.date ? addDays(d.date, 1) : undefined });
A.status = async (d) => {
  const r = await api('POST', `/reservations/${d.id}/status`, { status: d.status });
  toast(`${gname(r)}: ${STATUS[r.status]}`);
  refresh();
};

const head = (title, right = '') => `<div class="head"><h1>${esc(title)}</h1><div class="tools">${right}</div></div>`;
const resRow = (r, extra = '') =>
  `<tr class="click" data-act="res" data-id="${r.id}"><td><b>${esc(gname(r))}</b>${r.vip ? ' ⭐' : ''}</td><td>${esc(r.room_number)} <small>${esc(r.category_name)}</small></td>
   <td class="nw">${dd(r.check_in).slice(0, 6)} – ${dd(r.check_out).slice(0, 6)}${r.check_out.slice(2, 4)} <small>${r.nights} N.</small></td><td>${badge(r.status)}</td><td class="r">${money(r.total)}</td>
   <td class="r">${r.balance > 0.005 ? `<span class="open">${money(r.balance)}</span>` : '–'}</td><td class="r">${extra}</td></tr>`;
const resTable = (rows, btn) =>
  rows.length
    ? `<div class="tablewrap"><table><thead><tr><th>Gast</th><th>Zimmer</th><th>Zeitraum</th><th>Status</th><th class="r">Gesamt</th><th class="r">Offen</th><th></th></tr></thead>
       <tbody>${rows.map((r) => resRow(r, btn ? btn(r) : '')).join('')}</tbody></table></div>`
    : '<p class="empty">Keine Einträge</p>';

// ---------- Übersicht ----------
V.dashboard = async () => {
  const d = await api('GET', '/dashboard');
  const pct = d.sellable ? Math.round((d.occupiedTonight / d.sellable) * 100) : 0;
  const dirty = d.rooms.find((r) => r.status === 'dirty')?.n || 0;
  const unread = d.hints.find((h) => h.view === 'mail');
  $('#mailbadge').hidden = !unread;
  if (unread) $('#mailbadge').textContent = parseInt(unread.text, 10);
  const tile = (l, v, s = '') => `<div class="tile"><span>${l}</span><b>${v}</b><small>${s}</small></div>`;
  const max = Math.max(1, d.sellable);
  $('#view').innerHTML = `${head('Übersicht – ' + D(d.today).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }),
    '<button class="btn primary" data-act="newres">+ Reservierung</button>')}
  <div class="tiles">
    ${tile('Auslastung heute', pct + ' %', `${d.occupiedTonight} von ${d.sellable} Zimmern`)}
    ${tile('Anreisen', d.arrivals.length, 'heute erwartet')}
    ${tile('Abreisen', d.departures.length, 'heute fällig')}
    ${tile('Im Haus', d.inhouse.length, 'belegte Zimmer')}
    ${tile('Umsatz ' + MONTHS[Number(d.today.slice(5, 7)) - 1], money(d.month.revenue), `Logis · Auslastung ${String(d.month.occupancy).replace('.', ',')} %`)}
    ${tile('Ø Zimmerpreis', money(d.month.adr), 'RevPAR ' + money(d.month.revpar))}
    ${tile('Zu reinigen', dirty, 'Zimmer')}
  </div>
  ${d.mailConfigured ? '' : '<p class="note">GMX-Postfach ist noch nicht verbunden – <a href="#settings">jetzt einrichten</a>, um E-Mails zu senden und Anfragen abzurufen.</p>'}
  <section class="card"><h2>Smarte Hinweise</h2>${d.hints.length
    ? `<ul class="hints">${d.hints.map((h) => `<li class="h-${h.level}" ${h.reservation_id ? `data-act="res" data-id="${h.reservation_id}"` : h.view ? `data-act="go" data-view="${h.view}"` : ''}>${esc(h.text)}</li>`).join('')}</ul>`
    : '<p class="empty">Alles erledigt – keine offenen Punkte.</p>'}</section>
  <div class="cols">
    <section class="card"><h2>Anreisen heute</h2>${resTable(d.arrivals, (r) => `<button class="btn small primary" data-act="status" data-id="${r.id}" data-status="checked_in">Check-in</button>`)}</section>
    <section class="card"><h2>Abreisen heute</h2>${resTable(d.departures, (r) => `<button class="btn small primary" data-act="status" data-id="${r.id}" data-status="checked_out">Check-out</button>`)}</section>
  </div>
  <section class="card"><h2>Belegung der nächsten 14 Tage</h2>
    <div class="bars">${d.forecast.map((f) => {
      const p = Math.round((f.occupied / max) * 100);
      return `<div class="bar" title="${dd(f.date)}: ${f.occupied} von ${d.sellable} Zimmern"><em>${p} %</em><i style="height:${Math.max(2, p)}%"></i><span>${WD[D(f.date).getUTCDay()]}<br>${f.date.slice(8)}.</span></div>`;
    }).join('')}</div></section>`;
};

// ---------- Belegungsplan ----------
const plan = { from: null, days: 21 };
V.plan = async () => {
  plan.from ??= addDays(B.today, -2);
  const c = await api('GET', `/calendar?from=${plan.from}&days=${plan.days}`);
  const days = Array.from({ length: c.days }, (_, i) => addDays(c.from, i));
  const cols = `grid-template-columns: 118px repeat(${c.days * 2}, minmax(17px, 1fr))`;
  const dayCls = (d) => `${[0, 6].includes(D(d).getUTCDay()) ? ' we' : ''}${d === B.today ? ' today' : ''}`;
  const headRow = `<div class="prow phead" style="${cols}"><div class="plabel">Zimmer</div>${days.map((d, i) =>
    `<div class="pday${dayCls(d)}" style="grid-column:${2 + 2 * i} / span 2">${WD[D(d).getUTCDay()]}<b>${d.slice(8)}.</b>${d.slice(8) === '01' || i === 0 ? `<small>${MONTHS[Number(d.slice(5, 7)) - 1].slice(0, 3)}</small>` : ''}</div>`).join('')}</div>`;
  const rows = c.rooms.map((room) => {
    const cells = days.map((d, i) => `<div class="pcell${dayCls(d)}" style="grid-column:${2 + 2 * i} / span 2" data-act="newres" data-room="${room.id}" data-date="${d}"></div>`).join('');
    const bars = c.reservations.filter((r) => r.room_id === room.id).map((r) => {
      const a = diff(c.from, r.check_in);
      const b = diff(c.from, r.check_out);
      const s = a < 0 ? 2 : 3 + 2 * a;
      const e = b >= c.days ? 2 + 2 * c.days : 3 + 2 * b;
      return `<div class="pbar st-${r.status}" style="grid-column:${s} / ${e}" data-act="res" data-id="${r.id}" title="${esc(gname(r))} · ${dd(r.check_in)}–${dd(r.check_out)} · ${STATUS[r.status]}">${r.vip ? '⭐ ' : ''}${esc(r.last_name)}${r.balance > 0.005 && r.status === 'checked_out' ? ' €' : ''}</div>`;
    }).join('');
    return `<div class="prow" style="${cols}"><div class="plabel rs-${room.status}" title="${ROOMSTATUS[room.status]}"><b>${esc(room.number)}</b><small style="color:${esc(room.color)}">${esc(room.category_name)}</small></div>${cells}${bars}</div>`;
  }).join('');
  const foot = `<div class="prow pfoot" style="${cols}"><div class="plabel">Auslastung</div>${days.map((d, i) => {
    const p = c.sellable ? Math.round(((c.occupancy[d] || 0) / c.sellable) * 100) : 0;
    return `<div class="pday" style="grid-column:${2 + 2 * i} / span 2">${p}%</div>`;
  }).join('')}</div>`;
  $('#view').innerHTML = `${head('Belegungsplan', `
    <button class="btn" data-act="planmove" data-d="-7">‹ Woche</button><button class="btn" data-act="planmove" data-d="0">Heute</button><button class="btn" data-act="planmove" data-d="7">Woche ›</button>
    <input type="date" id="plandate" value="${c.from}" aria-label="Startdatum">
    <select id="plandays" aria-label="Zeitraum">${[14, 21, 31, 45].map((n) => `<option ${n === plan.days ? 'selected' : ''} value="${n}">${n} Tage</option>`).join('')}</select>
    <button class="btn primary" data-act="newres">+ Reservierung</button>`)}
  <div class="planwrap"><div class="plan" style="min-width:${118 + c.days * 38}px">${headRow}${rows}${foot}</div></div>
  <p class="legend">${['option', 'confirmed', 'checked_in', 'checked_out'].map((s) => `<span class="pbar st-${s}">${STATUS[s]}</span>`).join('')}
    <span>Klick auf ein freies Feld legt eine Reservierung an.</span></p>`;
  $('#plandate').onchange = (e) => { if (isDate(e.target.value)) { plan.from = e.target.value; refresh(); } };
  $('#plandays').onchange = (e) => { plan.days = Number(e.target.value); refresh(); };
};
A.planmove = (d) => { plan.from = d.d === '0' ? addDays(B.today, -2) : addDays(plan.from, Number(d.d)); refresh(); };

// ---------- Reservierungen ----------
const resFilter = { q: '', status: 'active', from: null };
V.reservations = async () => {
  resFilter.from ??= B.today;
  const p = new URLSearchParams({ q: resFilter.q, status: resFilter.status, from: resFilter.from || '' });
  const rows = await api('GET', '/reservations?' + p);
  $('#view').innerHTML = `${head('Reservierungen', '<button class="btn primary" data-act="newres">+ Reservierung</button>')}
  <div class="filters"><input type="search" id="rq" placeholder="Name, Buchungsnr., Zimmer …" value="${esc(resFilter.q)}">
    <select id="rs">${[['active', 'Alle aktiven'], ['', 'Alle'], ...Object.entries(STATUS)].map(([v, l]) => `<option value="${v}" ${v === resFilter.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label>Abreise ab <input type="date" id="rf" value="${resFilter.from || ''}"></label></div>
  <section class="card">${resTable(rows, (r) => `<small>${esc(r.code)}</small>`)}</section>`;
  const q = $('#rq');
  q.oninput = debounce(async () => { resFilter.q = q.value; await refresh(); const n = $('#rq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  $('#rs').onchange = (e) => { resFilter.status = e.target.value; refresh(); };
  $('#rf').onchange = (e) => { resFilter.from = e.target.value; refresh(); };
};

async function resModal(id, preset = {}) {
  const isNew = !id;
  let r = id
    ? await api('GET', '/reservations/' + id)
    : { status: 'confirmed', children: 0, source: 'Direkt', extras: [], payments: [], ...Object.fromEntries(Object.entries(preset).filter(([, v]) => v !== undefined)) };
  r.check_in ||= B.today;
  r.check_out ||= addDays(r.check_in, 1);
  if (!r.category_id && r.room_id) r.category_id = B.rooms.find((x) => x.id === r.room_id)?.category_id;
  r.category_id ||= B.categories[0]?.id;
  r.adults ||= B.categories.find((c) => c.id === r.category_id)?.std_occupancy || 2;
  let guest = r.guest_id ? { id: r.guest_id, name: r.guest_name || gname(r) } : null;
  const ng = preset.newGuest || {};
  const exSel = Object.fromEntries((r.extras || []).map((e) => [e.extra_id, e.qty]));
  const extras = B.extras.filter((e) => e.active || exSel[e.id]);
  const mailOn = B.mail.enabled && B.mail.hasPass;

  const m = modal({
    title: isNew ? 'Neue Reservierung' : `Reservierung ${r.code}`, wide: true, save: isNew ? 'Reservierung anlegen' : 'Speichern',
    footer: isNew ? '' : '<span id="resact"></span>',
    body: `<div class="rescols"><div>
      <fieldset><legend>Gast</legend><div id="rg"></div></fieldset>
      <div class="grid">
        ${F('Anreise', 'check_in', r.check_in, { type: 'date', required: true })}${F('Abreise', 'check_out', r.check_out, { type: 'date', required: true })}
        ${F('Erwachsene', 'adults', r.adults, { type: 'number', step: 1, attrs: 'min="1"' })}${F('Kinder', 'children', r.children, { type: 'number', step: 1, attrs: 'min="0"' })}
        ${F('Preiskategorie', 'category_id', r.category_id, { type: 'select', options: B.categories.map((c) => [c.id, `${c.name} (ab ${money(c.base_price)})`]) })}
        <label class="f"><span>Zimmer</span><select name="room_id"></select></label>
        ${isNew ? F('Status', 'status', r.status, { type: 'select', options: [['confirmed', 'Bestätigt (feste Buchung)'], ['option', 'Option (unverbindlich vorgemerkt)']] })
          : `<div class="f"><span>Status</span><div class="statusline">${badge(r.status)}</div></div>`}
        ${F('Buchungsweg', 'source', r.source, { attrs: 'list="sources"' })}
        <datalist id="sources">${['Direkt', 'Telefon', 'E-Mail', 'Website', 'Booking.com', 'Walk-in'].map((s) => `<option>${s}</option>`).join('')}</datalist>
      </div>
      <fieldset><legend>Extras</legend><div class="extras">${extras.map((e) =>
        `<label class="check"><input type="checkbox" name="ex_${e.id}" ${exSel[e.id] ? 'checked' : ''}><span>${esc(e.name)} <small>${money(e.price)} ${PER[e.per]}</small></span>
         <input type="number" name="exq_${e.id}" value="${exSel[e.id] || 1}" min="1" step="1" aria-label="Menge ${esc(e.name)}"></label>`).join('') || '<small>Keine Extras angelegt</small>'}</div></fieldset>
      <div class="grid">${F('Manueller Logispreis gesamt (optional)', 'manual_price', r.manual_price ?? '', { type: 'number', step: '0.01', attrs: 'min="0" placeholder="automatisch"' })}
        ${isNew && mailOn ? F('Bestätigung per E-Mail senden', 'send_confirmation', B.automation.confirmOnBooking, { type: 'checkbox' }) : ''}
        ${F('Notizen', 'notes', r.notes, { type: 'textarea', wide: true })}</div>
    </div><aside id="rp"></aside></div>`,
    onSubmit: async (d, close) => {
      const body = {
        check_in: d.check_in, check_out: d.check_out, adults: d.adults || 1, children: d.children || 0, category_id: Number(d.category_id),
        room_id: d.room_id === 'auto' ? 'auto' : Number(d.room_id), status: d.status, source: d.source, notes: d.notes, manual_price: d.manual_price,
        extras: extras.filter((e) => d['ex_' + e.id]).map((e) => ({ extra_id: e.id, qty: d['exq_' + e.id] || 1 })),
        send_confirmation: d.send_confirmation,
      };
      if (guest) body.guest_id = guest.id;
      else if (d.g_last_name) body.guest = { salutation: d.g_salutation, first_name: d.g_first_name, last_name: d.g_last_name, email: d.g_email, phone: d.g_phone };
      else throw new Error('Bitte einen Gast auswählen oder den Nachnamen für einen neuen Gast eintragen');
      const saved = await api(isNew ? 'POST' : 'PUT', '/reservations' + (isNew ? '' : '/' + id), body);
      close();
      saved.warnings.forEach((w) => toast(w, 'warn'));
      toast(`Reservierung ${saved.code} gespeichert – Zimmer ${saved.room_number}${saved.mailQueued ? ', Bestätigung wird gesendet' : ''}`);
      refresh();
    },
  });
  const f = m.form;

  const renderGuest = () => {
    $('#rg', f).innerHTML = guest
      ? `<div class="chip"><b>${esc(guest.name)}</b><button type="button" class="link" data-x="gopen">Kartei öffnen</button><button type="button" class="link" data-x="gclear">anderen Gast wählen</button></div>`
      : `<input type="search" id="gsearch" placeholder="Gast in der Kartei suchen …" autocomplete="off"><div id="gres" class="gres"></div>
         <p class="sub">oder neuen Gast anlegen:</p>
         <div class="grid">${F('Anrede', 'g_salutation', ng.salutation, { type: 'select', options: [['', '–'], ['Herr', 'Herr'], ['Frau', 'Frau']] })}${F('Vorname', 'g_first_name', ng.first_name)}
         ${F('Nachname', 'g_last_name', ng.last_name)}${F('E-Mail', 'g_email', ng.email, { type: 'email' })}${F('Telefon', 'g_phone', ng.phone)}</div>`;
    const s = $('#gsearch', f);
    if (s) s.oninput = debounce(async () => {
      const list = s.value.trim().length < 2 ? [] : await api('GET', '/guests?q=' + encodeURIComponent(s.value.trim()));
      $('#gres', f).innerHTML = list.slice(0, 8).map((g) =>
        `<button type="button" data-x="gpick" data-id="${g.id}" data-name="${esc(gname(g))}">${esc(gname(g))}${g.vip ? ' ⭐' : ''}${g.blocked ? ' ⛔' : ''} <small>${esc([g.email, g.city, g.stays ? g.stays + ' Aufenth.' : ''].filter(Boolean).join(' · '))}</small></button>`).join('')
        || (s.value.trim().length >= 2 ? '<small>Kein Treffer – unten neu anlegen</small>' : '');
    });
  };

  let seq = 0;
  const update = async () => {
    const d = readForm(f);
    const panel = $('#rp', f);
    if (!isDate(d.check_in) || !isDate(d.check_out) || d.check_out <= d.check_in) {
      panel.innerHTML = '<p class="warnbox">Bitte gültigen Zeitraum wählen (Abreise nach Anreise).</p>';
      return;
    }
    const my = ++seq;
    try {
      const [free, q] = await Promise.all([
        api('GET', `/availability?check_in=${d.check_in}&check_out=${d.check_out}&exclude_id=${id || 0}`),
        api('POST', '/quote', {
          category_id: d.category_id, check_in: d.check_in, check_out: d.check_out, adults: d.adults || 1, children: d.children || 0,
          manual_price: d.manual_price, exclude_id: id || 0, extras: extras.filter((e) => d['ex_' + e.id]).map((e) => ({ extra_id: e.id, qty: d['exq_' + e.id] || 1 })),
        }),
      ]);
      if (my !== seq) return;
      // Zimmerauswahl: passende Kategorie zuerst, bestes Zimmer (füllt Lücken) markiert
      const sel = f.elements.room_id;
      const want = sel.value || (r.room_id ? String(r.room_id) : 'auto');
      const same = free.filter((x) => x.category_id === Number(d.category_id));
      const other = free.filter((x) => x.category_id !== Number(d.category_id));
      sel.innerHTML = `<option value="auto">Automatisch (bestes freies Zimmer)</option>`
        + same.map((x, i) => `<option value="${x.id}">${esc(x.number)}${i === 0 ? ' ★ empfohlen' : ''}${x.status === 'dirty' ? ' (schmutzig)' : ''}</option>`).join('')
        + (other.length ? `<optgroup label="Andere Kategorie">${other.map((x) => `<option value="${x.id}">${esc(x.number)} – ${esc(x.category_name)}</option>`).join('')}</optgroup>` : '');
      const inactive = ['cancelled', 'no_show'].includes(d.status || r.status);
      if (!free.some((x) => String(x.id) === want) && want !== 'auto' && inactive) sel.insertAdjacentHTML('beforeend', `<option value="${want}">${esc(B.rooms.find((x) => String(x.id) === want)?.number || want)}</option>`);
      sel.value = [...sel.options].some((o) => o.value === want) ? want : 'auto';
      const lost = want !== 'auto' && sel.value === 'auto';

      const groups = [];
      for (const n of q.nightly) {
        const key = n.price + '|' + n.notes.join(', ');
        const g = groups.find((x) => x.key === key);
        if (g) g.qty++; else groups.push({ key, price: n.price, notes: n.notes, qty: 1 });
      }
      const paid = r.paid || 0;
      panel.innerHTML = `<h3>Preis</h3>
        <table class="price">${groups.map((g) => `<tr><td>${g.qty} × ${money(g.price)}${g.notes.length ? `<small>${esc(g.notes.join(', '))}</small>` : ''}</td><td class="r">${money(g.qty * g.price)}</td></tr>`).join('')}
        ${q.extras.map((e) => `<tr><td>${esc(e.name)}${e.qty > 1 ? ' × ' + e.qty : ''}</td><td class="r">${money(e.total)}</td></tr>`).join('')}
        ${q.cityTax ? `<tr><td>Kurtaxe</td><td class="r">${money(q.cityTax)}</td></tr>` : ''}
        <tr class="sum"><td>Gesamt (${q.nights} ${q.nights === 1 ? 'Nacht' : 'Nächte'})</td><td class="r">${money(q.total)}</td></tr>
        ${q.vat.map((v) => `<tr class="vat"><td>darin ${v.rate} % MwSt.</td><td class="r">${money(v.vat)}</td></tr>`).join('')}
        ${!isNew ? `<tr><td>Bezahlt</td><td class="r">${money(paid)}</td></tr><tr class="sum"><td>Offen</td><td class="r">${money(q.total - paid)}</td></tr>` : ''}</table>
        ${d.manual_price !== '' && d.manual_price != null ? `<p class="sub">Berechneter Preis wäre ${money(q.calculated)}.</p>` : ''}
        ${!same.length && !inactive ? '<p class="warnbox">In dieser Kategorie ist im Zeitraum kein Zimmer frei.</p>' : ''}
        ${lost ? '<p class="warnbox">Das bisherige Zimmer ist im Zeitraum nicht frei – es wird automatisch neu zugewiesen.</p>' : ''}
        ${q.warnings.map((w) => `<p class="warnbox">${esc(w)}</p>`).join('')}
        ${isNew ? '' : `<h3>Zahlungen</h3>
          ${(r.payments || []).map((p) => `<div class="pay">${dd(p.date)} · ${esc(p.method)} <b>${money(p.amount)}</b><button type="button" class="link" data-x="paydel" data-id="${p.id}" aria-label="Zahlung löschen">×</button></div>`).join('') || '<p class="sub">Noch keine Zahlung erfasst.</p>'}
          <div class="payadd"><input type="number" id="payamt" step="0.01" placeholder="Betrag" value="${q.total - paid > 0 ? (q.total - paid).toFixed(2) : ''}" aria-label="Betrag">
            <select id="paymeth" aria-label="Zahlart">${['Bar', 'EC-Karte', 'Kreditkarte', 'Überweisung', 'PayPal'].map((x) => `<option>${x}</option>`).join('')}</select>
            <button type="button" class="btn small" data-x="payadd">Zahlung buchen</button></div>
          <h3>Dokumente</h3>
          <div class="btnrow">${r.invoice_no ? `<a class="btn small" target="_blank" href="/invoice/${id}">Rechnung ${esc(r.invoice_no)}</a>`
            : `<a class="btn small" target="_blank" href="/invoice/${id}">Entwurf ansehen</a><button type="button" class="btn small" data-x="invoice">Rechnung erstellen</button>`}
            <button type="button" class="btn small" data-x="mail">E-Mail an Gast</button></div>`}`;
    } catch (e) {
      if (my === seq) panel.innerHTML = `<p class="warnbox">${esc(e.message)}</p>`;
    }
  };

  const renderActions = () => {
    if (isNew) return;
    const b = (st, label, cls = '') => `<button type="button" class="btn ${cls}" data-x="st" data-status="${st}">${label}</button>`;
    $('#resact', f).innerHTML = {
      option: b('confirmed', 'Bestätigen', 'primary') + b('cancelled', 'Stornieren', 'danger'),
      confirmed: b('checked_in', 'Check-in', 'primary') + b('cancelled', 'Stornieren', 'danger') + b('no_show', 'No-Show'),
      checked_in: b('checked_out', 'Check-out', 'primary') + b('confirmed', 'Check-in zurücknehmen'),
      checked_out: b('checked_in', 'Check-out zurücknehmen'),
      cancelled: b('confirmed', 'Reaktivieren') + '<button type="button" class="btn danger" data-x="del">Löschen</button>',
      no_show: b('confirmed', 'Reaktivieren') + '<button type="button" class="btn danger" data-x="del">Löschen</button>',
    }[r.status];
  };

  const reload = async () => { r = await api('GET', '/reservations/' + id); renderActions(); await update(); refresh(); };
  f.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-x]');
    if (!el) return;
    const x = el.dataset.x;
    try {
      if (x === 'gpick') { guest = { id: Number(el.dataset.id), name: el.dataset.name }; renderGuest(); }
      else if (x === 'gclear') { guest = null; renderGuest(); }
      else if (x === 'gopen') guestModal(guest.id);
      else if (x === 'payadd') { await api('POST', `/reservations/${id}/payments`, { amount: $('#payamt', f).value, method: $('#paymeth', f).value }); await reload(); }
      else if (x === 'paydel') { if (confirm('Zahlung löschen?')) { await api('DELETE', '/payments/' + el.dataset.id); await reload(); } }
      else if (x === 'invoice') { await api('POST', `/reservations/${id}/invoice`); await reload(); window.open('/invoice/' + id, '_blank'); }
      else if (x === 'mail') composeMail({ guest_id: r.guest_id, reservation_id: id, to: r.guest_email });
      else if (x === 'del') { if (confirm('Reservierung endgültig löschen?')) { await api('DELETE', '/reservations/' + id); m.close(); refresh(); } }
      else if (x === 'st') {
        const st = el.dataset.status;
        let notify = false;
        if (st === 'cancelled') {
          if (!confirm('Reservierung wirklich stornieren?')) return;
          notify = mailOn && r.guest_email && confirm('Stornobestätigung per E-Mail an den Gast senden?');
        }
        const res = await api('POST', `/reservations/${id}/status`, { status: st, notify });
        toast(`Status: ${STATUS[res.status]}`);
        m.close();
        refresh();
      }
    } catch (err) { toast(err.message, 'err'); }
  });
  const deb = debounce(update, 300);
  f.addEventListener('change', (e) => { const n = e.target.name; if (n && !n.startsWith('g_') && !['notes', 'source'].includes(n)) update(); });
  f.addEventListener('input', (e) => { if (['manual_price', 'adults', 'children'].includes(e.target.name) || e.target.name?.startsWith('exq_')) deb(); });
  renderGuest();
  renderActions();
  await update();
}

// ---------- Kundenkartei ----------
let guestQ = '';
V.guests = async () => {
  const [rows, dups] = await Promise.all([api('GET', '/guests?q=' + encodeURIComponent(guestQ)), api('GET', '/guests/duplicates')]);
  const cf = B.guestFields.filter((f) => f.inList);
  const cv = (f, g) => (f.type === 'checkbox' ? (g.custom[f.key] ? '✓' : '') : f.type === 'date' ? dd(g.custom[f.key]) : esc(g.custom[f.key] ?? ''));
  $('#view').innerHTML = `${head('Kundenkartei', `${dups.length ? `<button class="btn" data-act="dups">${dups.length} mögliche Dublette(n)</button>` : ''}
    <a class="btn" href="/api/guests/export.csv">CSV-Export</a><button class="btn primary" data-act="newguest">+ Gast</button>`)}
  <div class="filters"><input type="search" id="gq" placeholder="Name, E-Mail, Telefon, Ort, Tag, Zusatzfeld …" value="${esc(guestQ)}"><span class="sub">${rows.length} Gäste</span></div>
  <section class="card">${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Name</th><th>E-Mail</th><th>Telefon</th><th>Ort</th><th>Tags</th>${cf.map((f) => `<th>${esc(f.label)}</th>`).join('')}<th class="r">Aufenthalte</th><th class="r">Umsatz</th></tr></thead>
    <tbody>${rows.map((g) => `<tr class="click" data-act="guest" data-id="${g.id}"><td><b>${esc(gname(g))}</b>${g.vip ? ' ⭐' : ''}${g.blocked ? ' ⛔' : ''}${g.stays >= (B.automation.stammgastStays || 3) ? ' <span class="tag gold">Stammgast</span>' : ''}${g.company ? `<br><small>${esc(g.company)}</small>` : ''}</td>
      <td>${esc(g.email)}</td><td>${esc(g.phone)}</td><td>${esc(g.city)}</td><td>${g.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</td>${cf.map((f) => `<td>${cv(f, g)}</td>`).join('')}
      <td class="r">${g.stays}</td><td class="r">${money(g.revenue)}</td></tr>`).join('')}</tbody></table></div>`
    : `<p class="empty">${guestQ ? 'Kein Gast gefunden' : 'Noch keine Gäste angelegt'}</p>`}</section>`;
  const q = $('#gq');
  q.oninput = debounce(async () => { guestQ = q.value; await refresh(); const n = $('#gq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
};
A.newguest = () => guestModal(null);
A.dups = async () => {
  const dups = await api('GET', '/guests/duplicates');
  const m = modal({
    title: 'Mögliche Dubletten', wide: true,
    body: dups.map((d) => `<div class="dup"><p class="sub">${esc(d.reason)}</p>${d.guests.map((g) =>
      `<div class="duprow"><span><b>${esc(gname(g))}</b> <small>${esc([g.email, g.phone, g.city].filter(Boolean).join(' · '))}</small></span>
       <span>${d.guests.filter((o) => o.id !== g.id).map((o) => `<button type="button" class="btn small" data-keep="${g.id}" data-remove="${o.id}">Diesen behalten, „${esc(gname(o))}“ (#${o.id}) hier zusammenführen</button>`).join('')}</span></div>`).join('')}</div>`).join('') || '<p class="empty">Keine Dubletten gefunden.</p>',
  });
  m.el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-keep]');
    if (!b || !confirm('Einträge zusammenführen? Reservierungen und E-Mails werden übernommen.')) return;
    try { await api('POST', '/guests/merge', { keep_id: b.dataset.keep, remove_id: b.dataset.remove }); m.close(); toast('Zusammengeführt'); await refresh(); A.dups(); } catch (err) { toast(err.message, 'err'); }
  });
};

function customField(f, v) {
  const n = 'custom.' + f.key;
  const o = { required: f.required && f.type !== 'checkbox' };
  if (f.type === 'select') return F(f.label, n, v, { ...o, type: 'select', options: [['', '–'], ...(f.options || []).map((x) => [x, x])] });
  if (f.type === 'textarea') return F(f.label, n, v, { ...o, type: 'textarea', wide: true, rows: 2 });
  return F(f.label, n, v, { ...o, type: f.type });
}

async function guestModal(id, preset = {}) {
  const g = id ? await api('GET', '/guests/' + id) : { tags: [], custom: {}, reservations: [], emails: [], country: B.hotel.country, ...preset };
  const s = B.guestStd;
  const m = modal({
    title: id ? gname(g) : 'Neuer Gast', wide: true,
    footer: id ? '<button type="button" class="btn" data-x="res">+ Reservierung</button><button type="button" class="btn" data-x="mail">E-Mail schreiben</button><button type="button" class="btn danger" data-x="anon">Anonymisieren</button><button type="button" class="btn danger" data-x="del">Löschen</button>' : '',
    body: `<div class="rescols"><div>
      <div class="grid">
        ${F('Anrede', 'salutation', g.salutation, { type: 'select', options: [['', '–'], ['Herr', 'Herr'], ['Frau', 'Frau']] })}${F('Vorname', 'first_name', g.first_name)}
        ${F('Nachname', 'last_name', g.last_name, { required: true })}${s.company ? F('Firma', 'company', g.company) : ''}
        ${F('E-Mail', 'email', g.email, { type: 'email' })}${F('Telefon', 'phone', g.phone)}
        ${s.address ? F('Straße', 'street', g.street, { wide: true }) + F('PLZ', 'zip', g.zip) + F('Ort', 'city', g.city) + F('Land', 'country', g.country) : ''}
        ${s.birthdate ? F('Geburtsdatum', 'birthdate', g.birthdate, { type: 'date' }) : ''}${s.nationality ? F('Nationalität', 'nationality', g.nationality) : ''}
        ${s.id_number ? F('Ausweisnummer', 'id_number', g.id_number) : ''}
      </div>
      ${B.guestFields.length ? `<fieldset><legend>Zusatzfelder</legend><div class="grid">${B.guestFields.map((f) => customField(f, g.custom[f.key])).join('')}</div></fieldset>` : ''}
      <div class="grid">${F('Tags (mit Komma trennen)', 'tags', g.tags.join(', '), { wide: true, attrs: 'placeholder="z. B. Geschäftsreisend, Allergiker"' })}
        ${F('VIP', 'vip', g.vip, { type: 'checkbox' })}${F('Gesperrt (Warnung bei Buchung)', 'blocked', g.blocked, { type: 'checkbox' })}
        ${F('Notizen', 'notes', g.notes, { type: 'textarea', wide: true })}</div>
    </div><aside>${id ? `
      <h3>Überblick</h3><table class="price"><tr><td>Aufenthalte</td><td class="r">${g.stays}${g.stammgast ? ' <span class="tag gold">Stammgast</span>' : ''}</td></tr>
        <tr><td>Nächte</td><td class="r">${g.nights}</td></tr><tr><td>Umsatz</td><td class="r">${money(g.revenue)}</td></tr><tr><td>Letzter Aufenthalt</td><td class="r">${dd(g.last_stay) || '–'}</td></tr></table>
      <h3>Reservierungen</h3>${g.reservations.map((r) => `<div class="hist" data-x="openres" data-id="${r.id}">${dd(r.check_in)} – ${dd(r.check_out)} · Zi. ${esc(r.room_number)} ${badge(r.status)}<b>${money(r.total)}</b></div>`).join('') || '<p class="sub">Noch keine</p>'}
      <h3>E-Mail-Verlauf</h3>${g.emails.map((e) => `<div class="hist" data-x="openmail" data-id="${e.id}">${e.direction === 'in' ? '⇠' : '⇢'} ${dt(e.date)} · ${esc(e.subject)}${e.status === 'error' ? ' <span class="open">Fehler</span>' : ''}</div>`).join('') || '<p class="sub">Noch keine</p>'}`
      : '<p class="sub">Aufenthalte und E-Mail-Verlauf erscheinen hier, sobald der Gast gespeichert ist.</p>'}</aside></div>`,
    onSubmit: async (d, close) => {
      const saved = await api(id ? 'PUT' : 'POST', '/guests' + (id ? '/' + id : ''), d);
      close();
      if (saved.duplicate) toast(`Hinweis: ${gname(saved.duplicate)} hat dieselbe E-Mail-Adresse (mögliche Dublette)`, 'warn');
      toast('Gast gespeichert');
      preset.onSaved?.(saved);
      refresh();
    },
  });
  m.el.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-x]');
    if (!el) return;
    const x = el.dataset.x;
    try {
      if (x === 'openres') resModal(Number(el.dataset.id));
      else if (x === 'openmail') mailDetailModal(Number(el.dataset.id));
      else if (x === 'res') { m.close(); resModal(null, { guest_id: id, guest_name: gname(g) }); }
      else if (x === 'mail') composeMail({ guest_id: id, to: g.email });
      else if (x === 'del') { if (confirm('Gast wirklich löschen?')) { await api('DELETE', '/guests/' + id); m.close(); refresh(); } }
      else if (x === 'anon') {
        if (confirm('Alle personenbezogenen Daten dieses Gastes unwiderruflich entfernen (DSGVO)? Buchungen bleiben für die Buchhaltung erhalten.')) {
          await api('POST', `/guests/${id}/anonymize`); m.close(); toast('Gast anonymisiert'); refresh();
        }
      }
    } catch (err) { toast(err.message, 'err'); }
  });
}

// ---------- Postfach (GMX) ----------
const mailState = { box: 'in', q: '', open: null };
V.mail = async () => {
  const list = await api('GET', `/emails?box=${mailState.box}&q=${encodeURIComponent(mailState.q)}`);
  const on = B.mail.enabled && B.mail.hasPass;
  const tab = (k, l) => `<button class="tab${mailState.box === k ? ' on' : ''}" data-act="mailbox" data-box="${k}">${l}</button>`;
  $('#view').innerHTML = `${head('Postfach', `${on ? `<span class="sub">${esc(B.mail.user)}${B.mailState.lastSync ? ' · Abruf ' + dt(B.mailState.lastSync) : ''}</span><button class="btn" data-act="mailsync">Abrufen</button>` : ''}
    <button class="btn primary" data-act="compose">Neue E-Mail</button>`)}
  ${on ? '' : '<p class="note">GMX-Konto ist noch nicht verbunden. Unter <a href="#settings">Einstellungen → GMX</a> Adresse und Passwort hinterlegen.</p>'}
  <div class="filters">${tab('in', 'Posteingang')}${tab('out', 'Gesendet')}${tab('archive', 'Archiv')}<input type="search" id="mq" placeholder="Suchen …" value="${esc(mailState.q)}"></div>
  <div class="mailcols"><section class="card maillist">${list.map((e) =>
    `<div class="mailitem${e.is_read ? '' : ' unread'}${mailState.open === e.id ? ' on' : ''}" data-act="mailopen" data-id="${e.id}">
      <div><b>${esc(e.direction === 'in' ? (e.guest_id ? gname(e) : e.from_name || e.from_addr) : e.to_addr)}</b><small>${dt(e.date)}</small></div>
      <div>${esc(e.subject)}${e.status === 'error' ? ' <span class="open">nicht gesendet</span>' : ''}${e.guest_id ? ' <span class="tag">Gast</span>' : ''}</div><small>${esc(e.preview)}</small></div>`).join('') || '<p class="empty">Keine E-Mails</p>'}</section>
  <section class="card" id="maildetail"><p class="empty">E-Mail auswählen</p></section></div>`;
  const q = $('#mq');
  q.oninput = debounce(async () => { mailState.q = q.value; await refresh(); const n = $('#mq'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
  if (mailState.open && list.some((e) => e.id === mailState.open)) $('#maildetail').innerHTML = await mailDetail(mailState.open);
};

async function mailDetail(id) {
  const e = await api('GET', '/emails/' + id);
  let inq = '';
  if (e.direction === 'in' && e.inquiry?.isInquiry && e.inquiry.check_in) {
    const i = e.inquiry;
    let avail = '';
    if (i.check_out) {
      const free = await api('GET', `/availability?check_in=${i.check_in}&check_out=${i.check_out}`).catch(() => []);
      const n = i.category_id ? free.filter((x) => x.category_id === i.category_id).length : free.length;
      avail = n ? ` – <b class="okc">${n} Zimmer frei</b>` : ' – <b class="open">nichts frei</b>';
    }
    const cat = B.categories.find((c) => c.id === i.category_id);
    inq = `<p class="smartbox">Erkannte Anfrage: <b>${dd(i.check_in)}${i.check_out ? ' – ' + dd(i.check_out) : ''}</b>${i.adults ? `, ${i.adults} Erw.` : ''}${i.children ? `, ${i.children} Kind(er)` : ''}${cat ? ', ' + esc(cat.name) : ''}${avail}
      <button class="btn small primary" data-act="mailres" data-id="${e.id}">Reservierung anlegen</button></p>`;
  }
  return `<div class="mailhead"><h2>${esc(e.subject)}</h2>
    <p>${e.direction === 'in' ? `Von: <b>${esc(e.from_name)}</b> &lt;${esc(e.from_addr)}&gt;` : `An: <b>${esc(e.to_addr)}</b>`} · ${dt(e.date)}
    ${e.guest_id ? ` · <button class="link" data-act="guest" data-id="${e.guest_id}">Kartei: ${esc(gname(e))}</button>` : ''}</p>
    ${e.status === 'error' ? `<p class="warnbox">Versand fehlgeschlagen: ${esc(e.error)}</p>` : ''}
    <div class="btnrow">${e.direction === 'in' ? `<button class="btn small primary" data-act="mailreply" data-id="${e.id}">Antworten</button>
      ${e.guest_id ? '' : `<button class="btn small" data-act="mailguest" data-id="${e.id}">Als Gast anlegen</button>`}
      ${e.inquiry?.check_in ? '' : `<button class="btn small" data-act="mailres" data-id="${e.id}">Reservierung anlegen</button>`}
      <button class="btn small" data-act="mailarch" data-id="${e.id}" data-v="${e.archived ? 0 : 1}">${e.archived ? 'Zurück in Posteingang' : 'Archivieren'}</button>` : ''}
      <button class="btn small danger" data-act="maildel" data-id="${e.id}">Löschen</button></div></div>${inq}
    <pre class="mailbody">${esc(e.body)}</pre>`;
}
async function mailDetailModal(id) { modal({ title: 'E-Mail', wide: true, body: await mailDetail(id) }); }
const splitName = (n) => { const p = String(n || '').replace(/["<>]/g, '').trim().split(/\s+/); return p.length > 1 ? { first_name: p.slice(0, -1).join(' '), last_name: p.at(-1) } : { first_name: '', last_name: p[0] || '' }; };

A.mailbox = (d) => { mailState.box = d.box; mailState.open = null; refresh(); };
A.mailopen = async (d) => { mailState.open = Number(d.id); await refresh(); };
A.mailsync = async (d, el) => {
  el.disabled = true;
  el.textContent = 'Abruf läuft …';
  try { const r = await api('POST', '/mail/sync'); toast(r.fetched ? `${r.fetched} neue E-Mail(s)` : 'Keine neuen E-Mails'); } finally { await loadBoot(); refresh(); }
};
A.compose = () => composeMail({});
A.mailreply = async (d) => {
  const e = await api('GET', '/emails/' + d.id);
  composeMail({
    to: e.from_addr, guest_id: e.guest_id, reply_to_email_id: e.id, subject: /^(re|aw):/i.test(e.subject) ? e.subject : 'AW: ' + e.subject,
    body: `\n\n${B.mail.signature || 'Mit freundlichen Grüßen\n' + B.hotel.name}\n\n--- Ihre Nachricht vom ${dt(e.date)} ---\n${e.body.split('\n').map((l) => '> ' + l).join('\n')}`,
  });
};
A.mailarch = async (d) => { await api('PUT', '/emails/' + d.id, { archived: d.v === '1' }); mailState.open = null; refresh(); };
A.maildel = async (d) => { if (confirm('E-Mail aus dem PMS löschen? (Im GMX-Postfach bleibt sie erhalten.)')) { await api('DELETE', '/emails/' + d.id); mailState.open = null; $('.overlay')?.remove(); refresh(); } };
A.mailguest = async (d) => {
  const e = await api('GET', '/emails/' + d.id);
  guestModal(null, { ...splitName(e.from_name), email: e.from_addr });
};
A.mailres = async (d) => {
  const e = await api('GET', '/emails/' + d.id);
  const i = e.inquiry || {};
  resModal(null, {
    check_in: i.check_in || undefined, check_out: i.check_out || undefined, adults: i.adults || undefined, children: i.children || undefined,
    category_id: i.category_id || undefined, source: 'E-Mail', status: 'option',
    ...(e.guest_id ? { guest_id: e.guest_id, guest_name: gname(e) } : { newGuest: { ...splitName(e.from_name), email: e.from_addr } }),
  });
};

function composeMail({ to = '', subject = '', body = '', guest_id = null, reservation_id = null, reply_to_email_id = null }) {
  if (!(B.mail.enabled && B.mail.hasPass)) return toast('GMX-Konto ist noch nicht eingerichtet (Einstellungen → GMX)', 'err');
  let template = '';
  const m = modal({
    title: 'E-Mail schreiben', wide: true, save: 'Senden',
    body: `<div class="grid">${F('An', 'to', to, { type: 'email', required: true })}
      ${F('Vorlage', 'tpl', '', { type: 'select', options: [['', '– ohne Vorlage –'], ...B.templates.map((t) => [t.id, t.name])] })}
      ${F('Betreff', 'subject', subject, { wide: true, required: true })}${F('Nachricht', 'body', body, { type: 'textarea', wide: true, rows: 14 })}</div>
      <p class="sub">Absender: ${esc(B.mail.fromName || B.hotel.name)} &lt;${esc(B.mail.user)}&gt;</p>`,
    onSubmit: async (d, close) => {
      await api('POST', '/mail/send', { to: d.to, subject: d.subject, body: d.body, guest_id, reservation_id, reply_to_email_id, template });
      close();
      toast('E-Mail gesendet');
      if (view === 'mail') refresh();
    },
  });
  m.form.elements.tpl.onchange = async (e) => {
    if (!e.target.value) return;
    try {
      const r = await api('POST', '/mail/render', { template_id: e.target.value, guest_id, reservation_id });
      template = r.template;
      m.form.elements.subject.value = r.subject;
      m.form.elements.body.value = r.body;
      if (!m.form.elements.to.value) m.form.elements.to.value = r.to;
    } catch (err) { toast(err.message, 'err'); }
  };
}

// ---------- Zimmer ----------
V.rooms = async () => {
  const c = await api('GET', `/calendar?from=${B.today}&days=7`);
  const all = B.rooms.filter((r) => !r.active);
  const info = (room) => {
    const rs = c.reservations.filter((r) => r.room_id === room.id);
    const inh = rs.find((r) => r.status === 'checked_in');
    const arr = rs.find((r) => r.check_in === B.today && ['confirmed', 'option'].includes(r.status));
    const out = [];
    if (inh) out.push(`<span class="st st-checked_in">${esc(gname(inh))} bis ${dd(inh.check_out).slice(0, 6)}${inh.check_out <= B.today ? ' · Abreise heute' : ''}</span>`);
    if (arr) out.push(`<span class="st st-confirmed">Anreise heute: ${esc(gname(arr))}</span>`);
    return out.join('') || '<span class="sub">frei</span>';
  };
  $('#view').innerHTML = `${head('Zimmer & Housekeeping', '<button class="btn" data-act="catedit">+ Kategorie</button><button class="btn primary" data-act="roomedit">+ Zimmer</button>')}
  <div class="rooms">${c.rooms.map((r) => `<div class="room rs-${r.status}">
    <div class="roomtop"><b>${esc(r.number)}</b><span style="color:${esc(r.color)}">${esc(r.category_name)}</span><button class="link" data-act="roomedit" data-id="${r.id}">bearbeiten</button></div>
    <div class="roominfo">${info(r)}</div>${r.notes ? `<small>${esc(r.notes)}</small>` : ''}
    <div class="seg">${Object.entries(ROOMSTATUS).map(([k, l]) => `<button class="${r.status === k ? 'on' : ''}" data-act="roomstatus" data-id="${r.id}" data-status="${k}">${l}</button>`).join('')}</div></div>`).join('')}</div>
  ${all.length ? `<p class="sub">Inaktive Zimmer: ${all.map((r) => `<button class="link" data-act="roomedit" data-id="${r.id}">${esc(r.number)}</button>`).join(', ')}</p>` : ''}
  <section class="card"><h2>Kategorien</h2>${catTable()}</section>`;
};
const catTable = () => `<div class="tablewrap"><table><thead><tr><th>Kategorie</th><th class="r">Grundpreis/Nacht</th><th class="r">Belegung</th><th class="r">Zusatzperson</th><th class="r">Zimmer</th></tr></thead><tbody>
  ${B.categories.map((c) => `<tr class="click" data-act="catedit" data-id="${c.id}"><td><span class="dot" style="background:${esc(c.color)}"></span><b>${esc(c.name)}</b> <small>${esc(c.description)}</small></td>
  <td class="r">${money(c.base_price)}</td><td class="r">${c.std_occupancy} (max. ${c.max_persons})</td><td class="r">${money(c.extra_person_price)}</td><td class="r">${B.rooms.filter((r) => r.category_id === c.id && r.active).length}</td></tr>`).join('')}</tbody></table></div>`;
A.roomstatus = async (d) => { await api('PUT', '/rooms/' + d.id, { status: d.status }); await loadBoot(); refresh(); };
A.roomedit = (d) => editRow(d.id ? 'Zimmer bearbeiten' : 'Neues Zimmer', '/rooms', [
  ['Zimmernummer', 'number', { required: true }], ['Kategorie', 'category_id', { type: 'select', options: B.categories.map((c) => [c.id, c.name]) }],
  ['Etage', 'floor'], ['Status', 'status', { type: 'select', options: Object.entries(ROOMSTATUS), def: 'clean' }],
  ['Notiz', 'notes', { wide: true }], ['Aktiv (buchbar)', 'active', { type: 'checkbox', def: 1 }],
], d.id ? B.rooms.find((r) => r.id === Number(d.id)) : null, refresh);
A.catedit = (d) => editRow(d.id ? 'Kategorie bearbeiten' : 'Neue Kategorie', '/categories', [
  ['Name', 'name', { required: true }], ['Grundpreis pro Nacht', 'base_price', { type: 'number', step: '0.01', required: true }],
  ['Beschreibung', 'description', { wide: true }],
  ['Im Preis enthaltene Personen', 'std_occupancy', { type: 'number', step: 1, def: 2 }], ['Maximale Personen', 'max_persons', { type: 'number', step: 1, def: 2 }],
  ['Aufpreis je Zusatzperson/Nacht', 'extra_person_price', { type: 'number', step: '0.01', def: 0 }], ['Farbe', 'color', { type: 'color', def: '#3b6fd4' }],
], d.id ? B.categories.find((c) => c.id === Number(d.id)) : null, refresh);

// ---------- Preise ----------
const MODE = { percent: 'Prozent (+/−)', amount: 'Betrag (+/−)', fixed: 'Festpreis' };
let previewCat = null;
V.prices = async () => {
  const seasons = await api('GET', '/seasons');
  previewCat ??= B.categories[0]?.id;
  const pc = B.categories.find((c) => c.id === previewCat);
  const pv = pc ? await api('POST', '/quote', { category_id: pc.id, check_in: B.today, check_out: addDays(B.today, 14), adults: pc.std_occupancy }) : null;
  const val = (s) => (s.mode === 'fixed' ? money(s.value) : s.mode === 'amount' ? (s.value > 0 ? '+' : '') + money(s.value) : `${s.value > 0 ? '+' : ''}${s.value} %`);
  $('#view').innerHTML = `${head('Preise')}
  <section class="card"><div class="cardhead"><h2>Kategorien & Grundpreise</h2><button class="btn small" data-act="catedit">+ Kategorie</button></div>${catTable()}</section>
  <section class="card"><div class="cardhead"><h2>Preisregeln (Saisons, Wochentage, Aktionen)</h2><button class="btn small" data-act="seasonedit">+ Regel</button></div>
    <p class="sub">Regeln werden in Reihenfolge der Priorität auf den Grundpreis angewendet (kleine Zahl zuerst). Ein Festpreis ersetzt den bis dahin berechneten Preis.</p>
    ${seasons.length ? `<div class="tablewrap"><table><thead><tr><th>Name</th><th>Zeitraum</th><th>Kategorie</th><th>Wochentage</th><th class="r">Wert</th><th class="r">Mindestaufenthalt</th><th class="r">Priorität</th><th>Aktiv</th></tr></thead><tbody>
    ${seasons.map((s) => `<tr class="click${s.active ? '' : ' off'}" data-act="seasonedit" data-id="${s.id}"><td><b>${esc(s.name)}</b></td><td>${dd(s.start_date)} – ${dd(s.end_date)}</td>
      <td>${esc(B.categories.find((c) => c.id === s.category_id)?.name || 'alle')}</td><td>${s.weekdays ? s.weekdays.split(',').map((w) => WD[w]).join(', ') : 'alle'}</td>
      <td class="r">${val(s)}</td><td class="r">${s.min_stay > 1 ? s.min_stay + ' Nächte' : '–'}</td><td class="r">${s.priority}</td><td>${s.active ? 'ja' : 'nein'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Keine Regeln – es gilt immer der Grundpreis.</p>'}</section>
  <section class="card"><div class="cardhead"><h2>Extras & Zusatzleistungen</h2><button class="btn small" data-act="extraedit">+ Extra</button></div>
    <div class="tablewrap"><table><thead><tr><th>Name</th><th class="r">Preis</th><th>Berechnung</th><th class="r">MwSt.</th><th>Aktiv</th></tr></thead><tbody>
    ${B.extras.map((e) => `<tr class="click${e.active ? '' : ' off'}" data-act="extraedit" data-id="${e.id}"><td><b>${esc(e.name)}</b></td><td class="r">${money(e.price)}</td><td>${PER[e.per]}</td><td class="r">${e.vat_rate} %</td><td>${e.active ? 'ja' : 'nein'}</td></tr>`).join('')}</tbody></table></div></section>
  <section class="card"><h2>Smarte Preise nach Auslastung</h2>
    <form data-set="dynamic"><label class="f check"><input type="checkbox" name="enabled" ${B.dynamic.enabled ? 'checked' : ''}><span>Preise automatisch an die Auslastung der jeweiligen Nacht anpassen</span></label>
    <div id="tiers">${B.dynamic.tiers.map(tierRow).join('')}</div>
    <div class="btnrow"><button type="button" class="btn small" data-act="tieradd">+ Stufe</button><button class="btn small primary">Speichern</button></div>
    <p class="sub">Es gilt die höchste erreichte Stufe. Beispiel: ab 70 % Auslastung +10 %, ab 90 % +20 %; mit einer Stufe „ab 0 %: −10 %“ werden schwache Nächte günstiger.</p></form></section>
  <section class="card"><div class="cardhead"><h2>Preisvorschau – nächste 14 Nächte</h2>
    <select id="pvcat" aria-label="Kategorie">${B.categories.map((c) => `<option value="${c.id}" ${c.id === previewCat ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
    ${pv ? `<div class="pv">${pv.nightly.map((n) => `<div class="${[0, 6].includes(D(n.date).getUTCDay()) ? 'we' : ''}" title="${esc(n.notes.join(', ') || 'Grundpreis')}"><small>${WD[D(n.date).getUTCDay()]} ${n.date.slice(8)}.${n.date.slice(5, 7)}.</small><b>${money(n.price)}</b><small>${esc(n.notes.join(', ') || 'Grundpreis')}</small></div>`).join('')}</div>` : ''}</section>`;
  $('#pvcat').onchange = (e) => { previewCat = Number(e.target.value); refresh(); };
};
const tierRow = (t = { from: 50, percent: 5 }) => `<div class="rowedit tier">ab <input type="number" class="tf" value="${t.from}" min="0" max="100" aria-label="Auslastung ab"> % Auslastung:
  <input type="number" class="tp" value="${t.percent}" step="any" aria-label="Preisänderung"> % Preisänderung <button type="button" class="link" data-act="rowdel">entfernen</button></div>`;
A.tieradd = () => $('#tiers').insertAdjacentHTML('beforeend', tierRow());
A.rowdel = (d, el) => el.closest('.rowedit').remove();
A.seasonedit = async (d) => {
  const row = d.id ? (await api('GET', '/seasons')).find((s) => s.id === Number(d.id)) : null;
  editRow(d.id ? 'Preisregel bearbeiten' : 'Neue Preisregel', '/seasons', [
    ['Name', 'name', { required: true, wide: true }], ['Von', 'start_date', { type: 'date', required: true, def: B.today }], ['Bis (einschließlich)', 'end_date', { type: 'date', required: true, def: addDays(B.today, 30) }],
    ['Kategorie', 'category_id', { type: 'select', options: [['', 'Alle Kategorien'], ...B.categories.map((c) => [c.id, c.name])] }],
    ['Art', 'mode', { type: 'select', options: Object.entries(MODE), def: 'percent' }], ['Wert (%, Betrag oder Festpreis)', 'value', { type: 'number', step: '0.01', required: true }],
    ['Wochentage (0=So … 6=Sa, leer = alle)', 'weekdays', { attrs: 'placeholder="z. B. 5,6"' }], ['Mindestaufenthalt (Nächte)', 'min_stay', { type: 'number', step: 1, def: 1 }],
    ['Priorität', 'priority', { type: 'number', step: 1, def: 10 }], ['Aktiv', 'active', { type: 'checkbox', def: 1 }],
  ], row, refresh);
};
A.extraedit = (d) => editRow(d.id ? 'Extra bearbeiten' : 'Neues Extra', '/extras', [
  ['Name', 'name', { required: true }], ['Preis', 'price', { type: 'number', step: '0.01', required: true }],
  ['Berechnung', 'per', { type: 'select', options: Object.entries(PER), def: 'stay' }], ['MwSt. %', 'vat_rate', { type: 'number', def: 19 }], ['Aktiv', 'active', { type: 'checkbox', def: 1 }],
], d.id ? B.extras.find((e) => e.id === Number(d.id)) : null, refresh);

// ---------- Auswertung ----------
let repYear = null;
V.reports = async () => {
  repYear ??= Number(B.today.slice(0, 4));
  const r = await api('GET', '/reports?year=' + repYear);
  const src = Object.entries(r.total.sources).sort((a, b) => b[1] - a[1]);
  const pc = (n) => String(n).replace('.', ',') + ' %';
  $('#view').innerHTML = `${head('Auswertung ' + r.year, `<button class="btn" data-act="repyear" data-d="-1">‹ ${r.year - 1}</button><button class="btn" data-act="repyear" data-d="1">${r.year + 1} ›</button>`)}
  <div class="tiles">${[['Logisumsatz', money(r.total.revenue)], ['Verkaufte Nächte', r.total.nights], ['Auslastung', pc(r.total.occupancy)], ['Ø Zimmerpreis (ADR)', money(r.total.adr)], ['RevPAR', money(r.total.revpar)]]
    .map(([l, v]) => `<div class="tile"><span>${l}</span><b>${v}</b></div>`).join('')}</div>
  <section class="card"><h2>Monate</h2><div class="tablewrap"><table><thead><tr><th>Monat</th><th class="r">Nächte</th><th>Auslastung</th><th class="r">Umsatz</th><th class="r">ADR</th><th class="r">RevPAR</th></tr></thead><tbody>
    ${r.months.map((m) => `<tr><td>${MONTHS[m.month - 1]}</td><td class="r">${m.nights}</td><td><div class="meter"><i style="width:${Math.min(100, m.occupancy)}%"></i></div> ${pc(m.occupancy)}</td>
      <td class="r">${money(m.revenue)}</td><td class="r">${money(m.adr)}</td><td class="r">${money(m.revpar)}</td></tr>`).join('')}</tbody></table></div>
    <p class="sub">Berücksichtigt bestätigte, laufende und abgereiste Buchungen (Logis ohne Extras). Kapazität auf Basis der aktuell buchbaren Zimmer.</p></section>
  <section class="card"><h2>Buchungswege</h2>${src.length ? `<table><tbody>${src.map(([k, v]) => `<tr><td>${esc(k)}</td><td><div class="meter wide"><i style="width:${(v / src[0][1]) * 100}%"></i></div></td><td class="r">${money(v)}</td></tr>`).join('')}</tbody></table>` : '<p class="empty">Keine Daten</p>'}</section>`;
};
A.repyear = (d) => { repYear += Number(d.d); refresh(); };

// ---------- Einstellungen ----------
const FTYPE = { text: 'Text', textarea: 'Mehrzeiliger Text', number: 'Zahl', date: 'Datum', select: 'Auswahlliste', checkbox: 'Ja/Nein' };
const gfRow = (f = { label: '', type: 'text', options: [] }) => `<div class="rowedit gf"><input type="hidden" class="gk" value="${esc(f.key || '')}">
  <input class="gl" placeholder="Bezeichnung" value="${esc(f.label)}" aria-label="Bezeichnung">
  <select class="gt" aria-label="Feldtyp">${Object.entries(FTYPE).map(([k, l]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
  <input class="go" placeholder="Auswahlwerte, mit Komma getrennt" value="${esc((f.options || []).join(', '))}" aria-label="Auswahlwerte">
  <label class="check"><input type="checkbox" class="gi" ${f.inList ? 'checked' : ''}><span>in Liste</span></label>
  <label class="check"><input type="checkbox" class="gr" ${f.required ? 'checked' : ''}><span>Pflicht</span></label>
  <button type="button" class="link" data-act="rowdel">entfernen</button></div>`;
A.gfadd = () => $('#gfields').insertAdjacentHTML('beforeend', gfRow());

V.settings = async () => {
  const h = B.hotel, m = B.mail, a = B.automation, s = B.guestStd;
  const PH = ['anrede', 'vorname', 'nachname', 'firma', 'buchungsnr', 'anreise', 'abreise', 'naechte', 'kategorie', 'zimmer', 'personen', 'gesamtpreis', 'offen', 'hotel', 'hotel_telefon', 'hotel_email', 'hotel_adresse', 'checkin_zeit', 'checkout_zeit', 'signatur'];
  $('#view').innerHTML = `${head('Einstellungen')}
  <section class="card"><h2>Hotel</h2><form data-set="hotel"><div class="grid">
    ${F('Hotelname', 'name', h.name, { required: true })}${F('Straße', 'street', h.street)}${F('PLZ', 'zip', h.zip)}${F('Ort', 'city', h.city)}${F('Land', 'country', h.country)}
    ${F('Telefon', 'phone', h.phone)}${F('E-Mail', 'email', h.email)}${F('Website', 'website', h.website)}
    ${F('Check-in ab', 'checkinTime', h.checkinTime, { type: 'time' })}${F('Check-out bis', 'checkoutTime', h.checkoutTime, { type: 'time' })}
    ${F('Währung', 'currency', h.currency, { type: 'select', options: [['EUR', 'Euro (EUR)'], ['CHF', 'Schweizer Franken (CHF)']] })}
    ${F('MwSt. Übernachtung %', 'vatLodging', h.vatLodging, { type: 'number' })}${F('Kurtaxe je Erwachsenem/Nacht', 'cityTax', h.cityTax, { type: 'number', step: '0.01' })}
    ${F('Kinderermäßigung auf Zusatzperson %', 'childDiscount', h.childDiscount, { type: 'number' })}
    ${F('Rechnungsnummern-Präfix', 'invoicePrefix', h.invoicePrefix)}${F('Steuernummer / USt-IdNr.', 'taxId', h.taxId)}${F('Bankverbindung', 'bank', h.bank, { wide: true })}
    ${F('Fußtext auf Rechnungen', 'invoiceFooter', h.invoiceFooter, { type: 'textarea', wide: true, rows: 2 })}</div><button class="btn primary">Speichern</button></form></section>

  <section class="card"><h2>GMX-Postfach</h2><form data-set="mail"><div class="grid">
    ${F('GMX-Anbindung aktiv', 'enabled', m.enabled, { type: 'checkbox', wide: true })}
    ${F('GMX-Adresse', 'user', m.user, { type: 'email', attrs: 'placeholder="hotel@gmx.de" autocomplete="off"' })}
    ${F('Passwort', 'pass', '', { type: 'password', attrs: `placeholder="${m.hasPass ? '•••••••• (gespeichert – leer lassen zum Behalten)' : 'GMX-Passwort'}" autocomplete="new-password"` })}
    ${F('Absendername', 'fromName', m.fromName, { attrs: `placeholder="${esc(h.name)}"` })}${F('Signatur', 'signature', m.signature, { type: 'textarea', wide: true, rows: 3 })}
    ${F('SMTP-Server', 'smtpHost', m.smtpHost)}${F('SMTP-Port', 'smtpPort', m.smtpPort, { type: 'number', step: 1 })}${F('IMAP-Server', 'imapHost', m.imapHost)}${F('IMAP-Port', 'imapPort', m.imapPort, { type: 'number', step: 1 })}</div>
    <div class="btnrow"><button class="btn primary">Speichern</button><button type="button" class="btn" data-act="mailtest">Verbindung testen</button><span id="mailtest" class="sub"></span></div>
    <p class="sub">Voraussetzung bei GMX: unter <i>E-Mail → Einstellungen → POP3/IMAP Abruf</i> den Zugriff über „POP3 und IMAP“ erlauben. Bei aktivierter Zwei-Faktor-Anmeldung dort ein anwendungsspezifisches Passwort erzeugen und hier eintragen.
    Das Passwort wird verschlüsselt gespeichert.${B.mailState.lastError ? ` <span class="open">Letzter Fehler: ${esc(B.mailState.lastError)}</span>` : ''}</p></form></section>

  <section class="card"><h2>Automatisierung</h2><form data-set="automation"><div class="grid">
    ${F('Buchungsbestätigung automatisch senden', 'confirmOnBooking', a.confirmOnBooking, { type: 'checkbox', wide: true })}
    ${F('Anreise-Erinnerung senden', 'preArrival', a.preArrival, { type: 'checkbox' })}${F('… Tage vor Anreise', 'preArrivalDays', a.preArrivalDays, { type: 'number', step: 1, attrs: 'min="1"' })}
    ${F('Dankeschön-E-Mail nach Abreise', 'thankYou', a.thankYou, { type: 'checkbox', wide: true })}
    ${F('Posteingang automatisch abrufen', 'autoSync', a.autoSync, { type: 'checkbox' })}${F('Abrufintervall (Minuten)', 'syncMinutes', a.syncMinutes, { type: 'number', step: 1, attrs: 'min="2"' })}
    ${F('Zimmer beim Check-out als schmutzig markieren', 'dirtyOnCheckout', a.dirtyOnCheckout, { type: 'checkbox' })}${F('Stammgast ab … Aufenthalten', 'stammgastStays', a.stammgastStays, { type: 'number', step: 1, attrs: 'min="2"' })}
    </div><button class="btn primary">Speichern</button></form></section>

  <section class="card"><h2>Kundenkartei anpassen</h2>
    <form data-set="guestStd"><p class="sub">Standardfelder ein- oder ausblenden:</p><div class="btnrow">
      ${F('Firma', 'company', s.company, { type: 'checkbox' })}${F('Adresse', 'address', s.address, { type: 'checkbox' })}${F('Geburtsdatum', 'birthdate', s.birthdate, { type: 'checkbox' })}
      ${F('Nationalität', 'nationality', s.nationality, { type: 'checkbox' })}${F('Ausweisnummer', 'id_number', s.id_number, { type: 'checkbox' })}<button class="btn small primary">Speichern</button></div></form>
    <form data-set="guestFields"><p class="sub">Eigene Zusatzfelder – erscheinen in jeder Gästekarte, sind durchsuchbar und im CSV-Export enthalten:</p>
      <div id="gfields">${B.guestFields.map(gfRow).join('')}</div>
      <div class="btnrow"><button type="button" class="btn small" data-act="gfadd">+ Feld</button><button class="btn small primary">Felder speichern</button></div></form></section>

  <section class="card"><div class="cardhead"><h2>E-Mail-Vorlagen</h2><button class="btn small" data-act="tpledit">+ Vorlage</button></div>
    <div class="tablewrap"><table><tbody>${B.templates.map((t) => `<tr class="click" data-act="tpledit" data-id="${t.id}"><td><b>${esc(t.name)}</b></td><td>${esc(t.subject)}</td><td>${{ confirmation: 'automatisch bei Buchung', prearrival: 'automatisch vor Anreise', thankyou: 'automatisch nach Abreise', cancellation: 'bei Storno' }[t.key] || ''}</td></tr>`).join('')}</tbody></table></div>
    <p class="sub">Platzhalter: ${PH.map((p) => `<code>{{${p}}}</code>`).join(' ')}</p></section>

  <section class="card"><h2>Passwort ändern</h2><form id="pwform"><div class="grid">${F('Aktuelles Passwort', 'current', '', { type: 'password', required: true, attrs: 'autocomplete="current-password"' })}
    ${F('Neues Passwort (mind. 8 Zeichen)', 'password', '', { type: 'password', required: true, attrs: 'minlength="8" autocomplete="new-password"' })}</div><button class="btn primary">Passwort ändern</button></form></section>`;
  $('#pwform').onsubmit = async (e) => {
    e.preventDefault();
    try { await api('POST', '/auth/password', readForm(e.target)); e.target.reset(); toast('Passwort geändert'); } catch (err) { toast(err.message, 'err'); }
  };
};
A.tpledit = (d) => editRow(d.id ? 'Vorlage bearbeiten' : 'Neue Vorlage', '/templates', [
  ['Name', 'name', { required: true }], ['Betreff', 'subject', { required: true, wide: true }], ['Text', 'body', { type: 'textarea', wide: true, rows: 14 }],
], d.id ? B.templates.find((t) => t.id === Number(d.id)) : null, refresh);
A.mailtest = async (d, el) => {
  const out = $('#mailtest');
  out.textContent = 'Teste Verbindung … (bitte vorher speichern)';
  el.disabled = true;
  try {
    const r = await api('POST', '/mail/test');
    out.innerHTML = `Senden (SMTP): ${r.smtp === 'ok' ? '<b class="okc">in Ordnung</b>' : `<span class="open">${esc(r.smtp)}</span>`} · Abrufen (IMAP): ${r.imap === 'ok' ? '<b class="okc">in Ordnung</b>' : `<span class="open">${esc(r.imap)}</span>`}`;
  } catch (e) { out.textContent = e.message; }
  el.disabled = false;
};
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-set]');
  if (!form) return;
  e.preventDefault();
  const key = form.dataset.set;
  let data = readForm(form);
  if (key === 'guestFields')
    data = $$('.gf', form).map((r) => ({ key: $('.gk', r).value, label: $('.gl', r).value, type: $('.gt', r).value, options: $('.go', r).value, inList: $('.gi', r).checked, required: $('.gr', r).checked }));
  if (key === 'dynamic') data = { enabled: data.enabled, tiers: $$('.tier', form).map((r) => ({ from: $('.tf', r).value, percent: $('.tp', r).value })) };
  try {
    await api('PUT', '/settings/' + key, data);
    await loadBoot();
    toast('Gespeichert');
    refresh();
  } catch (err) { toast(err.message, 'err'); }
});

showAuth().catch((e) => toast(e.message, 'err'));
