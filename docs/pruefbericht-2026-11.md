# Prüfbericht Sicherheit, Datenschutz und Compliance – Schützenhaus PMS

Stand der Prüfung: 15.11.2026 · geprüfter Programmstand: Version 1.55.0 (Sicherungspunkt `vor-audit-2026-11`), Korrekturen in 1.55.1
Prüfumfang: Quelltext (≈ 19 000 Zeilen TypeScript), 37 Datenbank-Migrationen, Abhängigkeiten, Installationsskripte, laufendes Programmpaket im Testsystem.

> Dieser Bericht ist eine technische Prüfung durch eine KI. Er ist **keine Rechtsberatung, kein Penetrationstest durch Fachleute und keine Zertifizierung**.
> Rechtliche Aussagen beruhen auf einer Internetrecherche vom 15.11.2026, überwiegend über Suchergebnisse und Sekundärquellen;
> Originaltexte wurden nur teilweise eingesehen. Wo das so ist, steht es ausdrücklich dabei.

---

## A. Management Summary

**Gesamtbild:** Die technische Grundsicherung ist gut. Ein **kritischer** Befund (unmittelbarer unberechtigter Zugriff auf Gästedaten, Rechnungen oder Verwaltung) wurde **nicht** gefunden. Jede der über 150 Server-Adressen verweigert ohne Anmeldung den Zugriff; das prüft ein fester Test bei jeder Version.

**Die wichtigsten Risiken liegen bei Rechtspflichten und beim geplanten Betrieb im Internet:**

| Nr. | Befund | Schweregrad |
|---|---|---|
| H1 | „Daten löschen“ kann ausgestellte Rechnungen und Zahlungen löschen und den Rechnungsnummernkreis zurücksetzen | HOCH |
| H2 | Meldeschein-Angaben (Geburtsdatum, Staatsangehörigkeit, Ausweisnummer) werden unbefristet gespeichert; Gesetz verlangt Vernichtung nach 1 Jahr + 3 Monaten | HOCH |
| H3 | Barzahlungen im PMS: mögliches Aufzeichnungssystem mit Kassenfunktion (§ 146a AO) – TSE, Beleg, Meldung und Kassenexport sind nicht vollständig umgesetzt | HOCH |
| H4 | Auf einem frisch installierten Internet-Server kann sich jeder als Erster zum Administrator machen | HOCH (nur Internet-Betrieb) |

Vier kleine Härtungen wurden bereits umgesetzt und getestet (Abschnitt F). Alle Änderungen an Löschlogik, Rechnungen, Anmeldung, Datenbank und Betrieb warten auf Ihre Freigabe (Abschnitt E).

**Produktionsreife (Abschnitt I):** Betrieb im Hausnetz: *Technisch weitgehend vorbereitet*. Betrieb im Internet (Hetzner): *Bereit für weitere Tests* – erst nach H1, H2, H4 und den Punkten zum Server.

---

## B. Technische Sicherheitsanalyse

### B.1 Bestandsaufnahme (Phase 1)

| Bereich | Befund | Sicherheitsrelevanz |
|---|---|---|
| Sprachen/Frameworks | TypeScript; Server Fastify 5, Datenbankzugriff Drizzle ORM + postgres.js; Oberfläche React 19 + Vite; Prüfung aller Eingaben mit Zod 4 | aktuelle, unterstützte Versionen |
| Laufzeit | Node.js 22 (Windows-Paket als eigene .exe), PostgreSQL 16/17 mitgeliefert | Node 22 ist LTS |
| Datenbank | 48 Tabellen; Schreibschutz per Datenbank-Trigger für Rechnungen, Rechnungspositionen, Zahlungen, Rechnungs-PDFs und Änderungsprotokoll | Kernschutz für GoBD |
| Schnittstellen | ≈ 160 Adressen unter `/api/v1`; öffentlich nur: Anmeldung, Gästeseite, Anfrage, Gäste-Link, Online-Meldeschein, Gesundheitsprüfung, Programm-Symbol | geprüft (siehe B.2) |
| Anmeldung | Passwort-Hash scrypt (N=2¹⁷, r=8, p=1, OWASP-Empfehlung); Sitzungs-Token 256 Bit zufällig, nur als SHA-256-Hash gespeichert; Cookie `HttpOnly`, `SameSite=Strict`, `Secure` im HTTPS-Betrieb; Ablauf 12 h ohne Aktivität / 30 Tage maximal; optional automatisches Abmelden; Zwei-Faktor (TOTP) | gut |
| Rollen | Administrator / Benutzer mit Bereichsfreigaben; serverseitig je Adresse geprüft | gut |
| Uploads | Logo, Fotos (PNG/JPEG, Signatur geprüft, max. 1 MB), Video (MP4/WebM, Signatur geprüft, max. 80 MB), PDF für E-Rechnung | geprüft |
| Externe Verbindungen | SMTP/IMAP (vom Administrator eingetragen), FRITZ!Box TR-064 und TSE nur im Hausnetz, EC-Gerät (ZVT), Adressabfrage OpenStreetMap/Impressum (Schutz gegen Abruf ins eigene Netz), Programm-Update von GitHub | siehe M1, N6 |
| Geheimnisse | Schlüsseldatei `secret.key` (AES-256-GCM für gespeicherte Passwörter, HMAC für Gäste-Links), zufälliges Datenbank-Passwort, Rechte 0600 | gut; nicht im Repository |
| Protokoll | Änderungsprotokoll (wer, wann, was, IP) – per Trigger nur lesbar; Anmeldeversuche, Löschungen, Rechnungsvorgänge | gut; Fristen fehlen (M4) |
| Sicherung | täglich `pg_dump`, 30 Stück, optional Kopie auf zweites Laufwerk, vor jedem Update und vor „Daten löschen“ | unverschlüsselt (M3) |
| Betrieb Internet | Installationsskript: Caddy mit automatischem HTTPS, Firewall (nur SSH/80/443), eigener Dienstbenutzer, `COOKIE_SECURE=true` | gut; H4, M1 |

