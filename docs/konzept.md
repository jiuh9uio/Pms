# PMS Hotel & Restaurant Schützenhaus – Konzept

Stand: 12.11.2026 · Status: **Entwurf zur Abstimmung, noch keine Implementierung**

Inhalt: 1 Ausgangslage · 2 Architektur · 3 Datenmodell · 4 Rollen · 5 MVP-Umfang · 6 Entwicklungsplan · 7 Recht · 8 Offene Fragen

---

## 1. Ausgangslage und Bewertung

Im Repository liegt ein lauffähiger Prototyp (Node.js, SQLite, reines JavaScript). Er deckt Belegungsplan,
Reservierungen, Preisregeln, Kundenkartei und die GMX-Anbindung ab, erfüllt den neuen Auftrag aber in
tragenden Punkten nicht:

| Anforderung | Prototyp | Folge |
|---|---|---|
| Rollen, mehrere Benutzer, Audit-Log | ein gemeinsames Passwort, kein Protokoll | Neubau |
| Doppelbuchungsschutz bei gleichzeitigem Buchen | Prüfung im Anwendungscode | muss in die Datenbank |
| Mehrere Zimmer je Buchung, Gruppen, Firmen | eine Buchung = ein Zimmer, keine Firmen | anderes Datenmodell |
| Unveränderliche Rechnungen, Storno, getrennte Rechnungsadresse | Rechnung ist eine Ansicht der Buchung | Neubau |
| Teilzahlungen an verschiedene Zahler, offene Posten | Zahlungen nur je Buchung | Neubau |
| TypeScript, React, PostgreSQL, Docker | nicht vorhanden | Neubau |

**Empfehlung:** Neubau auf dem gewünschten Stack. Übernommen (nach TypeScript portiert) werden die bereits
getestete Fachlogik: Preisberechnung, Zimmerzuweisung, Anfrage-Erkennung, GMX-Versand/-Abruf, E-Mail-Vorlagen.
Der Prototyp bleibt bis zur Ablösung im Repository.

---

## 2. Architektur

### 2.1 Technologieauswahl

| Baustein | Wahl | Begründung |
|---|---|---|
| Sprache | TypeScript (strict) | Typen von der Datenbank bis zur Oberfläche, weniger Laufzeitfehler |
| Anwendung | Next.js (App Router) + React | ein Projekt für Oberfläche und Server, serverseitiges Rendern für schnelle Seiten, großer Fachkräftemarkt |
| Datenbank | PostgreSQL 16 | Ausschluss-Constraints auf Zeiträumen (Doppelbuchungsschutz), Transaktionen, Trigger für Unveränderlichkeit |
| ORM | Prisma | lesbares Schema, versionierte Migrationen; Constraints und Trigger als handgeschriebene SQL-Migrationen |
| Validierung | Zod | dieselben Schemas für Formular und Server; der Server validiert immer |
| Anmeldung | eigene Sitzungen in der Datenbank, Argon2id, HttpOnly/Secure/SameSite-Cookies | keine Abhängigkeit von Drittanbietern, Sitzungen serverseitig widerrufbar; optional TOTP als zweiter Faktor |
| Schnittstelle | REST unter `/api/v1` (JSON) | von der Oberfläche und später von Website-Buchung, Channel-Manager, Kasse nutzbar |
| Oberfläche | Tailwind CSS + Radix-Komponenten, dnd-kit für Drag-and-drop | zugängliche Bausteine, heller und dunkler Modus über Design-Tokens |
| PDF | serverseitig aus React-Vorlage (`@react-pdf/renderer`) | kein Browser auf dem Server nötig; PDF wird einmal erzeugt und archiviert |
| E-Mail | SMTP/IMAP (GMX) über eine Warteschlange in der Datenbank | Versand überlebt Neustarts, Fehlversuche sind sichtbar |
| Hintergrundjobs | `pg-boss` (Jobs in PostgreSQL) | kein zusätzlicher Dienst (kein Redis) |
| Tests | Vitest (Fachlogik, API gegen echte Test-Datenbank), Playwright (Abläufe im Browser) | kritische Prozesse automatisiert prüfbar |
| Betrieb | Docker Compose: `app`, `db`, `proxy` (Caddy, automatisches TLS), `backup` | ein Server genügt; geringe laufende Kosten |

