import { eq } from 'drizzle-orm';
import { CHECKIN_SHEET_DEFAULTS, type CheckinSheet, type CheckinSheetDto } from '../../shared/hotel.js';
import type { Db, Exec } from '../db/client.js';
import { settings } from '../db/schema.js';
import { record, type Actor } from './audit.js';
import { getWifi } from './network.js';
import { getHotel } from './settings.js';

/** Check-in-Blatt: Meldeschein mit abtrennbaren Gästeinformationen (WLAN mit QR-Code, Frühstück, Zimmerreinigung …). */
export async function getCheckinSheet(db: Exec): Promise<CheckinSheet> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'checkin_sheet'));
  if (row) return { ...CHECKIN_SHEET_DEFAULTS, ...(row.value as Partial<CheckinSheet>) };
  // noch nie gespeichert: Vorschlag aus den Hotel-Einstellungen (Frühstückszeiten, Abreise, Öffnungszeiten)
  const h = await getHotel(db);
  const info = [
    `Frühstück | ${h.breakfastTimes || '7:00 – 10:00 Uhr'}`,
    'Zimmerreinigung | täglich zwischen 10:00 und 14:00 Uhr – bitte Schild „Bitte nicht stören“ an die Tür hängen, wenn Sie keine Reinigung wünschen',
    `Abreise | bitte bis ${h.checkoutTime || '11:00'} Uhr das Zimmer freigeben`,
    ...(h.openingHours ? [`Restaurant | ${h.openingHours.split('\n').map((x) => x.trim()).filter(Boolean).join(' · ')}`] : []),
    `Rezeption | ${h.phone ? `bei Fragen einfach anrufen: ${h.phone}` : 'bei Fragen einfach anrufen oder vorbeikommen'}`,
  ].join('\n');
  return { ...CHECKIN_SHEET_DEFAULTS, info };
}
export async function saveCheckinSheet(db: Db, actor: Actor, v: CheckinSheet) {
  await db.insert(settings).values({ key: 'checkin_sheet', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'checkin_sheet', after: v });
  return getCheckinSheet(db);
}
/** Für den Druck: Zeilen aufbereitet, WLAN nur, wenn eingeschaltet und eingerichtet. */
export async function checkinSheetForPrint(db: Exec): Promise<CheckinSheetDto> {
  const s = await getCheckinSheet(db);
  const lines = s.info.split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12).map((l) => {
    const i = l.indexOf('|');
    return i < 0 ? { label: '', value: l } : { label: l.slice(0, i).trim(), value: l.slice(i + 1).trim() };
  });
  let wifi: CheckinSheetDto['wifi'] = null;
  if (s.showWifi) {
    const w = await getWifi(db);
    if (w.qr) wifi = { ssid: w.ssid, password: w.open ? '' : w.password, open: w.open, qr: w.qr };
  }
  return { ...s, lines, wifi };
}
