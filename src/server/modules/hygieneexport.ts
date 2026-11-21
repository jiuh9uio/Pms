import fontkit from '@pdf-lib/fontkit';
import { and, asc, gte, lte } from 'drizzle-orm';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { intervalLabel, outOfRange } from '../../shared/controls.js';
import { addDays, type MailDraft } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { goodsReceipts, hygieneReadings } from '../db/schema.js';
import { asset } from '../einvoice/pdf.js';
import { columns, type Line } from '../lib/escpos.js';
import { AppError } from '../lib/errors.js';
import { record, type Actor } from './audit.js';
import { getLogo } from './billing.js';
import { listAreas, listCleaningLog, listCleaningTasks } from './controls.js';
import { ready, signature } from './hotelmail.js';
import { getLogoUsage } from './logo.js';
import { sendMail } from './mail.js';
import { printLines } from './quickprint.js';
import { getHotel } from './settings.js';

/**
 * Temperaturprotokoll ausgeben: als PDF (Ansehen, Drucken, per E-Mail, z. B. an das Hygieneamt) und kompakt auf dem Bondrucker.
 * Bewertet wird jeder Wert nach dem Sollbereich, der beim Eintragen galt (ältere Werte: Sollbereich der Messstelle).
 */
const de = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.${s.slice(0, 4)}`;
const short = (s: string) => `${s.slice(8, 10)}.${s.slice(5, 7)}.`;
const num = (n: number) => n.toLocaleString('de-DE', { maximumFractionDigits: 1 });
const range = (p: { minC: number | null; maxC: number | null }) =>
  p.minC != null && p.maxC != null ? `${num(p.minC)} bis ${num(p.maxC)} °C` : p.maxC != null ? `höchstens ${num(p.maxC)} °C` : p.minC != null ? `mindestens ${num(p.minC)} °C` : 'ohne Sollbereich';

export const EXPORT_PARTS = ['temp', 'clean', 'goods'] as const;
export type ExportPart = (typeof EXPORT_PARTS)[number];
/** parts = was ins PDF kommt (Vorgabe: nur das Temperaturprotokoll); der Wareneingang hat keinen Bereich und erscheint nur bei „alle Bereiche“ */
export interface ExportQuery { from: string; to: string; areaId: string | null; parts?: ExportPart[] }
const partsOf = (q: ExportQuery): ExportPart[] => (q.parts?.length ? EXPORT_PARTS.filter((p) => q.parts!.includes(p)) : ['temp']);
const docName = (q: ExportQuery) => { const p = partsOf(q); return p.length === 1 ? { temp: 'Temperaturprotokoll', clean: 'Reinigungsprotokoll', goods: 'Wareneingang' }[p[0]!] : 'Eigenkontrolle'; };
const fileOf = (q: ExportQuery) => `${docName(q)}_${q.from}_bis_${q.to}.pdf`;
interface Cell { value: number | null; confirmed: boolean; bad: boolean; note: string; by: string }

async function collect(db: Exec, q: ExportQuery) {
  if (q.to < q.from) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { to: 'Das Ende liegt vor dem Beginn' });
  const days: string[] = [];
  for (let d = q.from; d <= q.to && days.length <= 400; d = addDays(d, 1)) days.push(d);
  if (days.length > 400) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { to: 'Höchstens 400 Tage auf einmal' });
  const areas = (await listAreas(db)).filter((a) => (q.areaId ? a.id === q.areaId : a.active)).map((a) => ({ ...a, points: a.points.filter((p) => p.active || q.areaId) }))
    .filter((a) => a.points.length);
  const rows = await db.select().from(hygieneReadings).where(and(gte(hygieneReadings.date, q.from), lte(hygieneReadings.date, q.to))).orderBy(asc(hygieneReadings.date));
  const cell = new Map<string, Cell>();
  const points = new Map(areas.flatMap((a) => a.points).map((p) => [p.id, p]));
  for (const r of rows) {
    const p = points.get(r.pointId);
    if (!p) continue;
    const lim = r.rangeSaved ? { minC: r.minC, maxC: r.maxC } : p;
    cell.set(`${r.pointId}|${r.date}`, { value: r.valueC, confirmed: r.confirmed, bad: r.valueC != null && outOfRange(r.valueC, lim), note: r.note, by: r.userName });
  }
  return { days, areas, cell };
}

// ---------- PDF (A4 quer) ----------
export async function exportPdf(db: Db, actor: Actor, q: ExportQuery): Promise<{ fileName: string; pdf: Buffer }> {
  const { days, areas, cell } = await collect(db, q);
  const parts = partsOf(q);
  const h = await getHotel(db);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(asset('LiberationSans-Regular.ttf'), { subset: true });
  const bold = await doc.embedFont(asset('LiberationSans-Bold.ttf'), { subset: true });
  let image: PDFImage | null = null;
  if ((await getLogoUsage(db)).printouts) {
    const logo = await getLogo(db);
    if (logo) { try { image = logo.mime === 'image/png' ? await doc.embedPng(logo.data) : await doc.embedJpg(logo.data); } catch { image = null; } }
  }
  doc.setTitle(`${docName(q)} ${de(q.from)} – ${de(q.to)}`); doc.setAuthor(h.name);
  const W = 841.89, H = 595.28, L = 36, R = W - 36, bottom = 44;
  const black = rgb(0.1, 0.1, 0.1), grey = rgb(0.4, 0.4, 0.4), hair = rgb(0.8, 0.8, 0.8), band = rgb(0.94, 0.94, 0.94), red = rgb(0.7, 0.1, 0.1), warn = rgb(1, 0.92, 0.9);
  const pages: PDFPage[] = [];
  let page!: PDFPage; let y = 0;
  const put = (s: string, x: number, yy: number, o: { size?: number; font?: PDFFont; color?: typeof black; right?: boolean; center?: number } = {}) => {
    const size = o.size ?? 8.5, font = o.font ?? regular;
    const w = font.widthOfTextAtSize(s, size);
    page.drawText(s, { x: o.center != null ? x + (o.center - w) / 2 : o.right ? x - w : x, y: yy, size, font, color: o.color ?? black });
  };
  const fit = (s: string, width: number, size: number, font = regular) => { let t = s; while (t.length > 1 && font.widthOfTextAtSize(t, size) > width) t = t.slice(0, -1); return t === s ? s : `${t.slice(0, -1)}…`; };
  const newPage = (title: string) => {
    page = doc.addPage([W, H]); pages.push(page); y = H - 40;
    if (image) { const s = Math.min(120 / image.width, 36 / image.height, 1); page.drawImage(image, { x: R - image.width * s, y: H - 28 - image.height * s, width: image.width * s, height: image.height * s }); }
    put(h.name, L, y, { size: 11, font: bold }); y -= 16;
    put(title, L, y, { size: 14, font: bold }); y -= 14;
    put(`Zeitraum ${de(q.from)} bis ${de(q.to)}`, L, y, { size: 9, color: grey }); y -= 18;
  };
  const notes: { day: string; point: string; text: string }[] = [];
  let badCount = 0, missing = 0;
  for (const a of parts.includes('temp') ? areas : []) {
    // breite Bereiche: Messstellen in Gruppen zu höchstens 9 Spalten
    for (let g = 0; g < a.points.length; g += 9) {
      const pts = a.points.slice(g, g + 9);
      const dayW = 64, byW = 120, colW = Math.min(110, (R - L - dayW - byW) / pts.length);
      const header = () => {
        page.drawRectangle({ x: L, y: y - 22, width: R - L, height: 30, color: band });
        put('Tag', L + 4, y - 4, { size: 8, font: bold });
        pts.forEach((p, i) => {
          const x = L + dayW + i * colW;
          put(fit(p.name, colW - 4, 8, bold), x, y - 4, { size: 8, font: bold, center: colW });
          put(fit(range(p), colW - 4, 6.5), x, y - 15, { size: 6.5, color: grey, center: colW });
        });
        put('eingetragen von', L + dayW + pts.length * colW + 6, y - 4, { size: 8, font: bold });
        y -= 30;
      };
      const title = `Temperaturprotokoll – ${a.name}`;
      if (!pages.length || y < bottom + 80) newPage(title); else { y -= 10; put(title, L, y, { size: 11, font: bold }); y -= 14; }
      header();
      for (const d of days) {
        if (y < bottom + 14) { newPage(`${title} (Fortsetzung)`); header(); }
        const wd = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(`${d}T12:00:00Z`).getUTCDay()];
        put(`${wd} ${short(d)}`, L + 4, y, { size: 8.5 });
        const by = new Set<string>();
        pts.forEach((p, i) => {
          const c = cell.get(`${p.id}|${d}`);
          const x = L + dayW + i * colW;
          if (!c) { put('–', x, y, { color: grey, center: colW }); missing++; return; }
          by.add(c.by);
          if (c.bad) { page.drawRectangle({ x: x + 2, y: y - 3, width: colW - 4, height: 12, color: warn }); badCount++; }
          const t = c.value == null ? (c.confirmed ? 'im Soll' : '–') : `${num(c.value)}${c.note ? ' *' : ''}`;
          put(t, x, y, { size: 8.5, font: c.bad ? bold : regular, color: c.bad ? red : black, center: colW });
          if (c.note) notes.push({ day: d, point: p.name, text: c.note });
        });
        put(fit([...by].join(', '), byW - 8, 7.5), L + dayW + pts.length * colW + 6, y, { size: 7.5, color: grey });
        page.drawLine({ start: { x: L, y: y - 4 }, end: { x: R, y: y - 4 }, thickness: 0.3, color: hair });
        y -= 13;
      }
    }
  }
  if (parts.includes('temp')) {
    if (!areas.length) { newPage('Temperaturprotokoll'); put('Keine Messstellen vorhanden.', L, y); }
    // Zusammenfassung und Maßnahmen
    const sumLines = [`Werte außerhalb des Sollbereichs: ${badCount}`, `Fehlende Einträge (–): ${missing}`];
    if (y < bottom + 40 + notes.length * 11) newPage('Temperaturprotokoll – Bemerkungen und Maßnahmen');
    y -= 10;
    put(sumLines.join('   ·   '), L, y, { size: 9, font: bold }); y -= 16;
    if (notes.length) {
      put('Bemerkungen und ergriffene Maßnahmen (*)', L, y, { size: 9, font: bold }); y -= 13;
      for (const n of notes) {
        if (y < bottom + 12) { newPage('Temperaturprotokoll – Bemerkungen und Maßnahmen (Fortsetzung)'); }
        put(`${de(n.day)} · ${n.point}: ${fit(n.text, R - L - 160, 8.5)}`, L, y, { size: 8.5 }); y -= 11;
      }
    }
  }
  // ---------- Reinigungsprotokoll: je Bereich alle Einträge des Zeitraums, dazu Aufgaben ohne Eintrag ----------
  let cleanCount = 0, goodsCount = 0, goodsBad = 0;
  /** einfache Tabelle mit festen Spalten; bricht auf eine neue Seite um und wiederholt die Kopfzeile */
  const table = (title: string, cols: [string, number][], rows: { cells: string[]; bad?: boolean }[], empty: string) => {
    const head = () => {
      page.drawRectangle({ x: L, y: y - 6, width: R - L, height: 16, color: band });
      let x = L + 4; for (const [name, w] of cols) { put(name, x, y - 1, { size: 8, font: bold }); x += w; }
      y -= 19;
    };
    if (!pages.length || y < bottom + 70) newPage(title); else { y -= 14; put(title, L, y, { size: 11, font: bold }); y -= 16; }
    if (!rows.length) { put(empty, L, y, { color: grey }); y -= 13; return; }
    head();
    for (const r of rows) {
      if (y < bottom + 14) { newPage(`${title} (Fortsetzung)`); head(); }
      let x = L + 4;
      r.cells.forEach((c, i) => { put(fit(c, cols[i]![1] - 8, 8.5), x, y, { size: 8.5, color: r.bad ? red : black, font: r.bad && i === 0 ? bold : regular }); x += cols[i]![1]; });
      page.drawLine({ start: { x: L, y: y - 4 }, end: { x: R, y: y - 4 }, thickness: 0.3, color: hair });
      y -= 13;
    }
  };
  const wday = (d: string) => `${['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(`${d}T12:00:00Z`).getUTCDay()]} ${de(d)}`;
  if (parts.includes('clean')) {
    const [tasks, log, allAreas] = [await listCleaningTasks(db), await listCleaningLog(db, q.from, q.to), await listAreas(db)];
    const shown = allAreas.filter((a) => (q.areaId ? a.id === q.areaId : true)).map((a) => ({ a, tasks: tasks.filter((t) => t.areaId === a.id) }))
      .filter((x) => x.tasks.some((t) => t.active || log.some((l) => l.taskId === t.id)));
    if (!shown.length) { newPage('Reinigungsprotokoll'); put('Keine Reinigungsaufgaben vorhanden.', L, y); y -= 13; }
    for (const { a, tasks: ts } of shown) {
      const byId = new Map(ts.map((t) => [t.id, t]));
      const rows = log.filter((l) => byId.has(l.taskId)).map((l) => {
        const t = byId.get(l.taskId)!;
        return { cells: [wday(l.date), t.name, intervalLabel(t.intervalDays), l.userName, new Date(l.doneAt).toLocaleTimeString('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit' }) + ' Uhr'] };
      });
      cleanCount += rows.length;
      table(`Reinigungsprotokoll – ${a.name}`, [['Tag', 110], ['Aufgabe', 330], ['Turnus', 130], ['erledigt von', 130], ['Uhrzeit', 70]], rows, 'In diesem Zeitraum ist keine Reinigung eingetragen.');
      const none = ts.filter((t) => t.active && !log.some((l) => l.taskId === t.id));
      if (none.length && rows.length) { if (y < bottom + 14) newPage(`Reinigungsprotokoll – ${a.name} (Fortsetzung)`); put(fit(`Im Zeitraum ohne Eintrag: ${none.map((t) => `${t.name} (${intervalLabel(t.intervalDays)})`).join(', ')}`, R - L, 8), L, y - 2, { size: 8, color: grey }); y -= 14; }
    }
  }
  // ---------- Wareneingang ----------
  if (parts.includes('goods') && !q.areaId) {
    const rec = await db.select().from(goodsReceipts).where(and(gte(goodsReceipts.date, q.from), lte(goodsReceipts.date, q.to))).orderBy(asc(goodsReceipts.date), asc(goodsReceipts.createdAt));
    goodsCount = rec.length; goodsBad = rec.filter((r) => !r.ok).length;
    table('Wareneingang', [['Tag', 100], ['Lieferant', 150], ['Ware', 200], ['Temperatur', 70], ['Ergebnis', 80], ['Bemerkung', 90], ['geprüft von', 80]],
      rec.map((r) => ({ bad: !r.ok, cells: [wday(r.date), r.supplier, r.goods, r.tempC == null ? 'nicht gemessen' : `${num(r.tempC)} °C`, r.ok ? 'in Ordnung' : 'beanstandet', r.note, r.userName] })),
      'In diesem Zeitraum ist kein Wareneingang eingetragen.');
    // Bemerkungen, die in der Spalte nicht ganz Platz haben, vollständig darunter
    const long = rec.filter((r) => r.note && regular.widthOfTextAtSize(r.note, 8.5) > 82);
    if (long.length) {
      if (y < bottom + 30) newPage('Wareneingang – Bemerkungen'); else y -= 8;
      put('Bemerkungen im vollen Wortlaut', L, y, { size: 9, font: bold }); y -= 13;
      for (const r of long) { if (y < bottom + 12) newPage('Wareneingang – Bemerkungen (Fortsetzung)'); put(fit(`${de(r.date)} · ${r.supplier}: ${r.note}`, R - L, 8.5), L, y, { size: 8.5 }); y -= 11; }
    }
  }
  pages.forEach((p, i) => {
    page = p;
    put(`Erstellt am ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })} von ${actor.userName}${parts.includes('temp') ? ' · „im Soll“ = als im Sollbereich bestätigt · rot = außerhalb des Sollbereichs' : ''}`, L, 22, { size: 7, color: grey });
    put(`Seite ${i + 1} von ${pages.length}`, R, 22, { size: 7, color: grey, right: true });
  });
  await record(db, actor, { action: 'export_pdf', entity: 'hygiene', after: { from: q.from, to: q.to, area: q.areaId, parts, outOfRange: badCount, cleaning: cleanCount, goods: goodsCount, goodsBad } });
  return { fileName: fileOf(q), pdf: Buffer.from(await doc.save()) };
}

