# Schützenhaus PMS

Property-Management-System für das Hotel & Restaurant Schützenhaus.
Konzept, Datenmodell und offene Fragen: [`docs/konzept.md`](docs/konzept.md).

## Stand

| Phase | Inhalt | Status |
|---|---|---|
| 1 Fundament | Anmeldung, Benutzer und Rollen, Änderungsprotokoll, Stammdaten, Steuersätze, Grundlayout (hell/dunkel, mobil), Datensicherung | **fertig** |
| 2 Hotelbetrieb | Zimmer, Kategorien, Preisregeln, Leistungen, Belegungsplan (Tag/Woche/Monat, Drag-and-drop, Sperren), Reservierungen (auch mehrere Zimmer), Check-in/-out, Gäste, Übersicht mit Kennzahlen und Aufgaben | **fertig** |
| Kontrollen | Startmenü mit Bereichen; Kontrollarten (Hygieneamt, Finanzamt, eigene), Unterlagenlisten, Kontrollbesuche, Temperaturprotokoll je Bereich und Messstelle mit Monatsausdruck | **fertig** |
| 3 Abrechnung | Rechnungen, PDF, Zahlungen (bar/Karte), Firmen, E-Mail | offen |
| 4 Qualität | Browser-Tests, Sicherheitsprüfung, Bedienung mobil, Anwenderdokumentation | offen |

**Noch nicht enthalten** (in der Anwendung nicht als Schaltfläche vorhanden):

- Rechnungen, PDF, Zahlungserfassung (bar/Karte), offene Posten, Buchhaltungsexport – Phase 3
- Firmenprofile mit vereinbarten Preisen und Zahlungsbedingungen – Phase 3 (bis dahin: Firmenname am Gast, Sonderpreis je Buchung)
- E-Mail-Versand (GMX) im Neubau – Phase 3; der Prototyp unter `prototype/` kann es weiterhin
- Aufpreise für Zusatzpersonen und Kinderpreise (derzeit über Sonderpreis je Nacht)
- Meldeschein-Druck, Löschen/Anonymisieren von Gästen nach Fristen, Housekeeping
- TSE/Kassenfunktion, E-Rechnung, Channel-Manager, Onlinebuchung

Der frühere Prototyp liegt unverändert unter `prototype/` und wird mit Phase 3 abgelöst.

### Kontrollen und Temperaturprotokoll

- Nach der Anmeldung erscheint ein **Startmenü** mit den Bereichen, die das Konto öffnen darf.
- **Freigaben je Benutzer:** In der Verwaltung legt der Administrator je Benutzer fest, welche Bereiche (Hotel, Kontrollen) er sieht.
  Der Server prüft die Freigabe bei jeder Anfrage; eine Änderung wirkt sofort. Verwaltung und „Mein Konto“ sind dem Administrator
  vorbehalten – Benutzer können sich abmelden, ein neues Passwort vergibt der Administrator. Weitere Bereiche (z. B. Kasse) gibt es noch nicht.
- Unter **Kontrollen** gibt es je Kontrollart (Hygieneamt, Finanzamt; weitere legt der Administrator an) eine Liste der
  bereitzuhaltenden Unterlagen zum Abhaken und ein Verzeichnis der stattgefundenen Kontrollen.
  Die mitgelieferten Unterlagenlisten sind Vorschläge, keine vollständige oder rechtlich geprüfte Aufstellung.
- Beim **Hygieneamt** steht oben das Temperaturprotokoll: Bereiche (z. B. Küche) als Reiter, darunter eine Tabelle der Messstellen
  (z. B. Kühltruhe) mit Sollbereich, den Werten der letzten Tage und der Eingabe für den gewählten Tag. „Monatsprotokoll“ zeigt den Monat zum Ausdrucken.