**Abhängigkeiten:** `npm audit` für das ausgelieferte Programm: **0 Schwachstellen**. Für Entwicklungswerkzeuge: 4 mittlere (esbuild-Lücke GHSA-67mh-4wv8-2f99 über drizzle-kit) – betrifft nur den Entwicklungsserver, nicht das ausgelieferte Programm (N7). Veraltet: nur `@fastify/static` (Patch-Version 10.1.11 verfügbar).

### B.2 Geprüfte Angriffsarten (Phase 2 und 5)

| Prüfpunkt | Ergebnis | Nachweis |
|---|---|---|
| Zugriff ohne Anmeldung auf interne Adressen | **keine Lücke** – alle nicht öffentlichen Adressen antworten 401 | Test `security.test.ts` (alle Routen automatisch) |
| Benutzer ohne Bereiche / Rechteausweitung | **keine Lücke** – nur eigenes Konto, Übergabebuch, Steuersätze, Neuigkeiten | Test `security.test.ts` |
| Fremde Datensätze über Kennungen (IDOR), öffentlich | **keine Lücke** – Gäste-Link: HMAC-signiert + Nachname + PLZ; Meldeschein: 192-Bit-Zufallscode, nur Hash gespeichert | Code + manipulierte Anfragen gegen das Testsystem |
| SQL-Einschleusung | **keine Lücke** – nur parametrisierte Abfragen; `sql.raw` nur mit festen Tabellennamen | Semgrep (eigene Regeln), Codesuche |
| XSS | **keine Lücke** – React maskiert; kein `dangerouslySetInnerHTML`; E-Mails nur als Text | Semgrep, Codesuche |
| CSRF | **geschützt** – `SameSite=Strict` + Herkunftsprüfung aller schreibenden Anfragen | Test (fremde Herkunft → 403) |
| SSRF | **geschützt** – Adressabfrage blockiert private Netze, prüft Weiterleitungen; Restrisiko N6 | Code, bestehende Tests |
| Befehlsausführung | **keine Lücke** – nur feste Programme mit Argumentlisten, keine Shell mit Eingaben | Semgrep, Codesuche |
| Path Traversal | **keine Lücke** – manipulierte Pfade liefern Startseite oder 404, keine Dateien | 8 Probe-Anfragen gegen das Testsystem |
| Mass Assignment / Prototype Pollution | **keine Lücke** – Zod entfernt unbekannte Felder; `__proto__` → 400 | Probe-Anfrage |
| Übergroße Anfragen | **geschützt** – 413 | Probe (3 MB) |
| CORS | **keine Freigabe** für fremde Seiten | Probe |
| Fehlerausgaben | **keine** Stacktraces oder Interna; Meldungen jetzt auf Deutsch | Test + Probe |
| Brute Force Anmeldung | **geschützt** – Kontosperre nach 5 Fehlversuchen (10 Min.), 20 Versuche/10 Min. je Gerät, optional 2FA | Test |
| Spam über Formulare | **geschützt** – unsichtbares Fangfeld, 30 Aufrufe/Min. je Gerät, 40 Anfragen/Tag gesamt, Pflicht-Datenschutzhaken | Tests |
| Doppelte Verarbeitung / gleichzeitige Anfragen | **geschützt** – Sperren für Nummernkreise, Ausschluss-Bedingung gegen Doppelbelegung, Versionsprüfung beim Speichern, Doppelklick-Schutz bei Zahlungen | bestehende Tests |
| Geheimnisse im Browser-Code | **keine** – keine Quellkarten, keine Schlüssel; Verwaltungscode wird auf der Gästeseite gar nicht geladen | Prüfung des Bundles |
| Geheimnisse im Repository / Git-Historie | **keine** – Treffer nur Testpasswörter und Werks-PIN des EC-Geräts | Musterprüfung |