// ---------- E-Mail ----------
export async function mailDraft(db: Exec, q: ExportQuery): Promise<MailDraft> {
  const h = await getHotel(db);
  const text = ['Sehr geehrte Damen und Herren,', '', partsOf(q).length === 1 ? `anbei erhalten Sie ${{ temp: 'das Temperaturprotokoll', clean: 'das Reinigungsprotokoll', goods: 'die Aufzeichnungen zum Wareneingang' }[partsOf(q)[0]!]} vom ${de(q.from)} bis ${de(q.to)} als PDF.`
    : `anbei erhalten Sie unsere Aufzeichnungen zur Eigenkontrolle (${partsOf(q).map((p) => ({ temp: 'Temperaturen', clean: 'Reinigung', goods: 'Wareneingang' })[p]).join(', ')}) vom ${de(q.from)} bis ${de(q.to)} als PDF.`, '', signature(h)].join('\n');
  return { to: '', subject: `${docName(q)} ${de(q.from)} – ${de(q.to)} – ${h.name}`, text, attachment: fileOf(q), ready: await ready(db) } as MailDraft;
}
export async function sendPdf(db: Db, actor: Actor, q: ExportQuery, v: { to: string; subject: string; text: string }) {
  const { fileName, pdf } = await exportPdf(db, actor, q);
  await sendMail(db, actor, { to: v.to, subject: v.subject, text: v.text, attachments: [{ filename: fileName, content: pdf, contentType: 'application/pdf' }] });
  await record(db, actor, { action: 'export_mail', entity: 'hygiene', after: { from: q.from, to: q.to, parts: partsOf(q), to_: v.to } });
  return { ok: true };
}

