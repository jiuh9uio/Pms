# Schützenhaus PMS

Property-Management-System für das Hotel & Restaurant Schützenhaus.
Konzept, Datenmodell und offene Fragen: [`docs/konzept.md`](docs/konzept.md).

## Stand

| Phase | Inhalt | Status |
|---|---|---|
| 1 Fundament | Anmeldung, Benutzer und Rollen, Änderungsprotokoll, Stammdaten, Steuersätze, Grundlayout (hell/dunkel, mobil), Datensicherung | **fertig** |
| 2 Hotelbetrieb | Zimmer, Kategorien, Preisregeln, Leistungen, Belegungsplan (Tag/Woche/Monat, Drag-and-drop, Sperren), Reservierungen (auch mehrere Zimmer), Check-in/-out, Gäste, Übersicht mit Kennzahlen und Aufgaben | **fertig** |
| Kontrollen | Startmenü mit Bereichen; Kontrollarten (Hygieneamt, Finanzamt, eigene), Unterlagenlisten, Kontrollbesuche, Temperaturprotokoll je Bereich und Messstelle mit Monatsausdruck | **fertig** |
| 3 Abrechnung | Rechnungen mit lückenloser Nummer, Druck/PDF, Storno per Stornobeleg, Zahlungen (bar/Karte/Überweisung …), Anzahlungen, offene Posten, CSV-Export | **fertig** |
| 4 Qualität | Browser-Tests, Sicherheitsprüfung, Bedienung mobil, Anwenderdokumentation | offen |

**Seit Version 1.1.0 zusätzlich:**

- **Datensicherung in der Windows-Version:** einmal täglich automatisch, solange das Programm läuft (stündliche Prüfung, neue Sicherung
  wenn die jüngste älter als 20 Stunden ist), Knopf „Jetzt sichern“ und Stand unter *Einstellungen → Datensicherung*, Warnung im
  Startmenü bei fehlgeschlagener oder mehr als drei Tage alter Sicherung. `BACKUP_COPY_DIR` in `pms.env` kopiert jede Sicherung
  zusätzlich in einen zweiten Ordner (USB-Festplatte, Netzlaufwerk); `BACKUP_AUTO=off` schaltet die Automatik ab.
  Läuft das Programm nicht, wird auch nicht gesichert. Die Sicherungen sind nicht verschlüsselt.
- **E-Mail an Gäste (Bereich Hotel):** Reservierungsbestätigung aus der Reservierung, Rechnung als PDF (mit eingebetteten
  ZUGFeRD-Daten) aus der Rechnung. Der Textvorschlag ist vor dem Senden änderbar; der Versand steht im Verlauf der Reservierung
  bzw. im Änderungsprotokoll. Voraussetzung ist das Postfach unter *Einstellungen → E-Mail-Versand*.
  Automatisiert getestet mit ersetztem Versand – **der Versand über ein echtes GMX-Postfach ist nicht getestet.**
  Rechnungen mit Nachlass-Positionen oder unbekanntem Empfängerland lassen sich so nicht senden (dann drucken/als PDF speichern).
- **Auswertung (Bereich Hotel):** Zimmernächte, Auslastung, gebuchter Logisumsatz und Rechnungssumme je Monat. Die Auslastung
  bezieht sich auf die heute aktiven Zimmer; Sperren und frühere Zimmerzahlen bleiben unberücksichtigt. Kein Ersatz für die Buchhaltung.

**Nicht enthalten** (in der Anwendung nicht als Schaltfläche vorhanden):

- DATEV-Format, Mahnwesen, Kassenfunktion/TSE
- Aufpreise für Zusatzpersonen und Kinderpreise (derzeit über Sonderpreis je Nacht)
- Meldeschein-Druck, automatische Löschfristen für Gästedaten
- Channel-Manager, Onlinebuchung, automatischer E-Mail-Versand (z. B. Erinnerung vor Anreise)

Der frühere Prototyp liegt unverändert unter `prototype/`.

### Abrechnung

- **Rechnung erstellen:** In der Reservierung unter „Rechnungen und Zahlungen“ – mit allen Positionen, nur Übernachtung oder nur Extras
  (für getrennte Rechnungen, z. B. Firma zahlt die Übernachtung, der Gast die Extras). Für Leistungen ohne Reservierung gibt es „Freie Rechnung“.
