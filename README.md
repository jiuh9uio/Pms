# Schützenhaus PMS

Property-Management-System für das Hotel & Restaurant Schützenhaus.
Konzept, Datenmodell und offene Fragen: [`docs/konzept.md`](docs/konzept.md).

## Stand

| Phase | Inhalt | Status |
|---|---|---|
| 1 Fundament | Anmeldung, Benutzer und Rollen, Änderungsprotokoll, Stammdaten, Steuersätze, Grundlayout (hell/dunkel, mobil), Datensicherung | **fertig** |
| 2 Hotelbetrieb | Zimmer, Belegungsplan, Reservierungen, Check-in/-out, Gäste, Dashboard-Kennzahlen | offen |
| 3 Abrechnung | Rechnungen, PDF, Zahlungen (bar/Karte), Firmen, E-Mail | offen |
| 4 Qualität | Browser-Tests, Sicherheitsprüfung, Bedienung mobil, Anwenderdokumentation | offen |

Nicht enthalten: alles aus Phase 2–4, außerdem TSE/Kassenfunktion, E-Rechnung, Channel-Manager, Onlinebuchung.
Die Tabellen für Zimmer und Belegungen (inkl. Doppelbuchungsschutz) existieren bereits, haben aber noch keine Oberfläche.
Der frühere Prototyp liegt unverändert unter `prototype/` und wird mit Phase 2/3 abgelöst.

## Technik

TypeScript durchgehend · Fastify (Server, REST unter `/api/v1`) · React + Vite (Oberfläche) · PostgreSQL 16 ·
Drizzle ORM mit SQL-Migrationen · Zod (gemeinsame Eingabeprüfung) · Vitest.
Ein Node-Prozess liefert API und Oberfläche aus. Gemessen im Leerlauf: ca. 120 MB (Node) + ca. 100 MB (PostgreSQL).

```
src/server/   app.ts (Routen, Zugriffsschutz)  modules/ (auth, users, settings, audit)  db/ (Schema, Verbindung)
src/shared/   Eingabeschemas und Typen für Server und Oberfläche
web/          Oberfläche
migrations/   Datenbankschema; 0001 enthält Doppelbuchungsschutz und Protokollschutz
tests/        Tests gegen eine echte PostgreSQL-Datenbank
scripts/      Datensicherung und Wiederherstellung
```

## Installation auf dem Rechner im Haus

Voraussetzungen: [Node.js 22](https://nodejs.org) und [PostgreSQL 16](https://www.postgresql.org/download/)
(Windows, macOS oder Linux). `pg_dump`/`pg_restore` müssen für die Datensicherung im Suchpfad liegen.

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
Damit das PMS nach einem Neustart des Rechners von selbst läuft, `npm start` als Dienst einrichten
(Windows: Aufgabenplanung oder NSSM; Linux: systemd).

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

- Täglich automatisch ausführen (Windows: Aufgabenplanung, Linux: cron). Es bleiben die letzten 30 Stände (`BACKUP_KEEP`).
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
