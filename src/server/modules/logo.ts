import { eq } from 'drizzle-orm';
import { logoUsageInput, type LogoUsage } from '../../shared/schemas.js';
import type { Db, Exec } from '../db/client.js';
import { settings } from '../db/schema.js';
import { record, type Actor } from './audit.js';

/** Wo das Logo zusätzlich erscheint (Ausdrucke, Gästeseiten, E-Mails). */
export async function getLogoUsage(db: Exec): Promise<LogoUsage> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'logo_usage'));
  return logoUsageInput.parse(row?.value ?? {});
}
export async function saveLogoUsage(db: Db, actor: Actor, v: LogoUsage) {
  await db.insert(settings).values({ key: 'logo_usage', value: v }).onConflictDoUpdate({ target: settings.key, set: { value: v, updatedAt: new Date() } });
  await record(db, actor, { action: 'update', entity: 'settings', entityId: 'logo_usage', after: v });
  return v;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Text-E-Mail als schlichte HTML-Fassung mit Logo oben (das Logo hängt als eingebettetes Bild an: cid:logo). */
export function mailHtml(text: string, hotelName: string): string {
  const linked = (s: string) => esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#1d47a8">${u}</a>`);
  const body = text.replace(/\r/g, '').split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.split('\n').map(linked).join('<br>')}</p>`).join('');
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>`
    + `<body style="margin:0;padding:0;background:#f4f5f7"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7"><tr><td align="center" style="padding:24px 12px">`
    + `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:10px">`
    + `<tr><td style="padding:24px 28px 8px"><img src="cid:logo" alt="${esc(hotelName)}" style="max-height:72px;max-width:240px;display:block;border:0"></td></tr>`
    + `<tr><td style="padding:12px 28px 24px;font:15px/1.55 Arial,Helvetica,sans-serif;color:#1a1d23">${body}</td></tr>`
    + `</table></td></tr></table></body></html>`;
}