- Der **Entwurf** lässt sich bearbeiten: Empfänger (Firma, Name, Anschrift, USt-IdNr. – unabhängig vom Gast), Leistungszeitraum, Hinweis, Positionen.
- **Ausstellen** vergibt die Rechnungsnummer lückenlos je Jahr (Format einstellbar, z. B. `RE-2027-0001`), setzt Datum und Fälligkeit
  (Zahlungsziel einstellbar) und kopiert die Absenderangaben in die Rechnung. Voraussetzung: Anschrift und Steuernummer oder USt-IdNr. in den Einstellungen.
- **Ausgestellte Rechnungen sind unveränderlich** – die Datenbank lehnt jede Änderung und jedes Löschen ab. Korrektur nur über **Storno**:
  Es entsteht ein Stornobeleg mit eigener Nummer und negativen Beträgen; bereits gezahlte Beträge werden als Anzahlung auf die Reservierung
  übertragen und mit der korrigierten Rechnung verrechnet.
- **Zahlungen:** Bar, Karte, Überweisung, PayPal, Gutschein; Teilzahlungen und abweichende Zahler möglich. Anzahlungen werden auf der Reservierung
  gebucht und beim Ausstellen automatisch der Rechnung zugeordnet. Zahlungen sind nicht änderbar; Fehler korrigiert eine Gegenbuchung.
- **Offene Posten:** Seite „Rechnungen“ (Filter „Offen“) und Kachel „Offene Rechnungen“ in der Übersicht, mit überfälligen.
- **Druck / PDF:** Die Druckansicht wird im Browser über „Drucken → Als PDF speichern“ zur PDF-Datei. Das Programm erzeugt und archiviert
  **keine** PDF-Dateien selbst; maßgeblich sind die unveränderlich gespeicherten Rechnungsdaten.
- **Export:** CSV mit allen Rechnungen und Stornobelegen (Netto und Umsatzsteuer je Satz, Brutto, bezahlt, offen) sowie aller Zahlungen.
  Ein DATEV-Format ist nicht enthalten.
- Nicht enthalten: Mahnwesen, Firmenprofile mit vereinbarten Preisen, Kassenfunktion/TSE.
  **Die Rechnungsvorlage und die Aufbewahrung sind nicht rechtlich geprüft** – bitte einmal mit der Steuerberatung durchsehen
  (u. a. Pflichtangaben nach § 14 UStG, GoBD, ob für Barzahlungen eine TSE nötig ist).

### E-Rechnung (ZUGFeRD)

- Eigener Menüpunkt **E-Rechnung** (je Benutzer freigebbar): eine fertige **PDF-Rechnung hochladen**, Rechnungsdaten eintragen
  (Nummer, Datum, Empfänger, Positionen als Bruttobeträge je Steuersatz), und das Programm erzeugt eine **ZUGFeRD-Datei**:
  dieselbe PDF mit eingebetteter XML-Datei `factur-x.xml` (UN/CEFACT CII, Profil EN 16931). Die Angaben des eigenen Betriebs kommen aus den Einstellungen.
- Rechnungen, die im Bereich Hotel ausgestellt wurden, werden mit dem Knopf **„E-Rechnung“** ohne Eintippen umgewandelt; die PDF erzeugt
  das Programm dann selbst (eingebettete Schrift, Farbprofil).
- **Versand per E-Mail** (PDF, XML oder beides) über das in den Einstellungen hinterlegte Postfach (z. B. GMX); jeder Versand wird protokolliert.
  Das E-Mail-Passwort wird verschlüsselt gespeichert; der Schlüssel liegt in der Datei `secret.key` im Datenordner
  (`PMS_DATA_DIR`, Standard `./data`; in der Windows-Version der Ordner `data`) und **gehört mit in die Datensicherung** –
  ohne ihn muss das Passwort neu eingetragen werden.
- **Grenzen – bitte beachten:**
  - Die Dateien sind nach den Vorgaben für ZUGFeRD 2 / Factur-X aufgebaut und mit eigenen Tests geprüft (wohlgeformtes XML, stimmige Summen,
    eingebettete Datei und Kennzeichnung), aber **nicht mit einem offiziellen Validator** (z. B. Mustang, veraPDF, KoSIT) geprüft.
    Vor dem ersten echten Versand eine Beispieldatei validieren.
  - Das Programm **liest die hochgeladene PDF nicht aus**: Maßgeblich ist der XML-Teil, der aus den eingetragenen Daten entsteht. PDF und Eingaben müssen übereinstimmen.
  - Ob eine umgewandelte fremde PDF den Archivstandard PDF/A-3 erfüllt, hängt von der Ausgangsdatei ab (eingebettete Schriften usw.).
  - Nicht unterstützt: Stornobelege/Gutschriften, Nachlass-Positionen, andere Währungen als Euro, XRechnung für Behörden (Leitweg-ID-Pflichtfelder), Empfang von E-Rechnungen.