- **Kurzabfrage:** Beim Öffnen von „Kontrollen“ fragt das Programm je Bereich, in dem heute noch etwas fehlt: „Küche: alles im Sollwert?“
  Ein Tipp auf „Ja“ speichert für die offenen Messstellen eine Bestätigung mit Namen und Uhrzeit (im Protokoll als ✓, ohne Zahlenwert);
  „Nein“ führt zur Tabelle, um Werte und Maßnahme einzutragen. Die Bestätigung gibt es nur für den heutigen Tag, nicht im Nachhinein.
  Ob eine Bestätigung ohne Zahlenwert als Nachweis genügt, bitte mit dem Hygieneamt bzw. im eigenen HACCP-Konzept klären.
- Zahlenwerte werden **von Hand eingetragen**. Eine Funktion, die Werte erfindet, gibt es bewusst nicht. Liegt ein Wert außerhalb
  des Sollbereichs, ist die ergriffene Maßnahme einzutragen.
- Jeder Wert wird mit Namen und Zeitpunkt der Erfassung gespeichert; nachträglich eingetragene Werte sind gekennzeichnet,
  Korrekturen stehen mit altem und neuem Wert im Änderungsprotokoll. Ein Datum in der Zukunft ist nicht möglich.
- Nicht enthalten: automatische Übernahme aus Funk-Thermometern/Datenloggern, Reinigungspläne zum Abzeichnen, Wareneingangskontrolle.

### So ist der Hotelbetrieb umgesetzt

- **Selbst einrichten:** Unter „Zimmer & Preise“ legt der Administrator Kategorien (Art des Zimmers, Preis je Nacht) an und erzeugt mit
  „Mehrere anlegen“ beliebig viele Zimmer je Kategorie auf einmal; einzelne Zimmer können einen eigenen Preis bekommen oder deaktiviert werden.
- **Doppelbuchungen** verhindert die Datenbank selbst (Ausschluss-Constraint), auch bei gleichzeitigem Buchen an zwei Arbeitsplätzen.
  Sperren nutzen denselben Mechanismus.
- **Preise** werden je Nacht bei der Buchung gespeichert. Spätere Preisänderungen wirken nur auf neue Buchungen und auf
  Nächte, die bei einer Verlängerung neu hinzukommen.
- **Vorzeitige Abreise:** Beim Check-out vor dem geplanten Abreisetag endet der Aufenthalt am selben Tag, spätere Nächte entfallen, das Zimmer ist wieder buchbar.
- **Storno / nicht angereist** gibt das Zimmer frei; die Buchung bleibt mit Verlauf erhalten und kann reaktiviert werden, solange das Zimmer frei ist.
- **Umsatz in der Übersicht** = gebuchte Übernachtungspreise (brutto) der bestätigten, laufenden und abgeschlossenen Aufenthalte, ohne Zusatzleistungen.
- Der Belegungsplan aktualisiert sich jede Minute; wer auf veraltetem Stand speichert, erhält einen Hinweis statt fremde Änderungen zu überschreiben.

## Technik

TypeScript durchgehend · Fastify (Server, REST unter `/api/v1`) · React + Vite (Oberfläche) · PostgreSQL 16 ·
Drizzle ORM mit SQL-Migrationen · Zod (gemeinsame Eingabeprüfung) · Vitest.
Ein Node-Prozess liefert API und Oberfläche aus. Gemessen im Leerlauf: ca. 120 MB (Node) + ca. 100 MB (PostgreSQL).

```
src/server/   app.ts, routes-hotel.ts (Routen, Zugriffsschutz)  modules/ (auth, users, settings, audit, rooms, guests, bookings)  db/
src/shared/   Eingabeschemas und Typen für Server und Oberfläche
web/          Oberfläche
migrations/   Datenbankschema; 0001 enthält Doppelbuchungsschutz und Protokollschutz, 0002 den Hotelbetrieb
tests/        Tests gegen eine echte PostgreSQL-Datenbank
scripts/      Datensicherung und Wiederherstellung
```

## Windows-Version zum Doppelklicken (empfohlen)

Für den Hausrechner gibt es ein fertiges Paket: einen Ordner `SchuetzenhausPMS` mit `pms.exe`.
Es bringt die Datenbank mit – weder Node.js noch PostgreSQL müssen installiert werden.