Bewusst **nicht** gewählt: getrennte Frontend-/Backend-Projekte und Microservices – für 10–30 Zimmer
unnötiger Betriebsaufwand. Die Modularität entsteht im Code, nicht durch getrennte Dienste.

### 2.2 Aufbau (modularer Monolith)

```
src/
  app/                 Seiten und API-Routen (dünn: Anmeldung prüfen, validieren, Modul aufrufen)
  modules/
    auth/              Benutzer, Sitzungen, Rollen, Rechteprüfung
    rooms/             Kategorien, Zimmer, Sperren, Housekeeping-Status
    availability/      Belegung, Zuweisung, Doppelbuchungsschutz
    reservations/      Buchungen, Zimmerpositionen, Check-in/-out, Historie
    pricing/           Preisregeln, Firmenkonditionen, Preisberechnung
    guests/            Gäste, Firmen, Ansprechpartner
    billing/           Leistungen, Rechnungen, Storno, Zahlungen, offene Posten, Export
    mail/              Vorlagen, Warteschlange, GMX-Abruf
    audit/             Änderungsprotokoll
    reporting/         Dashboard-Kennzahlen, Auswertungen
  integrations/        spätere Adapter: Channel-Manager, Website-Buchung, Kasse, DATEV, Zahlungsanbieter
```

Regeln: Module sprechen nur über ihre öffentlichen Funktionen miteinander; jede schreibende Funktion
prüft Rechte, validiert, läuft in einer Transaktion und schreibt einen Audit-Eintrag. Erweiterungen aus
Abschnitt 13 des Auftrags docken über `integrations/` und interne Ereignisse an (z. B. `reservation.confirmed`).

### 2.3 Geschäftskritische Zusicherungen – technisch in der Datenbank

1. **Keine Doppelbuchung:** Tabelle `room_allocations` mit
   `EXCLUDE USING gist (room_id WITH =, period WITH &&) WHERE (active)`. Buchungen und Sperren belegen
   beide über diese Tabelle. Zwei gleichzeitige Buchungen desselben Zimmers: Die Datenbank lässt genau eine
   zu, die andere erhält eine verständliche Fehlermeldung. Wird mit parallelen Tests nachgewiesen.
2. **Lückenlose Rechnungsnummern:** Zähler je Nummernkreis, in derselben Transaktion wie die Ausstellung
   gesperrt und erhöht (keine Lücken durch abgebrochene Vorgänge).
3. **Unveränderliche Rechnungen:** Trigger verbieten UPDATE/DELETE auf ausgestellten Rechnungen und ihren
   Positionen. Korrektur nur durch Stornobeleg (eigene Nummer, verweist auf das Original) und ggf. neue Rechnung.
   Das PDF wird bei Ausstellung erzeugt, gespeichert und mit SHA-256-Prüfsumme versehen.
4. **Preis bleibt nachvollziehbar:** Preis je Nacht wird bei der Buchung als Kopie gespeichert (inkl. Herkunft:
   Standard, Saison, Firmenkondition, manuell). Spätere Preisänderungen wirken nur auf neue Buchungen.
5. **Audit-Log nur anfügbar:** kein UPDATE/DELETE für die Anwendungsrolle.
6. **Gleichzeitige Bearbeitung:** Versionsspalte je Datensatz; wer auf veraltetem Stand speichert, wird gewarnt
   statt fremde Änderungen zu überschreiben.

### 2.4 Betrieb, Sicherung, Wiederherstellung

- Ein kleiner Server in einem deutschen Rechenzentrum (Größenordnung 5–15 €/Monat) oder ein Rechner im Haus
  – siehe Frage 2. Zugriff ausschließlich über HTTPS.
