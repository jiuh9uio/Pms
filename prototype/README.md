# Hotel-PMS – Prototyp (wird durch den Neubau im Hauptverzeichnis abgelöst)

Schlankes Property-Management-System für kleine Hotels und Pensionen – mit GMX-Postfach,
einstellbarer Kundenkartei, flexiblen Zimmern/Preisen und smarten Helfern.
Läuft als einzelner Node.js-Prozess mit SQLite-Datei, ohne Build-Schritt.

## Start

```bash
npm install
npm start          # http://127.0.0.1:3000
npm run demo       # optional: Beispielgäste und -buchungen anlegen (nur bei leerer Kartei)
npm test
```

Voraussetzung: Node.js ≥ 22.13. Beim ersten Aufruf wird das Zugangspasswort festgelegt.

| Variable | Bedeutung | Standard |
|---|---|---|
| `PORT` | Port | `3000` |
| `HOST` | Bind-Adresse (`0.0.0.0` für Zugriff im Netzwerk) | `127.0.0.1` |
| `PMS_DATA_DIR` | Ordner für `pms.db` und `secret.key` | `./data` |
| `TZ` | Zeitzone für „heute“ | `Europe/Berlin` |

Für Zugriff von außerhalb des eigenen Rechners einen Reverse-Proxy mit HTTPS davorsetzen.
Datensicherung: den Ordner `data/` sichern (Datenbank **und** `secret.key`).

## Funktionen

- **Übersicht** – Auslastung, An-/Abreisen mit Check-in/-out per Klick, Monatsumsatz, ADR, RevPAR, 14-Tage-Vorschau
- **Belegungsplan** – Zimmer × Tage, Klick auf freies Feld legt Buchung an
- **Reservierungen** – Option/Bestätigt/Im Haus/Abgereist/Storno/No-Show, Extras, Zahlungen, Rechnung (Druck/PDF) mit MwSt.-Ausweis
- **Kundenkartei** – eigene Zusatzfelder (Text, Zahl, Datum, Auswahl, Ja/Nein), Standardfelder ein-/ausblendbar,
  Tags, VIP/Sperre, Aufenthalts- und E-Mail-Verlauf, CSV-Export, DSGVO-Anonymisierung
- **Zimmer & Preise** – Kategorien, Zimmer, Housekeeping-Status, Preisregeln (Saison, Wochentage, Festpreis,
  Mindestaufenthalt), Extras, Kurtaxe, Kinderermäßigung, Preisvorschau
- **GMX** – Senden über SMTP (`mail.gmx.net:587`), Abrufen über IMAP (`imap.gmx.net:993`), Vorlagen mit Platzhaltern,
  automatische Zuordnung der E-Mails zu Gästen
- **Auswertung** – Monatskennzahlen und Buchungswege

### Smarte Funktionen

- Anfrage-Erkennung: Zeitraum, Personen und Zimmerwunsch werden aus eingehenden E-Mails gelesen, Verfügbarkeit
  wird angezeigt, Reservierung ist mit einem Klick vorbelegt
- Automatische Zimmerzuweisung (Best Fit – schließt Lücken im Belegungsplan)
- Auslastungsabhängige Preise (Stufen frei einstellbar)
- Automatische Buchungsbestätigung, Anreise-Erinnerung und Dankeschön-E-Mail
- Hinweise: überfällige An-/Abreisen, ungereinigte Zimmer, offene Beträge, Geburtstage, Stammgäste, VIPs
- Dublettenerkennung mit Zusammenführen

## GMX einrichten

1. In GMX unter **E-Mail → Einstellungen → POP3/IMAP Abruf** den Zugriff über POP3/IMAP erlauben.
2. Bei Zwei-Faktor-Anmeldung ein anwendungsspezifisches Passwort erzeugen.
3. Im PMS unter **Einstellungen → GMX-Postfach** Adresse und Passwort speichern, dann „Verbindung testen“.

Das Passwort wird AES-256-GCM-verschlüsselt in der Datenbank abgelegt (Schlüssel: `data/secret.key`).
Abgerufene E-Mails bleiben im GMX-Postfach unverändert; es werden nur Textinhalte übernommen (keine Anhänge).

## Aufbau

```
server/   index.js (Login, Rechnung)  routes.js (API)  pricing.js  mail.js  smart.js  db.js
public/   index.html  app.js  style.css
test/     pms.test.js
```