1. Paket herunterladen: auf GitHub unter **Actions → „Windows-Version (pms.exe)“ → neuester erfolgreicher Lauf → Artifacts → SchuetzenhausPMS-Windows**.
2. ZIP vollständig entpacken, z. B. nach `C:\SchuetzenhausPMS` (nicht in einen OneDrive- oder Netzwerkordner).
3. `pms.exe` doppelt anklicken. Beim ersten Start wird die Datenbank eingerichtet, dann öffnet sich der Browser.
4. Administrator-Konto anlegen, danach unter „Zimmer & Preise“ das Haus einrichten.

Sicherung, Autostart, Update und Wiederherstellung sind in der beiliegenden `LIES MICH.txt` beschrieben.
Die exe ist nicht signiert; Windows SmartScreen zeigt deshalb beim ersten Start eine Warnung
(„Weitere Informationen“ → „Trotzdem ausführen“).

Das Paket wird bei jeder Änderung automatisch auf einem Windows-Rechner von GitHub gebaut und dort geprüft:
erster Start, Zimmer und Buchung anlegen, Doppelbuchung wird abgelehnt, Sicherung, Neustart mit erhaltenen Daten,
Wiederherstellung. Selbst bauen: `npm run build:exe` (auf Windows, mit installiertem PostgreSQL und gesetztem `PGROOT`).

## Installation aus dem Quelltext (Alternative)

Die folgenden Schritte sind für Windows 10/11 geschrieben. **Sie sind auf Windows noch nicht praktisch erprobt** –
entwickelt und getestet wurde unter Linux; Anwendung und Skripte verwenden aber nur plattformunabhängige Mittel.

Voraussetzungen:

