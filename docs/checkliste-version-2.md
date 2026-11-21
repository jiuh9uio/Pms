# Checkliste bis Version 2.0

Diese Punkte lassen sich nur bei Ihnen im Haus prüfen – mit dem echten Postfach, den echten Geräten und Ihren Fachleuten.
Bitte abhaken und bei jedem „geht nicht“ kurz notieren, was Sie gesehen haben (am besten mit Foto).

Stand der Vorprüfung (Testumgebung, erfundene Daten) steht am Ende.

## 1. E-Mail mit dem echten Postfach

- [ ] „Jetzt abrufen“ holt neue E-Mails ab; im Postfach selbst ist danach nichts verändert.
- [ ] Eine eigene Test-E-Mail (von einer privaten Adresse) erscheint im Posteingang unter „Neu“.
- [ ] Einsortieren: Art wählen → „In Vorgänge verschieben“ → der Vorgang öffnet sich.
- [ ] Antworten aus dem Vorgang kommt beim Empfänger an; die Vorgangsnummer steht im Betreff.
- [ ] Auf diese Antwort zurückschreiben: Die Rückantwort landet im selben Vorgang (auch wenn Sie den Betreff ändern).
- [ ] Eine E-Mail mit Anhang (PDF): Der Anhang lässt sich im Vorgang herunterladen.
- [ ] Anfrage über das Kontaktformular Ihrer Internetseite: Der Vorgang zeigt den Namen und die Adresse des Kunden, nicht „MyWebsite“.
- [ ] Absender ausfiltern (z. B. Werbung): Die nächste E-Mail dieses Absenders landet unter „Ignoriert“.
- [ ] Kostenvoranschlag senden → mit „Ja“ antworten: Im Kostenvoranschlag steht „Kunde hat mit Ja geantwortet“.
- [ ] Bestätigung aus einer Reservierung senden: erscheint unter Vorgänge → „Erledigt“.

## 2. Geräte

- [ ] Bondrucker: Probedruck, Temperaturprotokoll als Bon.
- [ ] EC-Gerät: eine Kartenzahlung über einen kleinen Betrag; die Zahlung wird erst nach „erfolgreich“ gebucht.
- [ ] TSE: Zahlung wird signiert (Hinweis an der Zahlung).
- [ ] FRITZ!Box: Anzeige der Verbindung, Neustart mit Zeitanzeige.
- [ ] Drucker: Rechnung, Kostenvoranschlag und Angebot auf Papier (Rand, Logo, Fensterumschlag).

## 3. Rechnungen – bitte dem Steuerberater vorlegen

- [ ] Beispielrechnung mit einem Steuersatz und eine mit zwei Steuersätzen (7 % und 19 %).
- [ ] Beschriftung „Einzelpreis brutto“, „Gesamt brutto“, „Nettobetrag“, „Enthaltene Umsatzsteuer“, „Gesamtbetrag brutto“ in Ordnung?
- [ ] „Leistungsdatum“ / „Leistungszeitraum“ in Ordnung?
- [ ] Ein Nummernkreis für Hotelrechnungen und freie Rechnungen in Ordnung?
- [ ] Rechnung an eine Firma (mit USt-IdNr.) in Ordnung?
- [ ] Export für die Buchhaltung: Die Konten sind nur Vorschläge – bitte abstimmen.
- [ ] Entscheidung: Ab wann sollen ausgestellte Rechnungen nicht mehr gelöscht werden können? (Die Sperre ist bisher bewusst aus.)

## 4. Datenschutz und Hygiene

- [ ] Aufbewahrungsfristen für E-Mails, Vorgänge und Meldescheine mit dem Datenschutz abstimmen.
- [ ] Gesamtexport der Eigenkontrolle (Temperaturen, Reinigung, Wareneingang) dem Hygieneamt oder Berater zeigen: genügt die Form?

## 5. Sicherheit des Betriebs

- [ ] Datensicherung: Unter Einstellungen steht eine Sicherung von heute.
- [ ] Zweiter Ort für die Sicherung eingerichtet (USB-Laufwerk oder Netzlaufwerk)?
- [ ] Einmal zurückspielen – am besten auf einem zweiten Rechner: `pms.exe --restore backups\pms-JJJJMMTT-HHMMSS.dump --ja` (das Programm muss dabei beendet sein). Danach prüfen: letzte Reservierung, letzte Rechnung, letzter Vorgang vorhanden?
- [ ] Programm-Update von der bisherigen auf die neueste Version; danach kurz Reservierung, Rechnung und Vorgang öffnen.

## 6. Alltag

- [ ] Jeder Mitarbeiter meldet sich einmal mit seinem eigenen Benutzer an und sieht die Bereiche, die er braucht – und keine, die er nicht sehen soll.
- [ ] Am Handy oder Tablet: Reservierung anlegen, Vorgang öffnen, Temperatur eintragen.
- [ ] Zwei bis vier Wochen Betrieb ohne grundsätzlichen Fehler.

---

## Vorprüfung in der Testumgebung (Version 1.146.0)

Geprüft mit erfundenen Daten, ohne echtes Postfach und ohne Geräte:

- **Sicherung zurückspielen:** Sicherung erstellt, Datenbank absichtlich verändert, Sicherung zurückgespielt – alle 61 Tabellen stimmen in Zeilenzahl und Inhalt mit dem Original überein; die Schutzregeln für ausgestellte Rechnungen sind danach vorhanden. Geprüft mit denselben Befehlen wie die Windows-Version, aber unter Linux – der Ablauf mit `pms.exe` selbst ist nicht getestet.
- **Alle Seiten automatisch durchgesehen** als Administrator und als Mitarbeiter (Hotel, Restaurant, Vorgänge, Kontrollen), in vier Bildschirmgrößen, hell und dunkel: kein Absturz, kein Serverfehler, keine Seite breiter als der Bildschirm, kein verweigerter Zugriff in der Mitarbeiter-Ansicht.
- **PDF:** Rechnung in den Layouts „modern“ und „elegant“; Kostenvoranschlag mit 45 Positionen über vier Seiten (Kopfzeile wird wiederholt, Summen und Seitenzahlen stimmen).
- **Viele Daten:** 3.000 Vorgänge und 12.000 E-Mails – die Liste der Vorgänge antwortet in etwa 0,04 bis 0,12 Sekunden, der Posteingang in etwa 0,01 Sekunden (ein Benutzer, keine Lastprobe; Rechnungen und Reservierungen in dieser Menge nicht gemessen).
- **Automatische Tests:** siehe Versionshinweise.