### Firmen

- Seite **Firmen** (Bereich Hotel): Rechnungsanschrift, USt-IdNr., Ansprechpartner, eigenes Zahlungsziel, interne Bemerkungen,
  **vereinbarte Preise je Zimmerkategorie**, Buchungshistorie und berechneter Umsatz.
- **Erneut buchen:** „Buchen“ in der Firmenliste bzw. „Neue Reservierung für diese Firma“ öffnet die Buchung mit vorgewählter Firma.
- Bei einer **Firmenbuchung** gilt je Nacht der vereinbarte Preis (statt Saison-/Wochenendregeln), die Rechnung geht an die Firma
  („z. Hd.“ Ansprechpartner) mit deren Zahlungsziel. Spätere Preisänderungen bei der Firma wirken nicht auf gebuchte Nächte.

### Housekeeping

- Beim Check-out wird das Zimmer automatisch „zu reinigen“. Die Übersicht listet diese Zimmer – solche mit heutiger Anreise zuerst und
  zusätzlich als Aufgabe –, ein Tipp auf „Sauber“ meldet das Zimmer fertig. Im Belegungsplan sind sie mit ● markiert.

### Datenschutz

- **Datenauskunft** (Administrator, Gästeprofil): lädt alle gespeicherten Angaben zum Gast, seine Aufenthalte und Rechnungen als JSON-Datei.
- **Anonymisieren** (Administrator): entfernt Name, Kontakt-, Adress- und Ausweisdaten sowie Bemerkungen. Reservierungen bleiben ohne Namen
  für die Statistik erhalten. Personenbezogene Inhalte in den Protokolleinträgen des Gastes werden ersetzt – das ist die einzige Änderung,
  die die Datenbank am Protokoll zulässt. Ausgestellte Rechnungen und erfasste Zahlungen bleiben wegen der gesetzlichen Aufbewahrung unverändert.
  Nicht möglich, solange eine offene, laufende oder künftige Reservierung besteht.
- **Nicht enthalten:** automatische Löschfristen. Wann Gästedaten zu löschen sind (z. B. Meldedaten, Werbe-Einwilligungen), legt der Betrieb
  in seinem Löschkonzept fest; die Anonymisierung erfolgt derzeit von Hand.

### Kontrollen und Temperaturprotokoll

- Nach der Anmeldung erscheint ein **Startmenü** mit den Bereichen, die das Konto öffnen darf.
- **Freigaben je Benutzer:** In der Verwaltung legt der Administrator je Benutzer fest, welche Bereiche (Hotel, Kontrollen) er sieht.
  Der Server prüft die Freigabe bei jeder Anfrage; eine Änderung wirkt sofort. Verwaltung und „Mein Konto“ sind dem Administrator
  vorbehalten – Benutzer können sich abmelden, ein neues Passwort vergibt der Administrator. Weitere Bereiche (z. B. Kasse) gibt es noch nicht.
- Unter **Kontrollen** gibt es je Kontrollart (Hygieneamt, Finanzamt; weitere legt der Administrator an) eine Liste der
  bereitzuhaltenden Unterlagen zum Abhaken und ein Verzeichnis der stattgefundenen Kontrollen.
  Die mitgelieferten Unterlagenlisten sind Vorschläge, keine vollständige oder rechtlich geprüfte Aufstellung.
- **Weitere Kühlgeräte:** Auf der Kontrollen-Startseite legt der Administrator je Bereich mit einem Tipp weitere Messstellen an
  („+ Kühltruhe 2“, „+ Kühlschrank“, „+ Kühlhaus“ …, mit üblichem Sollbereich, der danach anpassbar ist).
- **Reinigungsprotokoll:** Unter dem Temperaturprotokoll stehen je Bereich die Reinigungsaufgaben mit Intervall (täglich, wöchentlich, monatlich …).
  Das Programm zeigt, was heute fällig oder überfällig ist; abgehakt wird nur für heute, mit Namen und Uhrzeit. Versehentliches Abhaken
  lässt sich am selben Tag zurücknehmen (steht im Änderungsprotokoll). Das Monatsprotokoll lässt sich getrennt ausdrucken.
  Die Kurzabfrage fragt nach der Temperatur auch „Reinigung erledigt?“ für die fälligen Aufgaben.