- Tägliche verschlüsselte Datenbanksicherung (`pg_dump`) plus Rechnungs-PDFs an einen zweiten Ort,
  Aufbewahrung gestaffelt (täglich/wöchentlich/monatlich).
- Wiederherstellung als dokumentiertes Skript; in Phase 4 wird eine Sicherung tatsächlich in eine leere
  Umgebung zurückgespielt und geprüft.
- Statusseite/Health-Check und E-Mail-Benachrichtigung bei fehlgeschlagener Sicherung.

---

## 3. Datenmodell

Alle Tabellen: `id` (UUID), `created_at`, `updated_at`, `version`. Geldbeträge als ganze Cent, Zeiträume als
`daterange` (Anreise inklusive, Abreise exklusive).

### Benutzer und Protokoll
| Tabelle | Wesentliche Felder |
|---|---|
| `users` | name, email (eindeutig), password_hash, role (`admin`/`user`), active, totp_secret?, last_login_at |
| `sessions` | user_id, token_hash, expires_at, ip, user_agent |
| `audit_log` | at, user_id, action, entity, entity_id, before (JSON), after (JSON), ip |

### Zimmer
| Tabelle | Wesentliche Felder |
|---|---|
| `room_categories` | name, beschreibung, standard_belegung, max_personen, farbe, sortierung |
| `rooms` | nummer (eindeutig), category_id, etage, housekeeping_status, aktiv, notiz |
| `room_allocations` | room_id, period, active, kind (`stay`/`block`) — **Ausschluss-Constraint** |
| `room_blocks` | allocation_id, grund, erstellt_von |

### Gäste und Firmen
| Tabelle | Wesentliche Felder |
|---|---|
| `guests` | anrede, vorname, nachname, email, telefon, anschrift, geburtsdatum?, nationalität?, company_id?, notiz, zusatzfelder (JSON), gesperrt, anonymisiert_am |
| `companies` | name, rechnungsanschrift, ust_id, email_rechnung, zahlungsziel_tage, notiz, aktiv |
| `company_contacts` | company_id, name, funktion, email, telefon |
| `company_rates` | company_id, category_id, preis_cent, inkl_frühstück, gültig_von, gültig_bis |
| `registration_records` | booking_room_id, guest_id, ausweisdaten, unterschrift?, löschen_ab (Meldedaten, getrennt mit eigener Löschfrist) |

### Preise
| Tabelle | Wesentliche Felder |
|---|---|
| `tax_rates` | bezeichnung, satz, gültig_von, gültig_bis |
| `base_rates` | category_id, preis_cent, gültig_von |
| `rate_rules` | name, zeitraum, wochentage, category_id?, art (Prozent/Betrag/Festpreis), wert, mindestaufenthalt, priorität, aktiv |
| `services` | name, preis_cent, berechnung (pro Aufenthalt/Nacht/Person/Person+Nacht), tax_rate_id, ist_frühstück, aktiv |

### Reservierungen
| Tabelle | Wesentliche Felder |
|---|---|
| `bookings` | nummer (eindeutig), art (einzel/gruppe/firma), hauptgast_id, company_id?, quelle, status, gruppenname?, zahlungsart_geplant, interne_bemerkung |
| `booking_rooms` | booking_id, allocation_id, category_id, status (vorläufig/bestätigt/eingecheckt/ausgecheckt/storniert/no-show), erwachsene, kinder, checked_in_at, checked_out_at |
| `booking_room_guests` | booking_room_id, guest_id (weitere Gäste im Zimmer) |
| `booking_room_nights` | booking_room_id, datum, preis_cent, tax_rate_id, herkunft (Preis-Kopie je Nacht) |
| `charges` | booking_id, booking_room_id?, service_id?, bezeichnung, menge, einzelpreis_cent, tax_rate_id, datum, invoice_line_id? (Zusatzleistungen; abgerechnet, sobald verknüpft) |
| `booking_events` | booking_id, at, user_id, typ, details (fachliche Historie: erstellt, geändert, verschoben, storniert …) |