### B.3 Alle Befunde mit Schweregrad

**KRITISCH:** keiner gefunden.

**HOCH**

- **H1 – Rechnungen löschbar** · `src/server/modules/purge.ts`
  Problem: „Daten löschen“ (Einstellungen → System) schaltet den Datenbank-Schreibschutz ab und löscht alle Rechnungen, Positionen, Zahlungen, Rechnungs-PDFs; optional wird der Nummernkreis zurückgesetzt. Ursache: Funktion war zum Aufräumen von Probedaten gebaut. Auswirkung: Nach Beginn des echten Betriebs verstößt das gegen Aufbewahrung und Unveränderbarkeit (§ 147 AO, § 14b UStG, GoBD); doppelte Rechnungsnummern möglich. Begründung HOCH: rechtliche Folgen, ein Fehlklick genügt (mit Passwort und Wort „LÖSCHEN“).
  Lösung: Stichtag „echter Betrieb ab“. Danach Löschen ausgestellter Rechnungen und Zurücksetzen der Nummern gesperrt; vorher wie bisher. Aufwand: ca. ½ Tag. **Freigabe nötig (Löschlogik/Rechnungen).**

- **H2 – Meldeschein-Daten unbefristet** · `guests`-Tabelle, `src/server/modules/guestforms.ts`
  Problem: Geburtsdatum, Staatsangehörigkeit und Ausweisnummer bleiben dauerhaft am Gast. Rechtsgrundlage: § 30 Abs. 4 BMG – Aufbewahrung 1 Jahr ab Abreise, Vernichtung binnen 3 Monaten danach (Recherche s. D). Auswirkung: Verstoß gegen BMG (Bußgeld nach § 54 BMG) und DSGVO-Speicherbegrenzung. Lösung: automatisches Leeren dieser Felder 12 Monate nach der letzten Abreise (spätestens nach 15); Papier-Meldescheine organisatorisch vernichten. Aufwand: ca. 1 Tag. **Freigabe nötig (Löschlogik).**

- **H3 – Barzahlungen und Kassenpflichten** · Zahlungen (`billing.ts`), TSE (`tsesign.ts`)
  Problem: Das PMS bucht Barzahlungen. Damit kann es ein elektronisches Aufzeichnungssystem mit Kassenfunktion im Sinne von § 146a AO sein (AEAO zu § 146a Nr. 1.2). Dann gelten: TSE-Absicherung jedes Vorgangs, Belegausgabepflicht, Mitteilung an das Finanzamt über ELSTER (seit 01.01.2025), Kassen-Export (DSFinV-K). Ist-Stand: TSE-Aufzeichnung abschaltbar und standardmäßig aus; kein Beleg mit QR-Code; kein DSFinV-K-Export. **Ob die Pflicht greift, muss die Steuerberatung entscheiden.** Möglichkeiten: (a) Barzahlungen nur über die vorhandene Restaurant-/Hotelkasse kassieren und im PMS nur noch als „bezahlt über Kasse“ vermerken; (b) TSE-Aufzeichnung verpflichtend einschalten und Beleg + Export nachrüsten (Aufwand mehrere Wochen, Prüfung gegen echte TSE nötig). **Entscheidung nötig.**

- **H4 – Ersteinrichtung im Internet übernehmbar** · `src/server/modules/auth.ts`, `deploy/server/install.sh`
  Problem: Solange kein Administrator existiert, darf jeder `/auth/setup` aufrufen. Auf einem Internet-Server ist das ein Zeitfenster für Fremde. Lösung: Das Installationsskript erzeugt einen Einrichtungs-Code, der bei der Ersteinrichtung eingegeben werden muss; im Hausnetz-Paket bleibt es wie bisher. Aufwand: ca. ½ Tag. **Freigabe nötig (Anmeldung).**

**MITTEL**

