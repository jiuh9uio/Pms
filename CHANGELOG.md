# Versionen

Der Abschnitt einer Version erscheint im Programm unter Einstellungen → Programm-Update.
Eine neue Version wird veröffentlicht, sobald die Versionsnummer in `package.json` erhöht wird.

## 1.13.0

- Schnelldruck: neuer Zettel „Bitte um Google-Bewertung“ zum Anheften an die Rechnung – mit Sternen, großer Überschrift, kurzem Text und QR-Code, der direkt zur Bewertungsseite führt. Link und Texte trägt der Administrator über „ändern“ ein.

## 1.12.0

- Neuer Bereich „Schnelldruck“: Info-Zettel für Gäste auf Knopfdruck aus dem Bondrucker – Öffnungszeiten mit Adresse und Telefon, WLAN-Zugang mit QR-Code, eigene Zettel (z. B. Taxi, Notdienst) und freier Text; bis zu fünf Ausdrucke auf einmal.
- Einstellungen → Hotel: neues Feld „Öffnungszeiten“. Einstellungen → „Bondrucker vorne“: eigener Drucker für Theke oder Empfang; ohne ihn druckt der Schnelldruck auf dem Küchendrucker.
- Für bereits angelegte Benutzer den Bereich bitte unter Verwaltung → Benutzer freigeben.

## 1.11.0

- Küchendrucker: Die Frühstücksliste kann sich täglich zu einer festen Uhrzeit von selbst drucken (Einstellungen → Küchendrucker → „Frühstücksliste täglich drucken um“).
- Restaurant: Die Tischreservierungen des Tages lassen sich mit „An Küche senden“ auf dem Küchendrucker ausgeben.

## 1.10.0

- Hotel → „Frühstück“: Liste, welche Zimmer am Morgen frühstücken (Gast, Erwachsene, Kinder, Hinweise) mit Gesamtzahl der Frühstücksgäste. Mit „An Küche senden“ druckt das Programm die Liste auf einem Epson-Bondrucker im Netzwerk.
- Einstellungen → „Küchendrucker“: IP-Adresse, Port und Papierbreite des Epson-Druckers, mit Testdruck.

## 1.9.0

Bereich „Internet“ erweitert:

- Gäste-WLAN: Name und Passwort hinterlegen, das Programm erzeugt einen QR-Code und einen Aushang zum Drucken. Gäste scannen und sind verbunden.
- Ausfallprotokoll: Das Programm prüft alle zwei Minuten die Internetverbindung und hält Ausfälle mit Beginn, Ende und Dauer fest – z. B. als Beleg für den Anbieter.
- Geräte im Netz: benannte Geräte, die gerade nicht antworten (z. B. Drucker aus), erscheinen als „nicht erreichbar“; der Router ist markiert und seine Oberfläche per Link erreichbar.

## 1.8.0

- Verwaltung → Benutzer: Der Benutzername lässt sich jetzt ändern (das Passwort bleibt dabei gleich). Passwort zurücksetzen wie bisher im selben Dialog.
- Passwort vergessen: Im Programmordner erzeugt „Passwort vergessen.bat“ ein neues Passwort für einen Benutzer – auch für den Administrator.

## 1.7.0

- Neuer Bereich „Restaurant“: Tischreservierungen je Tag mit Uhrzeit, Personenzahl, Name, Telefon und Bemerkung; Status „Gäste da“, „Tisch frei“, „Nicht erschienen“, Storno; Tagesliste zum Ausdrucken. Tische legt der Administrator an; ein Tisch kann zur selben Zeit nur einmal reserviert werden. Für bereits angelegte Benutzer bitte unter Verwaltung → Benutzer freigeben.

## 1.6.0

- Neuer Menüpunkt „Internet“ im Startmenü: prüft die Internetverbindung des Rechners und zeigt die Geräte im Hausnetz (bisher unter Verwaltung). Administratoren sehen ihn immer; für Benutzer lässt er sich unter Verwaltung → Benutzer freigeben.

## 1.5.0

- Verwaltung → „Geräte im Netz“ (nur Administrator): zeigt, welche Geräte gerade im selben Netz wie der PMS-Rechner erreichbar sind (IP-Adresse, Gerätename, Geräteadresse). Geräte lassen sich benennen, z. B. „Kasse“ oder „Drucker“. Geräte in einem getrennten Gäste-WLAN sind nicht sichtbar.

## 1.4.0

- Preise nach Personenzahl: je Zimmerkategorie Nachlass bei Einzelbelegung sowie Aufpreis je zusätzlichem Erwachsenen und je zusätzlichem Kind (Zimmer & Preise → Kategorie bearbeiten). Bestehende Preise ändern sich nicht, solange dort nichts eingetragen ist.
- Einstellungen → „Zugriff im Hausnetz“ zeigt die Adresse für Tablets und weitere Rechner. Neu im Programmordner: „Firewall freigeben.bat“.

## 1.3.0

- Meldeschein per QR-Code: In der Reservierung „Meldeschein per QR“ wählen, der Gast scannt den Code und trägt seine Angaben am eigenen Handy ein (deutsch/englisch). Die Angaben landen im Gästeprofil und auf dem gedruckten Meldeschein. Das Handy muss dafür im WLAN des Hauses sein.

## 1.2.0

- Kontrollen → Hygieneamt: neue Wareneingangskontrolle (Lieferant, Ware, Temperatur, in Ordnung/beanstandet) mit Monatsliste zum Ausdrucken.
- Reservierung: Meldeschein zum Ausdrucken und Unterschreiben, vorausgefüllt aus dem Gästeprofil.
- Rechnung: Zahlungserinnerung per E-Mail für überfällige offene Rechnungen (ohne Mahngebühren und Mahnstufen).
- Die Auswertung lässt sich jetzt drucken.

## 1.1.0

- Datensicherung: läuft jetzt einmal täglich von selbst, solange das Programm geöffnet ist. Stand und Knopf „Jetzt sichern“ unter Einstellungen → Datensicherung; Warnung im Startmenü, wenn die letzte Sicherung älter als drei Tage ist. Optional Kopie auf einen zweiten Datenträger (BACKUP_COPY_DIR in pms.env).
- E-Mail an Gäste: Reservierungsbestätigung direkt aus der Reservierung und Rechnung als PDF direkt aus der Rechnung senden. Der vorgeschlagene Text lässt sich vor dem Senden ändern. Voraussetzung: Postfach unter Einstellungen → E-Mail-Versand.
- Auswertung (Bereich Hotel): Zimmernächte, Auslastung, gebuchter Logisumsatz und Rechnungssumme je Monat.

## 1.0.0

- Erste Version mit automatischem Programm-Update (Einstellungen → Programm-Update).
- Bereiche: Hotel, Kontrollen (Temperatur- und Reinigungsprotokoll), E-Rechnung (ZUGFeRD), Verwaltung.