Buchungsstatus ergibt sich aus den Zimmerpositionen; Gruppen- und Mehrzimmerbuchungen sind derselbe
Mechanismus (eine Buchung, n Zimmerpositionen).

### Abrechnung
| Tabelle | Wesentliche Felder |
|---|---|
| `number_sequences` | kreis (Rechnung/Storno/Buchung), jahr, letzter_wert |
| `invoices` | nummer, art (Rechnung/Stornobeleg), status (Entwurf/ausgestellt/storniert), booking_id, empfänger_typ, **Empfänger-Kopie** (Name, Anschrift, USt-ID), leistungszeitraum, ausgestellt_am, fällig_am, storno_von_id?, summen je Steuersatz, pdf_pfad, pdf_sha256 |
| `invoice_lines` | invoice_id, bezeichnung, menge, einzelpreis_cent, tax_rate, netto, steuer, brutto, leistungsdatum |
| `payments` | booking_id, invoice_id?, betrag_cent (negativ = Erstattung), zahlungsart, zahler_typ/-id, datum, art (Anzahlung/Zahlung/Erstattung), referenz, erfasst_von |
| `accounting_exports` | zeitraum, format, erstellt_von, datei, prüfsumme |

Mehrere Rechnungen je Buchung sind möglich (z. B. Firma zahlt Übernachtung, Gast die Extras). Offene Posten =
ausgestellte Rechnungen abzüglich zugeordneter Zahlungen.

### Kommunikation und System
| Tabelle | Wesentliche Felder |
|---|---|
| `email_templates`, `emails` | Vorlagen; Ein-/Ausgang mit Status, Zuordnung zu Gast/Buchung/Rechnung |
| `tasks` | Tagesaufgaben (automatisch erzeugt oder manuell), fällig_am, erledigt_von |
| `settings` | Stammdaten des Hotels, Nummernformate, Fristen |

---

## 4. Rollen und Rechte

Entscheidung vom 12.11.2026: Es gibt nur zwei Rollen. Rezeption und Buchhaltung sind zu **Benutzer** verschmolzen.

| Bereich | Administrator | Benutzer |
|---|---|---|
| Dashboard, Belegungsplan | ✓ | ✓ |
| Reservierungen, Check-in/-out, Gäste | ✓ | ✓ |
| Zimmer sperren, Housekeeping-Status | ✓ | ✓ |
| Rechnung ausstellen, Zahlung erfassen, Rechnung per E-Mail senden | ✓ | ✓ |
| Rechnung stornieren, Erstattung | ✓ | ✓ |
| Offene Posten, Buchhaltungsexport, Finanzberichte | ✓ | ✓ |
| Firmen und Firmenkonditionen | ✓ | ✓ |
| Zimmer, Kategorien, Preise, Vorlagen, Einstellungen | ✓ | – |
| Benutzer, Audit-Log, Datensicherung | ✓ | – |

Der Benutzer darf also den gesamten Tagesbetrieb einschließlich Abrechnung; dem Administrator vorbehalten
sind Stammdaten, Preise, Einstellungen, Benutzerverwaltung, Audit-Log und Datensicherung.
Rechte werden ausschließlich serverseitig geprüft; die Oberfläche blendet nur aus.

---

## 5. MVP-Funktionsumfang

**Im MVP (Phasen 1–4):**
- Anmeldung, Benutzer- und Rollenverwaltung, Audit-Log
- Dashboard mit allen Kennzahlen aus Abschnitt 2 des Auftrags und Tagesaufgaben, automatische Aktualisierung
- Belegungsplan: Tag/Woche/Monat, Drag-and-drop (verschieben, verlängern/verkürzen), Klick auf freien Zeitraum,
  Sperren, Farben gemäß Vorgabe (Grün/Gelb/Blau/Grau/Rot)