- [Node.js 22 LTS](https://nodejs.org) (Windows-Installer, Standardeinstellungen)
- [PostgreSQL 16](https://www.postgresql.org/download/windows/) (Installer; das dabei vergebene Passwort für `postgres` notieren)
- Den Ordner `C:\Program Files\PostgreSQL\16\bin` zur Umgebungsvariable `Path` hinzufügen, damit `pg_dump` und
  `pg_restore` für die Datensicherung gefunden werden (Systemsteuerung → System → Erweiterte Systemeinstellungen → Umgebungsvariablen)
- Den Projektordner z. B. nach `C:\pms` legen

1. Datenbank und Datenbankbenutzer anlegen (einmalig, als PostgreSQL-Administrator):
   ```sql
   CREATE ROLE pms LOGIN PASSWORD 'ein-eigenes-passwort';
   CREATE DATABASE pms OWNER pms;
   ```
2. `.env.example` nach `.env` kopieren und `DATABASE_URL` anpassen.
3. Bauen und starten:
   ```bash
   npm ci
   npm run build
   npm start
   ```
4. Im Browser `http://<Rechnername-oder-IP>:3000` öffnen und das Administrator-Konto anlegen.

Das Datenbankschema wird beim Start automatisch eingerichtet und aktualisiert.

Schritt 1 geht am einfachsten in „SQL Shell (psql)“ aus dem Startmenü (Anmeldung als `postgres`).

### Automatisch starten und täglich sichern (Windows)

In einer Eingabeaufforderung **als Administrator** (Pfad `C:\pms` ggf. anpassen):

```bat
rem PMS beim Hochfahren starten
schtasks /Create /TN "PMS Start" /SC ONSTART /RU SYSTEM /TR "C:\pms\scripts\windows\start-pms.bat"
rem Datensicherung jede Nacht um 02:00 Uhr
schtasks /Create /TN "PMS Sicherung" /SC DAILY /ST 02:00 /RU SYSTEM /TR "C:\pms\scripts\windows\backup-pms.bat"
rem Zugriff aus dem Hausnetz erlauben (nur privates Netzwerkprofil)
netsh advfirewall firewall add rule name="PMS" dir=in action=allow protocol=TCP localport=3000 profile=private
```

- Ausgaben stehen in `logs\pms.log` und `logs\backup.log`.
- Der Rechner muss laufen, damit das PMS erreichbar ist: Energiesparmodus/Ruhezustand abschalten und Windows-Updates
  mit Neustart auf die Nacht legen. Läuft der Rechner um 02:00 Uhr nicht, eine andere Uhrzeit für die Sicherung wählen.
- Andere Geräte erreichen das PMS unter `http://<Name-des-Rechners>:3000` (Name: Einstellungen → System → Info).
- Nach einem Update des PMS: `npm ci`, `npm run build`, dann den Rechner oder die Aufgabe „PMS Start“ neu starten.

Unter Linux/macOS stattdessen `npm start` als systemd-Dienst und `npm run backup` per cron einrichten.

**Alternative mit Docker** (`docker compose up -d --build`, vorher `POSTGRES_PASSWORD` in `.env` setzen):
Die Docker-Dateien liegen bei, sind aber **noch nicht getestet**. Auf Windows braucht Docker Desktop
deutlich mehr Arbeitsspeicher als die direkte Installation; für einen Hausrechner ist die direkte Installation sparsamer.

### Zugriff und Verschlüsselung

- Mit `HOST=0.0.0.0` ist das PMS von allen Geräten im Hausnetz erreichbar, **unverschlüsselt (HTTP)**.
  Das ist nur in einem vertrauenswürdigen, kabelgebundenen oder gut gesicherten WLAN vertretbar.
- Für verschlüsselten Zugriff einen Reverse-Proxy mit Zertifikat davorsetzen (z. B. Caddy) und `COOKIE_SECURE=true` setzen.
- Den Port nicht ins Internet weiterleiten. Zugriff von außerhalb nur über ein VPN.

## Datensicherung

```bash
npm run backup                                           # schreibt backups/pms-JJJJMMTT-HHMMSS.dump
npm run restore -- backups/pms-20270101-020000.dump --ja  # ersetzt ALLE Daten durch diesen Stand
```

- Täglich automatisch ausführen (siehe oben). Es bleiben die letzten 30 Stände (`BACKUP_KEEP`).
- Den Ordner `backups/` zusätzlich auf einen zweiten Datenträger oder ein NAS kopieren (`BACKUP_DIR`) –
  eine Sicherung auf derselben Festplatte schützt nicht vor deren Ausfall.
- Vor einer Wiederherstellung das PMS beenden, danach wieder starten.
- Sicherungen enthalten personenbezogene Daten und sind **nicht verschlüsselt**; den Ablageort entsprechend schützen.

Geprüft am 12.11.2026: Sicherung erstellt, Datenbank geleert, zurückgespielt, Anmeldung und Protokollschutz funktionieren.

## Entwicklung

```bash
npm run dev        # Server (Port 3000) und Oberfläche (Port 5173) mit automatischem Neuladen
npm test           # benötigt eine leere Datenbank: TEST_DATABASE_URL (Standard postgres://pms:pms@127.0.0.1:5432/pms_test)
npm run typecheck
npm run db:generate   # nach Änderungen an src/server/db/schema.ts
```

Achtung: `npm test` löscht den Inhalt der Testdatenbank. Niemals auf die Produktivdatenbank zeigen lassen.

## Sicherheit (Stand Phase 1)

- Passwörter: scrypt (N=2^17), mindestens 10 Zeichen; Sperre für 10 Minuten nach 5 Fehlversuchen
- Sitzungen: zufälliges Token, in der Datenbank nur als Hash; Cookie `HttpOnly`, `SameSite=Strict`;
  Abmeldung nach 12 Stunden ohne Aktivität, spätestens nach 30 Tagen
- Rechte werden bei jeder Anfrage auf dem Server geprüft; der letzte Administrator kann nicht entfernt werden
- Alle Datenbankzugriffe parametrisiert; Eingaben werden serverseitig mit Schemas geprüft; strenge Content-Security-Policy
- Änderungsprotokoll ist per Datenbank-Trigger nur anfügbar (ein Datenbank-Administrator könnte den Trigger entfernen)

Keine dieser Maßnahmen ist extern geprüft; rechtliche Punkte siehe Abschnitt 7 im Konzept.
