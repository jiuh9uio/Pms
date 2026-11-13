import { desc, eq } from 'drizzle-orm';
import type { TerminalLogDto, TerminalSettings } from '../../shared/billing.js';
import { todayBerlin } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { cardTerminalLog, settings } from '../db/schema.js';
import { AppError, conflict } from '../lib/errors.js';
import { isPrivateIp } from '../lib/escpos.js';
import { zvtRun, type ZvtResult } from '../lib/zvt.js';
import { record, type Actor } from './audit.js';
import { addPayment } from './billing.js';

/** Kartenzahlung über das EC-Gerät: Betrag ans Gerät senden und bei Erfolg als Zahlung „Karte“ buchen. */

const DEFAULT: TerminalSettings = { enabled: false, host: '', port: 20007, password: '000000' };
export async function getTerminal(db: Exec): Promise<TerminalSettings> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'card_terminal'));
  return { ...DEFAULT, ...((row?.value as Partial<TerminalSettings>) ?? {}) };
}
export async function saveTerminal(db: Db, actor: Actor, v: TerminalSettings) {
  if (v.host && !isPrivateIp(v.host)) throw new AppError(400, 'validation', 'Bitte die Eingaben prüfen', { host: 'Bitte die IP-Adresse des EC-Geräts im Hausnetz eintragen, z. B. 192.168.1.60' });
  await db.insert(settings).values({ key: 'card_terminal', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'card_terminal', after: { enabled: v.enabled, host: v.host, port: v.port } });
  return v;
}
export const terminalReady = async (db: Exec) => { const t = await getTerminal(db); return t.enabled && !!t.host; };

let busy = false;
async function run(db: Exec, amountCents: number | null): Promise<ZvtResult> {
  const t = await getTerminal(db);
  if (!t.enabled || !t.host) throw conflict('Das EC-Gerät ist noch nicht eingerichtet (Verwaltung → Einstellungen → EC-Gerät)', 'terminal_not_configured');
  if (busy) throw conflict('Am EC-Gerät läuft gerade ein anderer Vorgang – bitte warten', 'terminal_busy');
  busy = true;
  try { return await zvtRun({ host: t.host, port: t.port, password: t.password, timeoutMs: Number(process.env.PMS_TERMINAL_TIMEOUT_MS) || undefined }, amountCents); }
  finally { busy = false; }
}

/** Nur anmelden – es wird nichts abgebucht. */
export async function testTerminal(db: Exec) {
  const r = await run(db, null);
  if (r.outcome !== 'approved') throw new AppError(502, 'terminal_failed', r.message);
  return { ok: true, message: r.message };
}

export async function payByTerminal(db: Db, actor: Actor, v: { bookingId?: string; invoiceId?: string; amountCents: number; payer: string; note: string }) {
  const payment = { bookingId: v.bookingId, invoiceId: v.invoiceId, amountCents: v.amountCents, method: 'Karte', date: todayBerlin(), payer: v.payer };
  // Vorab prüfen, dass sich die Zahlung buchen lässt – sonst wäre abgebucht, aber nichts verbucht
  class DryRun extends Error {}
  try { await db.transaction(async (tx) => { await addPayment(tx as unknown as Db, actor, { ...payment, note: v.note }); throw new DryRun(); }); }
  catch (e) { if (!(e instanceof DryRun)) throw e; }

  const r = await run(db, v.amountCents);
  const log = async (outcome: TerminalLogDto['outcome'], message: string, paymentId: string | null = null) => {
    await db.insert(cardTerminalLog).values({
      amountCents: v.amountCents, outcome, message, trace: r.trace, receiptNo: r.receiptNo, cardName: r.cardName,
      bookingId: v.bookingId ?? null, invoiceId: v.invoiceId ?? null, paymentId, userName: actor.userName,
    });
  };
  if (r.outcome === 'declined') { await log('declined', r.message); throw new AppError(409, 'terminal_declined', r.message); }
  if (r.outcome === 'unknown') {
    await log('unknown', r.message);
    await record(db, actor, { action: 'terminal_unknown', entity: 'payment', after: { amountCents: v.amountCents, bookingId: v.bookingId, invoiceId: v.invoiceId, message: r.message } });
    throw new AppError(502, 'terminal_unknown', r.message);
  }
  const details = ['EC-Gerät', r.cardName, r.receiptNo && `Beleg ${r.receiptNo}`, r.trace && `TA-Nr. ${r.trace}`].filter(Boolean).join(', ');
  try {
    const p = await addPayment(db, actor, { ...payment, note: [details, v.note].filter(Boolean).join(' · ').slice(0, 300) });
    await log('approved', r.message, p.id);
    return { id: p.id, message: `Kartenzahlung erfolgreich${r.cardName ? ` (${r.cardName})` : ''}` };
  } catch (e) {
    const msg = 'Die Karte wurde belastet, die Zahlung konnte aber nicht gebucht werden. Bitte die Zahlung von Hand als „Karte“ erfassen – nicht erneut am Gerät kassieren.';
    await log('unrecorded', `${msg} (${e instanceof Error ? e.message : e})`);
    throw new AppError(500, 'terminal_unrecorded', msg);
  }
}

export async function terminalLog(db: Exec): Promise<TerminalLogDto[]> {
  const rows = await db.select().from(cardTerminalLog).orderBy(desc(cardTerminalLog.at)).limit(30);
  return rows.map((r) => ({ id: r.id, at: r.at.toISOString(), amountCents: r.amountCents, outcome: r.outcome, message: r.message, trace: r.trace, receiptNo: r.receiptNo, cardName: r.cardName, userName: r.userName }));
}