- Reservierungen mit allen genannten Feldern, mehrere Zimmer je Buchung, Gruppen und Firmen, Storno, Historie
- Geführter Check-in (inkl. Meldedaten, soweit erforderlich) und Check-out (Leistungen prüfen → Rechnung → Zahlung → Zimmer frei)
- Gäste- und Firmenverwaltung, „erneut buchen“ aus dem Profil
- Preise: Standard, Wochenende, Saison, Firmenkonditionen, Sonder-/Gruppenpreis je Buchung, Frühstück, Zusatzleistungen
- Rechnungen: Nummernkreis, PDF, Firmen-/Privatrechnung, abweichende Rechnungsadresse, mehrere Steuersätze,
  geteilte Rechnungen, Versand per E-Mail, Zahlungen (Anzahlung/Teilzahlung/verschiedene Zahler), offene Posten,
  Stornobelege, CSV-Export für die Buchhaltung
- E-Mail über GMX: Bestätigung, Rechnung, Vorlagen
- Responsive Oberfläche, Dark Mode, Docker-Betrieb, Sicherung und geprüfte Wiederherstellung, Dokumentation

**Vorbereitet, aber nicht im MVP** (wird in der Anwendung ausdrücklich als „nicht enthalten“ gekennzeichnet):
Booking.com/Channel-Manager, Onlinebuchung, digitaler Check-in, Kassenschnittstelle Restaurant,
DATEV-Format (über CSV hinaus), E-Rechnung (ZUGFeRD/XRechnung, siehe Frage 5), automatische Zahlungsabwicklung,
Housekeeping-Planung, erweiterte Umsatzanalysen, automatische Preise nach Auslastung, Anfrage-Erkennung aus E-Mails.

---

## 6. Entwicklungsplan

| Phase | Inhalt | Abnahmekriterium |
|---|---|---|
| 1 Fundament | Projekt, Docker, Datenbankschema + Migrationen, Anmeldung, Rollen, Audit-Log, Grundlayout (hell/dunkel, mobil) | Anmelden, Benutzer anlegen, Rechte greifen serverseitig; Tests laufen automatisch |
| 2 Hotelbetrieb | Zimmer, Kategorien, Sperren, Preise, Belegungsplan mit Drag-and-drop, Reservierungen (inkl. Mehrzimmer), Check-in/-out, Gäste, Dashboard | Paralleltest: zwei gleichzeitige Buchungen → genau eine gelingt; Buchung anlegen in ≤ 3 Klicks ab Plan |
| 3 Abrechnung | Leistungen, Rechnungen, PDF, Storno, Zahlungen, offene Posten, Firmen, E-Mail-Versand, Export | ausgestellte Rechnung lässt sich nachweislich nicht ändern; Summen je Steuersatz in Tests geprüft |
| 4 Qualität | Browser-Tests der Hauptabläufe, Sicherheitsprüfung (Rechte, Eingaben, Sitzungen), Sicherung zurückspielen, Bedienung auf Tablet/Smartphone, Betriebs- und Anwenderdokumentation | alle Prüfungen dokumentiert, offene Punkte benannt |

Jede Phase endet mit lauffähigem, getestetem Stand im Repository; nicht fertige Funktionen sind nicht
als Schaltflächen sichtbar.

---

## 7. Rechtliche Punkte – technisch berücksichtigt, **nicht** rechtlich geprüft

Ich kann technische Voraussetzungen schaffen, aber keine Konformität bescheinigen. Die folgenden Punkte
sollten mit Steuerberatung bzw. Datenschutzberatung abgestimmt werden; Angaben nach meinem Kenntnisstand.

- **Rechnungsangaben (§ 14 UStG):** Pflichtangaben werden als Pflichtfelder und in der PDF-Vorlage abgebildet;
  die Vorlage sollte die Steuerberatung einmal freigeben.
- **GoBD / Aufbewahrung:** Unveränderlichkeit, Protokollierung und Archivierung der PDFs sind vorgesehen. Eine
  Verfahrensdokumentation und die Festlegung der Aufbewahrungsfristen liegen beim Betrieb.