- **M1 – Update-Herkunft** · `src/server/update.ts`: Die Prüfsumme kommt aus derselben Quelle wie das Update (GitHub). Das schützt vor Übertragungsfehlern, nicht vor einem übernommenen GitHub-Konto. Lösung: Signatur im Bau (Ed25519), öffentlicher Schlüssel fest im Programm; zusätzlich 2FA für das GitHub-Konto (organisatorisch). Aufwand ca. 1 Tag. **Freigabe nötig (Deployment).**
- **M2 – Datenbankrechte** · `portable.ts`, `install.sh`: Das Programm arbeitet als Eigentümer aller Tabellen und kann den Schreibschutz deshalb selbst abschalten (H1 nutzt das). Lösung: eigene Datenbankrolle ohne Rechte zum Ändern der Tabellen; Migrationen mit der Eigentümer-Rolle. Aufwand ca. 1 Tag. **Freigabe nötig (Datenbank).**
- **M3 – Sicherungen unverschlüsselt** · `backup.ts`, `portable.ts`: Die Sicherungsdateien enthalten alle Gast- und Rechnungsdaten im Klartext (auch auf USB/NAS). Art. 32 DSGVO verlangt angemessenen Schutz. Lösung: Sicherungen verschlüsseln (Schlüssel getrennt aufbewahren) oder nur auf verschlüsselten Datenträgern (BitLocker). Aufwand ca. 1 Tag. **Freigabe nötig (Sicherung/Betrieb).**
- **M4 – Speicherfristen fehlen** für: Änderungsprotokoll (mit IP-Adressen und Vorher/Nachher-Daten), E-Mail-Versandprotokoll, Gäste ohne Rechnung, Buchungen ohne Rechnung, Tischreservierungen, Tagungs-/Feieranfragen; nur der Posteingang hat eine einstellbare Frist. Lösung: Löschkonzept (siehe C.3) mit automatischem, protokolliertem Lauf. Aufwand 1–2 Tage. **Freigabe nötig (Löschlogik).**
- **M5 – Meldeschein für alle Gäste**: Seit 01.01.2025 entfällt die besondere Meldepflicht für deutsche Staatsangehörige (BEG IV, §§ 29, 30 BMG). Das Programm verlangt die Angaben weiterhin von allen. Lösung: Meldeschein nur bei nicht deutscher Staatsangehörigkeit; **vorher klären, ob die Gemeinde (Kurtaxe/Gästebeitrag) die Angaben weiter verlangt.** Aufwand ca. ½ Tag. **Entscheidung nötig (Geschäftsprozess).**
- **M6 – Zweiter Faktor freiwillig**: Für den Internetbetrieb sollte er für Administratoren Pflicht sein. Lösung: Einstellung „Zwei-Faktor für Administratoren verlangen“. Aufwand ½ Tag. **Freigabe nötig (Anmeldung).**
- **M7 – E-Rechnung für Hotelrechnungen**: Hotelrechnungen entstehen als PDF; eine E-Rechnung (ZUGFeRD) muss man im Bereich E-Rechnung gesondert erzeugen. Pflicht zur Ausstellung an Unternehmen (B2B, über 250 €) ab 01.01.2027 bei Vorjahresumsatz über 800 000 €, sonst ab 01.01.2028 (D). Lösung: Firmenrechnungen automatisch als ZUGFeRD ausgeben; die erzeugten Dateien einmal mit einem offiziellen Prüfprogramm (KoSIT-Validator) prüfen lassen. Aufwand 1–2 Tage. Rechtzeitig vor 2027/2028.

**NIEDRIG**

- N1–N4 behoben (Abschnitt F).
- **N5** Benutzernamen erratbar: Die Meldung „Zu viele Fehlversuche“ erscheint nur bei vorhandenen Konten. Lösung: einheitliche Meldung. **Freigabe nötig (Anmeldung).**
- **N6** Adressabfrage: theoretisches Zeitfenster zwischen DNS-Prüfung und Abruf (DNS-Rebinding). Nur für angemeldete Benutzer erreichbar.
- **N7** Entwicklungswerkzeug drizzle-kit zieht ein altes esbuild nach (nur Entwicklungsrechner).
- **N8** Im Startseiten-Modus („Gästeseite als Startseite“) liest die Seite das gespeicherte Farbschema, bevor sie weiß, ob ein Gast oder ein Mitarbeiter kommt. Unbedenklich, aber unnötig.
- **N9** Die Inhaltsrichtlinie (CSP) erlaubt Inline-Stile (`'unsafe-inline'` für style-src); für die Gestaltung nötig, kein Skript-Risiko.

---

## C. Datenschutz und DSGVO

### C.1 Gespeicherte personenbezogene Daten

| Daten | Zweck | Mögliche Rechtsgrundlage (eigene Einordnung) |
|---|---|---|
| Gast: Name, Anschrift, E-Mail, Telefon, Firma | Buchung, Rechnung, Kommunikation | Art. 6 Abs. 1 lit. b DSGVO (Vertrag), lit. c (Rechnung) |
| Gast: Geburtsdatum, Staatsangehörigkeit, Ausweisnummer | Meldeschein | lit. c i. V. m. §§ 29, 30 BMG – nur soweit Pflicht besteht (M5) |
| Buchungen, Zimmer, Preise, Zahlungen, Rechnungen | Vertrag, Steuer | lit. b, lit. c (AO, UStG) |
| Firmenkunden, Ansprechpartner | Vertrag | lit. b, lit. f |
| Tischreservierungen, Anfragen der Gästeseite, E-Mails im Posteingang | Anbahnung | lit. b (vorvertraglich) |
| Änderungsprotokoll mit IP, Sitzungen mit IP/Browser | Sicherheit, Nachvollziehbarkeit | lit. c (GoBD-Nachvollziehbarkeit), lit. f |
| Mitarbeiter: Name, Benutzername, Anmeldezeiten | Zugangsschutz | § 26 BDSG / Art. 88 DSGVO (Beschäftigtendaten) – *Nicht aktuell verifiziert* |
| Geräte im Hausnetz (MAC-Adressen, Namen) | Netzbetreuung | lit. f; können Gäste/Mitarbeiter betreffen |

