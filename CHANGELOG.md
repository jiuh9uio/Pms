# Versionen

Der Abschnitt einer Version erscheint im Programm unter Einstellungen → Programm-Update.
Eine neue Version wird veröffentlicht, sobald die Versionsnummer in `package.json` erhöht wird.

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
