import { sql } from 'drizzle-orm';
import { todayBerlin } from '../../shared/hotel.js';
import type { SetupChecklist, SetupItem } from '../../shared/schemas.js';
import { getBackupStatus } from '../backup.js';
import type { Exec } from '../db/client.js';
import { invoiceNumberState } from './billing.js';
import { getPrinter } from './breakfast.js';
import { getPolicy } from './guestlink.js';
import { getInboxSettings } from './inbox.js';
import { getMailSettings } from './mail.js';
import { getFritz } from './network.js';
import { getFrontPrinter } from './quickprint.js';
import { getHotel, listTaxRates } from './settings.js';
import { getTerminal } from './terminal.js';
import { getTse } from './tse.js';

/**
 * Start-Checkliste: Was ist eingerichtet, was fehlt noch vor dem echten Betrieb? Reine Auswertung der vorhandenen Einstellungen.
 * „check“ steht bei Punkten, die das Programm nicht selbst feststellen kann (z. B. ob ein Gerät mit echter Hardware erprobt wurde).
 */
export async function checklist(db: Exec): Promise<SetupChecklist> {
  const [h, taxes, backup, mail, inbox, kitchen, front, terminal, tse, fritz, policy] = [
    await getHotel(db), await listTaxRates(db), getBackupStatus(), await getMailSettings(db), await getInboxSettings(db), await getPrinter(db), await getFrontPrinter(db),
    await getTerminal(db), await getTse(db), await getFritz(db), await getPolicy(db)];
  const [c] = await db.execute(sql`select
    (select count(*) from room_categories)::int as cats, (select count(*) from rooms where active)::int as rooms,
    (select count(*) from services where is_breakfast and active)::int as breakfast, (select count(*) from users where active and role <> 'admin')::int as staff,
    (select count(*) from bookings)::int as bookings, (select count(*) from invoices where number is not null)::int as invoices,
    (select count(*) from settings where key = 'logo')::int as logo`);
  const n = c as Record<string, number>;
  const year = Number(todayBerlin().slice(0, 4));
  const num = await invoiceNumberState(db, year);
  const it = (key: string, title: string, state: SetupItem['state'], detail: string, to: string): SetupItem => ({ key, title, state, detail, to });
  const missingHouse = [!h.street && 'Straße', (!h.zip || !h.city) && 'PLZ und Ort', !h.phone && 'Telefon', !(h.taxNumber || h.vatId) && 'Steuernummer oder USt-IdNr.', !h.iban && 'IBAN'].filter(Boolean) as string[];
  const lodging = taxes.find((t) => t.active && t.defaultFor === 'lodging');

  const groups: SetupChecklist['groups'] = [
    { title: 'Grundlagen – vor dem Start nötig', items: [
      it('house', 'Angaben zum Haus', missingHouse.length ? 'todo' : 'done', missingHouse.length ? `Es fehlen: ${missingHouse.join(', ')}. Diese Angaben stehen auf jeder Rechnung.` : `${h.name}, ${h.zip} ${h.city}`, '/einstellungen?ansicht=haus'),
      it('tax', 'Steuersatz für Übernachtungen', lodging ? 'done' : 'todo', lodging ? `${String(lodging.ratePercent).replace('.', ',')} % als Standard für Übernachtungen` : 'Es ist kein Standard-Steuersatz für Übernachtungen festgelegt.', '/einstellungen?ansicht=steuern'),
      it('cats', 'Zimmerkategorien mit Preisen', n.cats! > 0 ? 'done' : 'todo', n.cats! > 0 ? `${n.cats} ${n.cats === 1 ? 'Kategorie' : 'Kategorien'}` : 'Noch keine Kategorie angelegt (z. B. Einzelzimmer, Doppelzimmer).', '/zimmer'),
      it('rooms', 'Zimmer', n.rooms! > 0 ? 'done' : 'todo', n.rooms! > 0 ? `${n.rooms} buchbare Zimmer` : 'Noch kein Zimmer angelegt.', '/zimmer?ansicht=zimmer'),
      it('backup', 'Sicherung auf einem zweiten Datenträger', !backup.supported ? 'optional' : backup.copyDir && !backup.copyError ? 'done' : 'todo',
        !backup.supported ? 'Die eingebaute Sicherung gibt es nur in der Windows-Version.' : backup.copyError ? backup.copyError
          : backup.copyDir ? `Kopie nach ${backup.copyDir}${backup.last ? '' : ' – die erste Sicherung steht noch aus'}` : 'Die Sicherung liegt bisher nur auf demselben Rechner. Geht dessen Festplatte kaputt, sind die Daten weg – bitte in der Datei pms.env einen zweiten Datenträger eintragen (BACKUP_COPY_DIR).', '/einstellungen?ansicht=sicherung'),
      it('number', 'Erste Rechnungsnummer', num.issued > 0 ? 'done' : 'check', num.issued > 0 ? `Nächste Nummer in ${year}: ${num.sample}` : `Die erste Rechnung bekommt die Nummer ${num.sample}. Haben Sie in ${year} schon Rechnungen mit anderen Nummern geschrieben, legen Sie hier den Anschluss fest.`, '/einstellungen?ansicht=steuern'),
    ] },
    { title: 'Empfehlenswert', items: [
      it('breakfast', 'Frühstück als Leistung', n.breakfast! > 0 ? 'done' : 'optional', n.breakfast! > 0 ? 'angelegt – erscheint in der Frühstücksliste' : 'Ohne Leistung mit dem Kennzeichen „Frühstück“ bleibt die Frühstücksliste leer.', '/zimmer?ansicht=leistungen'),
      it('staff', 'Eigene Benutzer für das Personal', n.staff! > 0 ? 'done' : 'optional', n.staff! > 0 ? `${n.staff} ${n.staff === 1 ? 'Benutzer' : 'Benutzer'} neben dem Administrator` : 'Bisher arbeitet nur der Administrator. Mit eigenen Benutzern steht im Protokoll, wer was gemacht hat.', '/benutzer'),
      it('logo', 'Logo auf der Rechnung', n.logo! > 0 ? 'done' : 'optional', n.logo! > 0 ? 'hinterlegt' : 'Ohne Logo steht oben der Name des Hauses.', '/einstellungen?ansicht=haus'),
      it('policy', 'Stornobedingungen', policy.enabled ? 'done' : 'optional', policy.enabled ? `kostenfrei bis ${policy.freeDays} Tage vor Anreise, danach ${policy.feePercent} %` : 'Nicht eingeschaltet – in Bestätigungen stehen dann keine Bedingungen.', '/einstellungen?ansicht=algorithmen'),
      it('cleanup', 'Probedaten aufräumen', n.bookings! === 0 && n.invoices! === 0 ? 'done' : 'check', n.bookings! === 0 && n.invoices! === 0 ? 'Es gibt keine Reservierungen und Rechnungen.' : `Es gibt ${n.bookings} Reservierungen und ${n.invoices} Rechnungen. Sind Probedaten darunter, vor dem Start unter „Daten löschen“ entfernen – echte Rechnungen nicht löschen.`, '/einstellungen?ansicht=loeschen'),
    ] },
    { title: 'Geräte und Anbindungen – jeweils bei Ihnen zu erproben', items: [
      it('mail', 'E-Mail-Versand', mail.enabled && mail.hasPassword ? 'check' : 'optional', mail.enabled && mail.hasPassword ? `eingerichtet für ${mail.user} – bitte einmal „Testnachricht senden“` : 'Nicht eingerichtet. Bestätigungen und Rechnungen lassen sich dann nicht aus dem Programm senden.', '/einstellungen?ansicht=email'),
      it('inbox', 'E-Mail-Empfang (Modul E-Mail)', inbox.enabled && inbox.hasPassword ? 'check' : 'optional', inbox.enabled && inbox.hasPassword ? `eingerichtet für ${inbox.user} – bitte einmal „Jetzt abrufen“` : 'Nicht eingerichtet.', '/einstellungen?ansicht=email'),
      it('kitchen', 'Bondrucker Küche', kitchen.enabled && kitchen.host ? 'check' : 'optional', kitchen.enabled && kitchen.host ? `eingetragen: ${kitchen.host} – bitte einen Testdruck machen` : 'Nicht eingerichtet. Die Frühstücksliste lässt sich solange auf einem normalen Drucker ausgeben.', '/einstellungen?ansicht=drucker'),
      it('front', 'Bondrucker Rezeption (Schnelldruck)', front.enabled && front.host ? 'check' : 'optional', front.enabled && front.host ? `eingetragen: ${front.host} – bitte einen Testdruck machen` : 'Nicht eingerichtet.', '/einstellungen?ansicht=drucker'),
      it('terminal', 'EC-Gerät', terminal.enabled && terminal.host ? 'check' : 'optional', terminal.enabled && terminal.host ? `eingetragen: ${terminal.host} – mit echtem Gerät noch nicht erprobt; zuerst mit kleinem Betrag testen` : 'Nicht eingerichtet. Kartenzahlungen werden solange von Hand als Zahlung erfasst.', '/einstellungen?ansicht=ecgeraet'),
      it('tse', 'TSE', tse.enabled ? 'check' : 'optional', tse.enabled ? 'eingetragen – bitte „TSE-Daten lesen“ und „Selbsttest“. Zahlungen im Programm werden nicht mit der TSE signiert; ob das nötig ist, klärt die Steuerberatung.' : 'Nicht eingerichtet. Zahlungen im Programm werden nicht mit einer TSE signiert; ob das für Sie nötig ist, klärt die Steuerberatung.', '/einstellungen?ansicht=tse'),
      it('fritz', 'FRITZ!Box', fritz.enabled && fritz.hasPassword ? 'check' : 'optional', fritz.enabled && fritz.hasPassword ? `eingetragen: ${fritz.host} – bitte einmal „Zustand abfragen“` : 'Nicht eingerichtet.', '/internet'),
      it('public', 'Erreichbarkeit aus dem Internet', policy.publicUrl ? 'check' : 'optional', policy.publicUrl ? `Adresse ${policy.publicUrl} – bitte von außerhalb (z. B. Handy ohne WLAN) aufrufen` : 'Nicht eingerichtet. Gäste-Link, Online-Meldeschein und Online-Anfrage funktionieren solange nur im Hausnetz.', '/einstellungen?ansicht=algorithmen'),
    ] },
  ];
  const open = groups[0]!.items.filter((i) => i.state === 'todo').length;
  return { groups, ready: open === 0, open };
}