Besondere Kategorien (Art. 9 DSGVO, z. B. Gesundheit) werden nicht gezielt erhoben. Achtung: Freitext-Felder (Bemerkungen, Nachrichten) können solche Daten enthalten (z. B. Allergien, Barrierefreiheit) – organisatorisch sparsam halten.

### C.2 Betroffenenrechte (technischer Stand)

| Recht | Stand |
|---|---|
| Auskunft (Art. 15) | vorhanden: Export je Gast als Datei (Gast → Export) |
| Berichtigung (Art. 16) | vorhanden: Gast bearbeiten (mit Protokoll) |
| Löschung (Art. 17) | vorhanden: Gast anonymisieren – Rechnungen bleiben (Aufbewahrungspflicht), Protokolleinträge werden geschwärzt |
| Einschränkung (Art. 18) | **nicht vorhanden** – kein Sperrvermerk; organisatorisch lösbar (Bemerkung + keine Nutzung), technisch Aufwand ½ Tag |
| Datenübertragbarkeit (Art. 20) | Export ist maschinenlesbar (JSON) |
| Widerspruch (Art. 21) | betrifft v. a. Werbung – das Programm macht keine Werbung; Nachricht vor Anreise ist vertragsbezogen |

### C.3 Vorschlag Lösch- und Aufbewahrungskonzept (Freigabe nötig, M4/H2)

| Daten | Frist (Vorschlag) | Grundlage |
|---|---|---|
| Rechnungen, Stornobelege, Zahlungen, Rechnungs-PDFs | 8 Jahre ab Ende des Ausstellungsjahres; danach löschbar | § 14b UStG, § 147 Abs. 3 AO (BEG IV) |
| Bücher/Aufzeichnungen (z. B. Export für die Buchhaltung) | 10 Jahre | § 147 AO; Aufzeichnungen nach § 22 UStG bleiben 10 Jahre |
| Meldeschein-Angaben | 1 Jahr ab Abreise, Vernichtung binnen 3 Monaten | § 30 Abs. 4 BMG |
| Buchungen ohne Rechnung, Gäste ohne Rechnung | z. B. 3 Jahre nach letztem Aufenthalt (Verjährung) – Vorschlag, keine gesetzliche Vorgabe | Art. 5 Abs. 1 lit. e DSGVO |
| Tischreservierungen | z. B. 6 Monate | Vorschlag |
| Anfragen ohne Buchung (Posteingang, Gästeseite) | z. B. 6–12 Monate | Vorschlag; Frist im Posteingang bereits einstellbar |
| Änderungsprotokoll | so lange wie die betroffenen Belege (GoBD-Nachvollziehbarkeit); IP-Adressen nach 6 Monaten kürzen | Vorschlag |
| Sicherungen | 30 Tage rollierend (bereits so) – Löschungen wirken in Sicherungen erst nach Ablauf | im Löschkonzept dokumentieren |

Jede automatische Löschung sollte protokolliert werden (wie viele Datensätze, wann), ohne die gelöschten Inhalte erneut zu speichern.

### C.4 Gästeseite

| Prüfpunkt | Stand |
|---|---|
| Cookies für Besucher | **keine** – das Sitzungs-Cookie entsteht erst bei der Anmeldung von Mitarbeitern |
| Browser-Speicher | **kein Zugriff** auf den öffentlichen Seiten (seit 1.55.1, § 25 TDDDG) |
| Externe Schriften, Skripte, Bilder, Tracking | **keine** – alles vom eigenen Server |
| Google Maps | nur ein Link, der erst beim Klick Google öffnet – kein eingebettetes Kartenfenster |
| Formulare | Pflichtfelder sparsam; Datenschutzhinweis mit Haken; Link zur Datenschutzerklärung |
| Datenschutzerklärung, Impressum | werden nur verlinkt – **Inhalt muss extern erstellt und geprüft werden** |
| Server-Protokolle | das Programm schreibt keine Zugriffsprotokolle der Besucher; Caddy schreibt standardmäßig keine Zugriffsprotokolle – *Konfiguration auf dem Server prüfen* |
| Einwilligungsbanner | nach jetzigem Stand nicht nötig, da nichts einwilligungsbedürftig ist (eigene Einordnung) |

### C.5 Organisatorisch offen