// ---------- Bondrucker: möglichst kompakt ----------
/**
 * Je Bereich eine Legende (A = Kühlschrank 0–7 °C …), dann je Tag eine Zeile mit allen Werten:
 * „17.11 A4 B-19 C3“. „!“ = außerhalb des Sollbereichs, „ok“ = im Soll bestätigt, „-“ = fehlt. Bemerkungen am Ende.
 */
export function bonLines(data: Awaited<ReturnType<typeof collect>>, head: { hotel: string; from: string; to: string; by: string }, w: number): Line[] {
  const { days, areas, cell } = data;
  const out: Line[] = [
    { text: head.hotel, align: 'center', bold: true }, { text: 'TEMPERATUREN', align: 'center', bold: true, big: true },
    { text: `${de(head.from)} - ${de(head.to)}`, align: 'center' }, { rule: true },
  ];
  const notes: string[] = [];
  let bad = 0;
  for (const a of areas) {
    out.push({ text: a.name.toUpperCase(), bold: true });
    const code = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`);
    a.points.forEach((p, i) => out.push({ text: columns(`${code(i)} ${p.name}`, range(p).replace(' bis ', '..').replace('höchstens ', '<=').replace('mindestens ', '>='), w) }));
    for (const d of days) {
      const parts = a.points.map((p, i) => {
        const c = cell.get(`${p.id}|${d}`);
        if (c?.note) notes.push(`${short(d)} ${code(i)}: ${c.note}`);
        if (c?.bad) bad++;
        return `${code(i)}${!c ? '-' : c.value == null ? (c.confirmed ? 'ok' : '-') : num(c.value)}${c?.bad ? '!' : ''}`;
      });
      // so viele Werte je Zeile wie passen; Folgezeilen eingerückt
      let line = short(d);
      for (const t of parts) {
        if (line.length + 1 + t.length > w) { out.push({ text: line }); line = '      '; }
        line += ` ${t}`;
      }
      out.push({ text: line });
    }
    out.push({ rule: true });
  }
  if (notes.length) {
    out.push({ text: 'Bemerkungen / Massnahmen', bold: true });
    for (const n of notes) for (let i = 0; i < n.length; i += w) out.push({ text: (i ? '  ' : '') + n.slice(i, i + w - (i ? 2 : 0)) });
    out.push({ rule: true });
  }
  out.push({ text: `! = ausserhalb Soll (${bad})` }, { text: 'ok = im Soll bestaetigt, - = fehlt' }, { text: `Gedruckt ${new Date().toLocaleString('de-DE', { timeZone: 'Europe/Berlin' })}` }, { text: `von ${head.by}` });
  // zu lange Zeilen (z. B. langer Hausname, schmales Papier) an Leerzeichen umbrechen; große Schrift ist doppelt breit
  return out.flatMap((l): Line[] => {
    if (!('text' in l)) return [l];
    const max = l.big ? Math.floor(w / 2) : w;
    if (l.text.length <= max) return [l];
    const parts: string[] = [];
    let cur = '';
    for (const word of l.text.split(' ')) {
      for (let piece = word; piece.length; piece = piece.slice(max)) {
        const chunk = piece.slice(0, max);
        if (!cur) cur = chunk; else if (cur.length + 1 + chunk.length <= max) cur += ` ${chunk}`; else { parts.push(cur); cur = chunk; }
      }
    }
    if (cur) parts.push(cur);
    return parts.map((t) => ({ ...l, text: t }));
  });
}
export async function printBon(db: Db, actor: Actor, q: ExportQuery) {
  const data = await collect(db, q);
  const h = await getHotel(db);
  await printLines(db, (w) => bonLines(data, { hotel: h.name, from: q.from, to: q.to, by: actor.userName }, w));
  await record(db, actor, { action: 'print_bon', entity: 'hygiene', after: { from: q.from, to: q.to, area: q.areaId } });
  return { ok: true };
}
export { collect as collectHygiene };