- **E-Rechnung:** Für Rechnungen an Unternehmen gelten seit 2025 stufenweise Pflichten zur elektronischen
  Rechnung mit Übergangsfristen; ob und ab wann das Schützenhaus betroffen ist, bitte klären (Frage 5).
- **Kassenführung / TSE (§ 146a AO):** Werden Barzahlungen im PMS als Kasse erfasst, kann eine zertifizierte
  technische Sicherheitseinrichtung erforderlich sein. Im MVP ist **keine TSE** enthalten (Frage 4).
- **Meldepflicht:** Seit 2025 gilt die Hotelmeldepflicht nach meinem Stand nur noch für ausländische Gäste;
  Meldedaten werden getrennt gespeichert und nach Frist gelöscht (Frage 8).
- **DSGVO:** Rollen, Protokoll, Auskunft/Export je Gast, Anonymisierung nach Ablauf der Fristen sind vorgesehen.
  Auftragsverarbeitungsvertrag mit dem Hoster, Verzeichnis der Verarbeitungstätigkeiten und Löschkonzept sind
  organisatorische Aufgaben des Betriebs.
- **Übernachtungs-/Kurabgabe:** nur relevant, falls die Gemeinde eine erhebt (Frage 3).

---

## 8. Offene Fragen

**Vor Phase 1 nötig**

1. **Neubau:** Einverstanden, das PMS auf dem neuen Stack neu aufzubauen und aus dem Prototyp nur die Fachlogik zu übernehmen?
2. **Betrieb:** Gemieteter Server in Deutschland (Zugriff von überall, Empfehlung) oder Rechner im Haus (keine Mietkosten, aber eigene Verantwortung für Strom, Netz, Hardware)? Gibt es eine Domain?
3. **Steuern und Preise:** Regelbesteuerung mit 7 % auf Übernachtung und 19 % auf Frühstück/Zusatzleistungen? Preise als Bruttopreise? Erhebt die Gemeinde eine Kur- oder Übernachtungsabgabe?
4. **Bargeld/Kasse:** Soll das PMS Zahlungen nur dokumentieren (kassiert wird über die vorhandene Restaurantkasse/das Kartenterminal), oder soll es selbst Kasse sein? Davon hängt die TSE-Frage ab.
5. **Firmenrechnungen:** Wird die E-Rechnung (ZUGFeRD) bereits zum Start benötigt, oder genügt zunächst PDF?

**Vor Phase 2/3 nötig**

6. **Zimmer:** Nummern, Kategorien und Preise der 10 Zimmer; Frühstückspreis; übliche Zusatzleistungen.
7. **Rechnungsnummern:** Gewünschtes Format, Fortsetzung eines bestehenden Nummernkreises, Startwert?
8. **Meldeschein:** Bisheriges Verfahren (Papier/digital)? Sollen Meldedaten im PMS erfasst werden?
9. **Buchhaltung:** Welches Exportformat erwartet die Steuerberatung (DATEV, Kontenrahmen, Erlöskonten)?
10. **Benutzer:** Wie viele Personen, geteilte Geräte an der Rezeption? Zwei-Faktor-Anmeldung gewünscht? (Rollen sind entschieden: Administrator und Benutzer.)
11. **Stornobedingungen und Anzahlungen:** Feste Regeln (Fristen, Gebühren, Anzahlung in %)?
12. **E-Mail:** Bleibt GMX der Versandweg, mit welcher Adresse? Sollen eingehende E-Mails weiterhin im PMS erscheinen?
13. **Altdaten:** Gibt es Gäste-, Firmen- oder Buchungsdaten, die übernommen werden sollen (Quelle, Format)?
14. **Restaurant:** Sollen Restaurantumsätze aufs Zimmer gebucht werden können (manuell als Leistung), oder bleibt das getrennt?
15. **Erscheinungsbild:** Logo, Hausfarben, Briefkopf und Bankverbindung für die Rechnung.