- Vertrag zur Auftragsverarbeitung mit Hetzner (Server), E-Mail-Anbieter (GMX o. a.), ggf. Steuerberatung/DATEV.
- Verzeichnis der Verarbeitungstätigkeiten (Art. 30 DSGVO).
- Datenschutzerklärung der Website und Informationen für Gäste (Art. 13 DSGVO), z. B. auf Meldeschein/Buchungsbestätigung.
- Verpflichtung der Mitarbeiter auf Vertraulichkeit, kurze Einweisung.
- Ablauf für Datenpannen (Meldung binnen 72 Stunden, Art. 33 DSGVO).
- Prüfen, ob ein Datenschutzbeauftragter nötig ist (§ 38 BDSG; Schwelle – *Nicht aktuell verifiziert*).

---

## D. Gesetzliche Anforderungen

Stand der Recherche: 15.11.2026. „Verifiziert“ heißt hier: durch mehrere übereinstimmende Quellen gestützt, davon mindestens eine amtliche oder der Gesetzestext; der Wortlaut wurde nicht in jedem Fall vollständig gelesen.

| Vorschrift | Inhalt (Kurz) | Quelle | Prüfstand | Umsetzung im Programm | Lücke |
|---|---|---|---|---|---|
| §§ 29, 30 BMG i. d. F. BEG IV (ab 01.01.2025) | Besondere Meldepflicht nur noch für Gäste ohne deutsche Staatsangehörigkeit; Meldeschein 1 Jahr aufbewahren, binnen 3 Monaten vernichten; elektronische Erhebung nur mit Zustimmung | [gesetze-im-internet § 30 BMG](https://www.gesetze-im-internet.de/bmg/__30.html), [IHA-FAQ Hotelmelderecht 2025](https://hotellerie.de/fileadmin/user_upload/Dokumente/Merkblaetter/Hotelverband_Deutschland_IHA_FAQ_Hotelmelderecht_ab_Januar_2025.pdf), [Haufe](https://www.haufe.de/recht/weitere-rechtsgebiete/wirtschaftsrecht/meldepflicht-in-beherbergungsstaetten_210_639508.html) | verifiziert (Sekundärquellen + Gesetzesseite); aktueller Änderungsstand widersprüchlich angegeben | Meldeschein Druck und online, Ausweisnummer „nur ausländische Gäste“ | H2, M5 |
| § 147 AO, § 257 HGB | Buchungsbelege 8 Jahre (seit 2025), Bücher 10 Jahre | [lxgesetze § 147 AO](https://lxgesetze.de/ao/147), [Haufe BEG IV](https://www.haufe.de/steuern/gesetzgebung-politik/viertes-buerokratieentlastungsgesetz_168_613390.html) | verifiziert über Sekundärquellen; Änderung für Banken/Versicherer gemeldet, für das Hotel ohne Belang – **Wortlaut nicht eingesehen** | Rechnungen unveränderbar gespeichert | H1 |
| § 14b UStG | Rechnungen 8 Jahre aufbewahren (seit 2025); § 22 UStG-Aufzeichnungen 10 Jahre | [gesetze-im-internet § 14b UStG](https://www.gesetze-im-internet.de/ustg%5F1980/__14b.html), [Ebner Stolz zum BMF-Schreiben 08.07.2025](https://www.ebnerstolz.de/de/unser-angebot/leistungen/steuerberatung/umsatzsteuer/bmf-zu-aenderungen-umsatzsteuergesetz-2024-91644.html) | verifiziert über Sekundärquellen | wie oben | H1 |
| § 14 UStG, § 27 Abs. 38 UStG, BMF-Schreiben zur E-Rechnung | Empfang seit 2025; Ausstellung B2B ab 2027 (Umsatz > 800 000 €) bzw. 2028; Kleinbetragsrechnungen ≤ 250 € ausgenommen | [IHK Stuttgart](https://www.ihk.de/stuttgart/fuer-unternehmen/recht-und-steuern/steuerrecht/steuermeldungen/e-rechnungen-5864496), [IHK Köln zum BMF-Schreiben 15.10.2025](https://www.ihk.de/koeln/hauptnavigation/recht-steuern/steuern/bmf-schreiben-zur-e-rechnung-vom-15-10-2025-6774012) | Sekundärquellen; Daten der BMF-Schreiben teils widersprüchlich – **BMF-Originale nicht eingesehen** | ZUGFeRD-Erzeugung im Bereich E-Rechnung, PDF-Auslesen | M7; Prüfung mit offiziellem Validator *Nicht getestet* |
| GoBD (BMF-Schreiben, zuletzt geändert 14.07.2025) | Unveränderbarkeit, Nachvollziehbarkeit, Aufbewahrung, E-Rechnung: strukturierter Teil (XML) aufbewahren | [DATEV zur Änderung 14.07.2025](https://www.datev.de/web/de/nachrichten/gesetzliche-themen/gobd/aenderungen-der-gobd-vom-14-juli-2025/), [KPMG](https://kpmg.com/de/de/themen/2025/07/bmf-gobd-zweite-aenderung.html) | Sekundärquellen – **BMF-Original nicht eingesehen** | Schreibschutz per Trigger, Storno nur über Stornobeleg, Protokoll, unveränderbares Rechnungs-PDF, CSV-Export | H1; Verfahrensdokumentation fehlt (organisatorisch) |
| § 146a AO, KassenSichV, AEAO zu § 146a | Aufzeichnungssysteme mit Kassenfunktion: TSE, Belegausgabe, DSFinV-K; Mitteilung über ELSTER seit 01.01.2025 | [OFD Karlsruhe zur Mitteilungspflicht](https://finanzamt-bw.fv-bwl.de/,Lde/22792103), [Finanzamt NRW](https://www.finanzamt.nrw.de/en/node/1790), [AEAO § 146a (LfSt Bayern, Stand 2023)](https://www.lfst.bayern.de/fileadmin/RESSOURCEN/INFORMATIONEN/Steuerinfos/Weitere_Themen/Elektronische_Kassensysteme/2023-06-30-AEAO-Par-146-AO.pdf) | Mitteilungspflicht verifiziert (amtliche Seiten); **Abgrenzung „Kassenfunktion“ für Hotelsoftware nicht abschließend geklärt**; neuere AEAO-Fassungen (2026, ab 2029) gemeldet, nicht eingesehen | TSE-Aufzeichnung optional (Kassenbeleg-V1) | H3 |
| § 25 TDDDG | Zugriff auf Endgerät nur mit Einwilligung oder wenn unbedingt erforderlich | [gesetze-im-internet § 25 TTDSG/TDDDG](https://www.gesetze-im-internet.de/ttdsg/__25.html), [DSK-Orientierungshilfe Digitale Dienste](https://datenschutzkonferenz-online.de/media/oh/OH_Digitale_Dienste.pdf) | Gesetzestext verifiziert; Änderung vom 10.03.2026 gemeldet, nicht eingesehen | keine Cookies/kein Speicherzugriff auf öffentlichen Seiten | erfüllt (eigene Einordnung) |
| DSGVO Art. 5, 6, 13, 15–21, 30, 32, 33; BDSG | Grundsätze, Rechtsgrundlagen, Betroffenenrechte, Sicherheit | EUR-Lex (nicht abgerufen) | **Nicht aktuell verifiziert** (allgemeiner Kenntnisstand) | siehe C | M3, M4, C.5 |

---

## E. Maßnahmenplan

| Prio | Maßnahme | Aufwand | Freigabe |
|---|---|---|---|
| 1 | H3 mit der Steuerberatung klären: Barzahlungen im PMS ja/nein; TSE-/Kassenpflicht | Gespräch | **Ihre Entscheidung** |
| 2 | H1 „Daten löschen“ ab Stichtag für Rechnungen sperren | ½ Tag | **ja (Löschlogik/Rechnungen)** |
| 3 | H2 Meldeschein-Angaben nach Frist automatisch leeren | 1 Tag | **ja (Löschlogik)** |
| 4 | H4 Einrichtungs-Code für Internet-Server | ½ Tag | **ja (Anmeldung)** |
| 5 | M5 Meldeschein nur ausländische Gäste (nach Klärung Kurtaxe) | ½ Tag | **Ihre Entscheidung** |
| 6 | M6 Zwei-Faktor für Administratoren erzwingbar | ½ Tag | **ja (Anmeldung)** |
| 7 | M4 Lösch- und Aufbewahrungskonzept umsetzen | 1–2 Tage | **ja (Löschlogik)** |
| 8 | M3 Sicherungen verschlüsseln | 1 Tag | **ja (Betrieb)** |
| 9 | M2 eigene Datenbankrolle | 1 Tag | **ja (Datenbank)** |
| 10 | M1 signierte Updates + 2FA GitHub | 1 Tag | **ja (Deployment)** |
| 11 | M7 Firmenrechnungen automatisch als E-Rechnung, Validator-Prüfung | 1–2 Tage | vor 2027 |
| 12 | Einschränkung der Verarbeitung (Art. 18) als Sperrvermerk | ½ Tag | ja |
| 13 | N5 einheitliche Anmelde-Fehlermeldung | 1 Std. | ja (Anmeldung) |
| 14 | Organisatorisches aus C.5, Verfahrensdokumentation GoBD | extern | – |
| 15 | Penetrationstest durch Fachleute vor dem Internetbetrieb | extern | – |

---

## F. Implementierte Korrekturen (Version 1.55.1)

| Nr. | Korrektur | Dateien | Test |
|---|---|---|---|
| N1 | Zusätzliche Sicherheits-Header: `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`; `Strict-Transport-Security` nur im HTTPS-Betrieb | `src/server/app.ts` | `tests/security.test.ts` „setzt die Sicherheits-Header …“ – bestanden; Browserprüfung im Paket |
| N2 | Öffentliche Seiten (`/willkommen`, `/anfrage`, `/gast/…`, `/buchung/…`) greifen nicht mehr auf den Browser-Speicher zu (§ 25 TDDDG) | `web/src/main.tsx` | Browserprüfung: 0 Zugriffe auf öffentlichen Seiten, Verwaltung unverändert |
| N3 | Datenbank-Passwort bei Sicherung und Wiederherstellung über die Umgebung statt in der Befehlszeile | `src/server/portable.ts` | Sicherung im Paket erfolgreich (258 kB, lesbar geprüft); Wiederherstellung prüft der Windows-Bau |
| N4 | Deutsche Standard-Fehlermeldungen in Server und Oberfläche (keine englischen Muster mehr in Antworten) | `src/shared/zod-de.ts`, `src/server/app.ts`, `web/src/zod-config.ts` | `tests/security.test.ts` „meldet Eingabefehler auf Deutsch …“ – bestanden |

Sicherungspunkt vor den Änderungen: Git-Markierung `vor-audit-2026-11`.

---

## G. Testergebnisse

| Test | Was geprüft | Ergebnis |
|---|---|---|
| Automatische Tests (Vitest, echte Datenbank) | 171 Tests in 20 Dateien, darunter Sicherheitsprüfung aller Routen | **bestanden** |
| Sicherheitstest „alle Adressen ohne Anmeldung“ | ≈ 160 Routen automatisch aus dem Routenbaum | bestanden – nur öffentliche Adressen antworten |
| Sicherheitstest „Benutzer ohne Rechte“ | alle Routen | bestanden |
| Anmelde-Bremse, Herkunftsprüfung, Ersteinrichtung, Fehlermeldungen, Header | gezielte Tests | bestanden |
| Abhängigkeiten (`npm audit`) | ausgeliefertes Programm / Entwicklung | 0 / 4 mittlere (nur Entwicklung) |
| Statische Analyse (Semgrep 1.185, eigener Regelsatz) | SQL-Raw, Shell, eval, innerHTML, SSRF, Pfade, Zufall | 0 echte Befunde (alle Treffer geprüft) |
| Statische Analyse mit offiziellen Semgrep-Regelsammlungen (OWASP, Node, React) | – | **Nicht getestet** (Download in der Prüfumgebung gesperrt) |
| Geheimnis-Suche Repository + Git-Historie | Musterprüfung | keine echten Geheimnisse |
| Prüfung von außen gegen das laufende Paket | Header, 8 Pfad-Manipulationen, kaputtes JSON, `__proto__`, 3 MB, falsche Tokens, CORS | bestanden |
| Seitenprüfung | 40 Seiten × 2 Bildschirmgrößen | keine Auffälligkeiten |
| Sicherung im Paket | `pms --backup` | erfolgreich |
| Wiederherstellung, Update unter Windows | Windows-Bau (GitHub Actions) | wird mit 1.55.1 geprüft |
| Penetrationstest durch Fachleute | – | **Nicht getestet** |
| Lasttest | – | **Nicht getestet** (nicht freigegeben) |
| E-Rechnung gegen offiziellen Validator (KoSIT) | – | **Nicht getestet** |
| TSE, EC-Gerät, Drucker, FRITZ!Box mit echten Geräten | – | **Nicht getestet** |
| Server-Konfiguration bei Hetzner | – | **Nicht getestet** (noch nicht vorhanden) |

---

## H. Offene Risiken

- Alle Befunde H1–H4, M1–M7, N5–N9 (Abschnitt B.3) – warten auf Freigabe oder Entscheidung.
- Rechtliche Bewertungen beruhen teilweise auf Sekundärquellen; Originaltexte von BMF-Schreiben und AEAO wurden nicht eingesehen. Steuerberatung und Datenschutzberatung müssen bestätigen.
- Die Abgrenzung „Kassenfunktion“ (H3) ist die größte offene Rechtsfrage.
- Kurtaxe/Gästebeitrag der Gemeinde kann den Meldeschein für alle Gäste weiter verlangen (M5).
- Verhalten mit echten Geräten (TSE, EC-Gerät) ist ungeprüft; Fehler dort betreffen Zahlungen.
- Der Internetbetrieb (Hetzner, Caddy, Firewall, Updates des Betriebssystems) ist noch nicht eingerichtet und daher ungeprüft.

## I. Produktionsfreigabe (technische Einschätzung, keine rechtliche Freigabe)

| Betriebsart | Status | Begründung |
|---|---|---|
| Betrieb im Hausnetz (Windows-PC) | **Technisch weitgehend vorbereitet** | keine kritischen Sicherheitslücken; offene Compliance-Punkte H1–H3 vor echtem Rechnungsbetrieb klären |
| Betrieb im Internet (Hetzner) | **Bereit für weitere Tests** | H4, M1, M3, M6 sollten vorher umgesetzt, der Server eingerichtet und von Fachleuten geprüft sein |

Erforderlich bleiben: Steuerberatung (H1, H3, M7, GoBD-Verfahrensdokumentation), Datenschutzberatung (C, Löschkonzept, Datenschutzerklärung), Penetrationstest vor dem Internetbetrieb.