- **Bereiche (Zonen)** wie Küche, Theke oder Lager legt der Administrator direkt auf der Kontrollen-Startseite an (auch per Vorschlag zum Antippen)
  oder im Hygieneamt; dort kommen je Bereich die Messstellen dazu. Abgefragt wird ein Bereich, sobald er mindestens eine Messstelle hat.
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

1. Paket herunterladen: auf GitHub unter **Releases → neueste Version → `SchuetzenhausPMS-Windows.zip`**
   (Zwischenstände: Actions → „Windows-Version (pms.exe)“ → neuester erfolgreicher Lauf → Artifacts).
2. ZIP vollständig entpacken, z. B. nach `C:\SchuetzenhausPMS` (nicht in einen OneDrive- oder Netzwerkordner).
3. `pms.exe` doppelt anklicken. Beim ersten Start wird die Datenbank eingerichtet, dann öffnet sich der Browser.
4. Administrator-Konto anlegen, danach unter „Zimmer & Preise“ das Haus einrichten.

Sicherung, Autostart, Update und Wiederherstellung sind in der beiliegenden `LIES MICH.txt` beschrieben.
Die exe ist nicht signiert; Windows SmartScreen zeigt deshalb beim ersten Start eine Warnung
(„Weitere Informationen“ → „Trotzdem ausführen“).

Das Paket wird bei jeder Änderung automatisch auf einem Windows-Rechner von GitHub gebaut und dort geprüft:
erster Start, Zimmer und Buchung anlegen, Doppelbuchung wird abgelehnt, Sicherung, Neustart mit erhaltenen Daten,
Wiederherstellung, Programm-Update. Selbst bauen: `npm run build:exe` (auf Windows, mit installiertem PostgreSQL und gesetztem `PGROOT`).

### Automatisches Programm-Update

Die Windows-Version sieht beim Start und zweimal täglich nach, ob auf GitHub eine neuere Version veröffentlicht ist
(`https://api.github.com/repos/jiuh9uio/Pms/releases/latest`; übertragen wird dabei nichts außer der Anfrage selbst).
Administratoren sehen dann einen Hinweis im Startmenü. Eingespielt wird **nur auf Knopfdruck** unter
*Einstellungen → Programm-Update*:

1. Paket herunterladen, SHA-256-Prüfsumme mit der veröffentlichten vergleichen, entpacken, Versionsangabe prüfen.
2. Datensicherung nach `backups\` schreiben.
3. PMS beenden; ein Hilfsskript (`update\apply.bat`) kopiert die bisherigen Programmdateien nach `update\previous`
   und die neuen darüber. `data\`, `backups\` und `pms.env` werden nicht angefasst.
4. PMS neu starten; die Datenbank wird beim Start durch die mitgelieferten Migrationen angepasst.

Protokoll: `update\update.log`. Schlägt das Kopieren fehl, stellt das Skript die vorherigen Dateien wieder her.

Veröffentlicht wird eine Version, wenn die Versionsnummer in `package.json` erhöht und `CHANGELOG.md` ergänzt wurde –
der Windows-Bau legt dann nach bestandenem Funktions- und Update-Test das GitHub-Release `v<Version>` an.

Grenzen – bitte beachten:

- Die Prüfsumme schützt vor beschädigten Downloads, **nicht** vor einem manipulierten GitHub-Konto: Paket und
  Prüfsumme kommen aus derselben Quelle, die exe ist nicht signiert. Wer Schreibzugriff auf das Repository hat,
  kann Updates ausliefern – das Konto entsprechend schützen (Zwei-Faktor-Anmeldung).
- Ein Zurück auf die alte Version ist nicht automatisch: Programmdateien aus `update\previous` zurückkopieren **und**
  die Sicherung von vor dem Update einspielen (neuere Datenbankstände passen nicht zu älteren Programmen).
- Bringt eine Version eine andere PostgreSQL-Hauptversion mit, lehnt das Update ab; dann von Hand: Sicherung,
  neues Paket in neuen Ordner, Sicherung dort wiederherstellen.
- Der Rechner braucht für Prüfung und Download Internetzugang zu `api.github.com` und `github.com`.
- Abschalten der automatischen Prüfung: `PMS_UPDATE_CHECK=off` in `pms.env`.
- Getestet: kompletter Ablauf automatisiert unter Linux und auf dem Windows-Baurechner von GitHub mit einem
  lokalen Test-Server. Nicht getestet: Update auf einem Rechner mit Virenscanner/gesperrten Dateien und
  mit als geplanter Aufgabe (Autostart) laufendem PMS.

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
