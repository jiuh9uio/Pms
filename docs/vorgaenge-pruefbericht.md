# Prüfbericht E-Mail-Vorgänge (Version 1.123.0)

Geprüft wurde der tatsächliche Code: `src/server/modules/inbox.ts` (Abruf, Antworten), `mailcases.ts` (Vorgänge),
`offerthread.ts` / `invoicethread.ts` (Verläufe von Angeboten und Kostenvoranschlägen), `mail.ts` (Versand),
die Tabellen `inbox_mails`, `mail_cases`, `mail_case_out`, `offer_events`, `invoice_events` und die Oberfläche `web/src/pages/Inbox.tsx`.

Keine rechtliche Prüfung: Aussagen zum Datenschutz sind technische Feststellungen, keine Bestätigung einer DSGVO-Konformität.

## Bestätigte Fehler (behoben)

| Nr. | Stelle | Ursache | Auswirkung | Schwere | Korrektur |
|---|---|---|---|---|---|
| F1 | `mailcases.linkInboxMailToCase`, `offerthread.linkInboxMail`, `invoicethread.linkInboxMailToInvoice` | Zuordnung allein über die Nummer in Betreff **oder Text**, ohne Prüfung des Absenders | Jeder, der eine Nummer kennt oder zitiert (Weiterleitung, Zitat), landete im fremden Vorgang | hoch | Nummer zählt nur im Betreff und nur von einem Absender, der schon zum Vorgang gehört; sonst Vorschlag zur manuellen Prüfung |
| F2 | `inbox.fetchInbox` | Technische Verweise (In-Reply-To, References) wurden nicht ausgewertet; ausgehende E-Mails hatten keine eigene, wiedererkennbare Message-ID | Antwort mit geändertem Betreff wurde nicht zugeordnet | hoch | Eigene Message-ID `<pms.NUMMER.zufall@domain>`; eingehende Verweise werden zuerst ausgewertet |
| F3 | `inbox.fetchInbox` (Schleife) | Ein Fehler bei einer einzelnen Nachricht brach den ganzen Abruf ab; der Stand wurde nicht fortgeschrieben | Eine defekte E-Mail blockierte dauerhaft alle folgenden | hoch | Jede Nachricht einzeln abgesichert; defekte Nachricht wird als Hinweis gespeichert, der Abruf läuft weiter |
| F4 | `inbox.fetchInbox` | Eindeutigkeit nur über (UIDVALIDITY, UID) | Setzt das Postfach seine Nummerierung zurück, wurden die E-Mails der letzten 30 Tage doppelt angelegt | mittel | Zusätzlicher Abgleich über die Message-ID |
| F5 | `inbox.fetchInbox` | Drei Zuordnungen nacheinander ohne Ausschluss | Eine E-Mail konnte gleichzeitig Vorgang, Angebot und Kostenvoranschlag zugeordnet werden | mittel | Feste Rangfolge, erster Treffer gilt (`routeInbound`) |
| F6 | `inbox.fetchInbox` | Nur der Textteil wurde gelesen | HTML-E-Mails mit Anhang ohne Textteil wurden leer gespeichert | mittel | Text wird notfalls aus dem HTML gewonnen (ohne Skripte, Stile, Tags) |
| F7 | `inbox.fetchInbox` | Anhänge wurden verworfen, ohne Hinweis | Nicht erkennbar, dass z. B. ein ausgefüllter Katalog dabei war | mittel | Namen und Größe der Anhänge werden gespeichert und angezeigt (Dateien selbst weiterhin nicht) |
| F8 | `inbox.fetchInbox` | Datum laut Absender ungeprüft übernommen | Falsch gestellte Uhr (Zukunft) verfälschte Reihenfolge und „wer ist dran“ | niedrig | Zukunftsdatum → Eingangszeit des Servers |
| F9 | `mailcases.listCases` | Je Vorgang drei Abfragen, alle Verlaufstexte geladen | Langsam bei vielen Vorgängen | mittel | Eine Abfrage je Quelle, Texte gekürzt |
| F10 | `mailcases.listCases` / Route `/mail-cases` | Keine Prüfung der Freigabe für Angebote | Benutzer nur mit „E-Mail“ sahen Kunden und Textanfänge von Angeboten | mittel | Angebots-Verläufe nur mit Freigabe Hotel oder Restaurant |
| F11 | `inbox.sendReply` | Fehler beim Vermerken nach dem Versand sah aus wie ein Versandfehler | Gefahr des doppelten Sendens | niedrig | Eigene Meldung „gesendet, bitte nicht erneut senden“ |

## Geprüft, kein Fehler gefunden

- **Doppelte Vorgänge / Nummern:** Nummer über `number_sequences` (atomar) plus Eindeutigkeit in der Datenbank; gleichzeitige Anfragen ergeben einen Vorgang (Test 5). „Daten löschen“ setzt den Zähler der Vorgänge nicht zurück.
- **Gleichzeitiger Abruf:** per Sperre im Programm ausgeschlossen (ein Prozess).
- **XSS:** E-Mail-Inhalte werden nur als Text gespeichert und als Text angezeigt; kein HTML wird in die Seite eingesetzt.
- **SQL-Injection:** alle Abfragen parametrisiert (Test mit SQL-Zeichen im Suchfeld).
- **Zugangsdaten:** IMAP-/SMTP-Passwort verschlüsselt gespeichert (AES-256-GCM), nicht im Protokoll.
- **Zugriff:** alle Vorgangs-Schnittstellen nur mit Modul „E-Mail“.

## Stand 1.124.0 (nach Freigabe umgesetzt)

- **Löschen/Aufbewahrung:** Erledigte und archivierte Vorgänge werden nach der Aufbewahrungsfrist mit entfernt; „Daten löschen → Posteingang“ entfernt auch die Vorgänge. Der Nummernzähler bleibt.
- **Anhänge** werden gespeichert (Tabelle `inbox_attachments`, je Datei bis 10 MB, höchstens 10 je E-Mail) und nur als Download ausgeliefert (`application/octet-stream`, `nosniff`).
- Ein ausgefüllter Katalog lässt sich direkt aus dem Verlauf des Angebots einlesen; über ein Angebot sind nur Anhänge aus dessen eigenem Verlauf erreichbar.

## Stand 1.125.0

- **E-Mails aus dem Hotelbereich** (Bestätigung, Absage, Storno, Rückfrage, Gäste-Link) werden einem Vorgang zur Reservierung zugeordnet (Feld `booking_id`); schlägt der Versand fehl, bleibt kein leerer Vorgang zurück.
- **Zuständigkeit je Mitarbeiter** (Feld `assignee`) mit Filter in der Liste.
- **Hinweis „Als Nächstes“** je Kategorie einstellbar (Einstellung `case_next_texts`).

## Weiterhin offen

- **Geringes Restrisiko:** Wer Angebote bearbeiten darf, kann über die Vorschläge im Angebot E-Mails derselben Absenderadresse sehen, auch ohne Modul „E-Mail“.
- **Anhänge** werden nicht auf Schadsoftware geprüft; die Datensicherung wird durch gespeicherte Anhänge größer.
- **Nicht getestet:** echter IMAP-/SMTP-Betrieb (kein Postfach in der Testumgebung), Verhalten realer E-Mail-Programme bei den Verweisen, sehr große Postfächer (keine Lastmessung).
