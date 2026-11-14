# Versionen

Der Abschnitt einer Version erscheint im Programm unter Einstellungen → Programm-Update.
Eine neue Version wird veröffentlicht, sobald die Versionsnummer in `package.json` erhöht wird.

## 1.36.0

- E-Rechnung → neuer Reiter „Archiv“: alle erzeugten E-Rechnungen mit Suche (Nummer, Empfänger, Datei, E-Mail-Adresse) und Filtern nach Jahr, Monat, Versand und Herkunft; dazu Anzahl und Summe der Auswahl.
- Herunterladen: die Liste als CSV für Excel und alle Dateien der Auswahl als ein Paket (ZIP mit PDF, XML und Liste) – zum Beispiel für die Steuerberatung.

## 1.35.0

- E-Rechnung: Beim Hochladen liest das Programm die PDF jetzt selbst und füllt die Felder vor – Rechnungsnummer, Rechnungsdatum, Leistungszeitraum, Fälligkeit, Empfänger mit Anschrift und USt-IdNr., Positionen bzw. Beträge je Steuersatz, bereits Bezahltes. Angezeigt wird, was gefunden wurde und worauf zu achten ist.
- Das funktioniert bei PDFs, die aus einem Programm stammen (mit Text in der Datei). Eingescannte Rechnungen oder Fotos erkennt das Programm als solche; eine Texterkennung für Scans ist nicht enthalten.

## 1.34.0

- Digitale Gästemappe (z. B. Gastfreund): Unter Einstellungen → Haus lässt sich die Adresse Ihrer Gästemappe hinterlegen. Das Programm verweist dann darauf – mit einem Bon-Zettel samt QR-Code im Schnelldruck, in der Reservierungsbestätigung und der Nachricht vor der Anreise sowie mit einem Knopf auf der Reservierungsseite des Gastes.
- Das ist ein Verweis; es werden keine Reservierungsdaten an den Anbieter übertragen. Eine spätere echte Anbindung ist im Programm vorbereitet.

## 1.33.1

- Verlauf der Reservierung: Die Einträge zum Gäste-Link (gesperrt, neu ausgestellt, Ankunftszeit oder Storno durch den Gast) stehen jetzt in klarem Deutsch statt als technische Kürzel.

## 1.33.0

- Reservierung → neues Fenster „Gäste-Link“: Link mit QR-Code ansehen, kopieren, per E-Mail an den Gast senden, die Seite selbst ansehen.
- Wenn es ein Problem gibt: Link sperren (der Gast sieht dann nichts mehr), wieder freigeben oder neu ausstellen – der alte Link ist danach endgültig ungültig.
- Einstellungen → Algorithmen → Storno: einstellbar, was der Gast sieht – Gesamtbetrag ja/nein, Ankunftszeit und Nachricht ja/nein, eigener Begrüßungstext.

## 1.32.1

- Gäste-Link zusätzlich abgesichert: Der Link allein zeigt nichts mehr. Der Gast gibt seinen Nachnamen und – wenn bei ihm hinterlegt – seine Postleitzahl ein; erst dann öffnet sich die Reservierung. Nach acht falschen Eingaben ist der Link 15 Minuten gesperrt.

## 1.32.0

- Stornobedingungen (Einstellungen → Algorithmen → Storno): kostenfrei bis so viele Tage vor der Anreise, danach ein Anteil des Zimmerpreises. Die Bedingungen stehen in der Reservierungsbestätigung, in der Reservierung und auf der Seite des Gastes.
- Gäste-Link: Jede Reservierung hat einen persönlichen Link (auch als QR-Code, in der Reservierung unter „Angaben“). Der Gast sieht dort seine Buchung, teilt Ankunftszeit und eine Nachricht mit und kann – wenn Sie es erlauben – selbst stornieren. Das Zimmer wird dabei sofort frei, im Übergabebuch erscheint eine Meldung.
- Eine Ausfallgebühr wird dem Gast vor dem Stornieren angezeigt und Ihnen gemeldet, aber nicht von selbst berechnet.
- Für Gäste zu Hause funktioniert der Link erst, wenn das Programm aus dem Internet erreichbar ist; dann kommt er auch in die Bestätigung und in die Nachricht vor der Anreise.

## 1.31.0

Hotel – Ergänzungen aus dem Vergleich mit großen Hotelprogrammen:

- Optionsfrist: Vorläufige Reservierungen können ein Datum „Option bis“ bekommen. Ist es erreicht, steht die Reservierung in der Übersicht als Aufgabe „bestätigen oder stornieren“. Es wird nichts von selbst storniert.
- Auswertung → Belegungsvorschau: 30 Tage im Voraus je Tag belegte, vorläufige, gesperrte und freie Zimmer, freie Zimmer je Kategorie, An- und Abreisen.
- Auswertung → Herkunft der Gäste: Ankünfte und Übernachtungen je Monat nach Herkunftsland mit Bettenauslastung – die Zahlen, die die amtliche Beherbergungsstatistik abfragt.
- Auswertung → Buchungsquellen: Reservierungen, Nächte und Umsatz je Buchungsquelle. Die Jahresübersicht zeigt zusätzlich den Durchschnittspreis je Nacht und den Umsatz je verfügbarem Zimmer.
- Gäste: mögliche doppelte Gäste finden und zusammenführen (nur Administrator).

## 1.30.0

- Internet wird jetzt jede Minute geprüft (bisher alle zwei Minuten).
- Hinweis bei Ausfall: Fällt das Internet aus, erscheint im Programm ein Hinweisfenster und oben ein roter Balken, bis es wieder da ist. Auf Wunsch zusätzlich als Meldung von Windows. Ein- und ausschaltbar je Gerät unter Internet → Internetverbindung.
- FRITZ!Box automatisch zurücksetzen (einschaltbar): Nach der eingestellten Wartezeit baut das Programm die Internetverbindung neu auf; bleibt das Internet weiter weg, startet es die Box einmal neu. Je Ausfall höchstens diese zwei Schritte, höchstens zwei automatische Neustarts in 24 Stunden.

## 1.29.0

- Internet → Internetverbindung: FRITZ!Box steuern. Wenn das Internet hängt, lässt sich die Verbindung neu aufbauen oder die ganze Box neu starten, ohne an den Router zu gehen; dazu Modell, Laufzeit und Verbindungszustand abfragen.
- Einrichten (nur Administrator): Adresse der Box, ein FRITZ!Box-Benutzer mit dem Recht „FRITZ!Box Einstellungen“ und dessen Kennwort. In der Box muss „Zugriff für Anwendungen zulassen“ eingeschaltet sein. Noch nicht mit einer echten FRITZ!Box erprobt.

## 1.28.2

- Nachlass bei längerem Aufenthalt: Wird eine Reservierung verlängert oder gekürzt und überschreitet dabei die Grenze (z. B. von 1 auf 2 Nächte), werden alle Nächte neu berechnet – der Nachlass gilt dann für den ganzen Aufenthalt bzw. entfällt ganz. Ein eingetragener Sonderpreis bleibt unberührt.
- Handy: Auf den Seiten TSE und EC-Gerät ragten die Schaltflächen über den Bildschirmrand – sie brechen jetzt um.

## 1.28.1

Ergebnis einer Durchsicht der letzten Neuerungen:

- Tagesabschluss: Der Vergleich mit dem gezählten Bargeld rechnete falsch (Faktor 100) und zeigte dadurch eine falsche Abweichung – behoben.
- Nachricht vor der Anreise: Ist der Versand gestört, wird jetzt erst nach einer Stunde wieder versucht statt jede Minute.
- Online-Buchungsanfrage: höchstens 40 Anfragen in 24 Stunden, damit der Posteingang nicht überflutet werden kann.
- E-Mail: „Guten Morgen“ wird nicht mehr als Datum (morgen) gelesen. „Regeln anwenden“ lässt Online-Anfragen unberührt. Die Zimmerbestätigung aus dem E-Mail-Modul verlangt die Freigabe für den Bereich Hotel.

## 1.28.0

- Zimmer & Preise: Je Kategorie lässt sich ein Nachlass je Nacht ab einer Zahl von Nächten einstellen (z. B. ab 2 Nächten 10 € weniger je Nacht). Er gilt für neue Reservierungen und steht bei den Nachtpreisen als „ab 2 Nächten“.
- Einstellungen → Algorithmen → „Gäste-E-Mail“: Nachricht vor der Anreise. Einige Tage vorher bekommt der Gast von selbst eine E-Mail mit Anreisetag, Check-in-Zeit, Anschrift und eigenem Zusatztext – einmal je Reservierung. Von Haus aus ausgeschaltet.
- Team: wiederkehrende Aufgaben (täglich, wöchentlich, monatlich), die am fälligen Tag von selbst als Aufgabe erscheinen.
- Vorbereitung Online-Buchung: öffentliche Seite „Zimmeranfrage“ (/anfrage). Anfragen landen als Zimmeranfrage im Modul E-Mail; gebucht wird dabei nichts. Einzuschalten unter Einstellungen → E-Mail. Für Gäste im Internet erst nutzbar, wenn das Programm von außen erreichbar ist.

## 1.27.0

- Neuer Bereich „Team“ (für alle Benutzer): Übergabebuch, Aufgaben und Reparaturmeldungen mit Lesebestätigung, Fälligkeit und Erledigt-Vermerk. Die Kachel im Startmenü zeigt die Zahl der ungelesenen Einträge.
- Hotel → „Reinigung“: Tagesliste aller Zimmer mit Abreise, Bleiber und Anreise, daraus End- oder Zwischenreinigung, „Fertig“-Knopf und Ausdruck.
- Hotel → „Tagesabschluss“: Zahlungen je Zahlungsart mit Einzelliste, Rechnungen des Tages, offene An- und Abreisen, Vergleich mit dem gezählten Bargeld. Eine Übersicht zum Abgleich – kein Kassenbuch.
- Grundlage ist ein Vergleich mit professionellen Systemen, nachzulesen in docs/marktvergleich.md.

## 1.26.0

- Frühstück: oben eine Vorschau der nächsten sieben Tage mit Zahl der Frühstücksgäste und der jeweils geltenden Regel – für die Personalplanung.
- Startmenü: Die Kachel „E-Mail“ zeigt die Zahl der offenen Anfragen.
- E-Mail-Empfang: Erledigte und ignorierte Nachrichten lassen sich nach 30, 90 oder 365 Tagen von selbst aus dem Programm entfernen (im Postfach bleiben sie).
- Daten löschen: zusätzlich wählbar „E-Mail-Posteingang“.

## 1.25.0

- E-Mail: direkt aus dem Programm antworten. Zu jeder Nachricht gibt es „Antworten“, „Bestätigung senden“ (für die daraus angelegte Zimmer- oder Tischreservierung) und „Absage senden“ – jeweils mit fertigem Textvorschlag, der sich vor dem Senden ändern lässt. Gesendet wird über das unter „E-Mail-Versand“ eingerichtete Postfach.
- Einstellungen → Algorithmen ist jetzt nach Bereichen getrennt: „Frühstück“ und neu „E-Mail“. Dort lässt sich einstellen, dass nur Zimmer- und Tischanfragen im Posteingang erscheinen, dazu eigene Stichwörter und Absender, die nie eine Anfrage sind.

## 1.24.0

- Neues Modul „E-Mail“: Das Geschäftspostfach wird abgerufen (auf Knopfdruck oder automatisch), jede Nachricht als Zimmer-, Tisch- oder sonstige Anfrage eingeordnet, und Datum, Uhrzeit, Personenzahl und Telefon werden als Vorschlag herausgelesen.
- Übernehmen: Tischanfragen werden mit einem Klick zur Tischreservierung; Zimmeranfragen öffnen die Maske „Neue Reservierung“ mit Zeitraum, Name, E-Mail und Telefon. Die Nachricht wird danach als erledigt markiert und mit der Reservierung verknüpft.
- Einrichtung unter Einstellungen → E-Mail → „E-Mail-Empfang“. Das Programm liest nur – im Postfach wird nichts verändert. Das Modul muss Benutzern einzeln freigegeben werden. Noch nicht mit einem echten Postfach erprobt.

## 1.23.0

- Einstellungen → neuer Reiter „Algorithmen“: Frühstücksregeln. Beispiel: „Wenn Frühstücksgäste weniger als 4, dann: Frühstück in der 1. Etage“. Wählbar sind Frühstücksgäste, Zimmer mit Frühstück, Gäste im Haus oder belegte Zimmer, die Bedingung, Wochentage und der Text.
- Die erste zutreffende Regel steht groß auf der Frühstücksliste und auf dem Ausdruck für die Küche. Die Regeln ändern keine Buchungen und Preise.

## 1.22.0

- Einstellungen → TSE: neue „Test-Signatur“. Das Programm meldet sich mit Kassen-Kennung und Zeit-PIN an der TSE an, stellt deren Uhr, zeichnet einen gekennzeichneten Testvorgang („SonstigerVorgang“, kein Umsatz) auf und zeigt Transaktionsnummer, Signaturzähler, Zeiten und Signatur – auf Wunsch auch als Ausdruck.
- Wichtig: Der Testvorgang bleibt dauerhaft in der TSE. PIN und Schlüssel werden nicht gespeichert. Zahlungen im Programm werden weiterhin nicht signiert. Noch nicht mit einem echten Stick erprobt.

## 1.21.1

- TSE: Fehler „JSON_ERROR_UNEXPECTED_STORAGE_VENDOR“ beim Selbsttest und beim Lesen des Zertifikats behoben – das Programm sendet jetzt das von Epson erwartete Kürzel und probiert bei Ablehnung weitere Schreibweisen.

## 1.21.0

- Einstellungen → neuer Reiter „Daten löschen“: Administratoren können Rechnungen und Zahlungen, vergangene oder alle Buchungen sowie Gäste ohne Buchung löschen – zum Aufräumen von Probedaten vor dem echten Betrieb.
- Sicherheit: erst eine Vorschau mit Stückzahlen, dann Passwort und das Wort LÖSCHEN; in der Windows-Version wird vorher automatisch eine Datensicherung geschrieben. Zimmer, Preise und Einstellungen bleiben.
- Hinweis: Echte Rechnungen unterliegen Aufbewahrungspflichten – bitte nicht ohne Rücksprache mit der Steuerberatung löschen.

## 1.20.0

- Zimmer & Preise: Administratoren können Kategorien, Zimmer, Preisregeln und Leistungen jetzt endgültig löschen (Schaltfläche „Löschen“ im Bearbeiten-Fenster, mit Rückfrage).
- Schutz: Zimmer und Kategorien mit Buchungen (auch vergangenen oder stornierten) lassen sich nicht löschen – dort bleibt „nicht buchbar“ der richtige Weg. Jedes Löschen steht im Protokoll.

## 1.19.0

- Einstellungen → neuer Reiter „TSE“: Daten des Epson-TSE-Sticks anzeigen (Seriennummer, BSI-Zertifizierung, Gültigkeit, Zustand, Signaturen, Speicher), Selbsttest ausführen, Datenblatt auf dem Bondrucker drucken und das Zertifikat als Datei speichern.
- Wichtig: Die Seite prüft den Stick nur. Zahlungen im Programm werden weiterhin nicht mit der TSE signiert. Noch nicht mit einem echten Stick erprobt.

## 1.18.1

- Vorbereitung für den Betrieb auf einem gemieteten Linux-Server: Installationsskript mit verschlüsselter Verbindung (HTTPS), täglicher Sicherung und Update-Befehl. Auf einem solchen Server ist die Gerätesuche im Netz abgeschaltet. Für die Windows-Version ändert sich nichts.

## 1.18.0

Abrechnung im Hotel überarbeitet:

- Neuer Knopf „Bezahlen / Abrechnen“ in jeder Reservierung: Zusammenfassung mit Anzahlungen und offenem Betrag, Zahlungsart Bar (mit Rückgeld-Berechnung), EC/Karte (mit Statusanzeige am Terminal oder von Hand bestätigt) oder Überweisung (Rechnung bleibt offen), auf Wunsch wird die Rechnung gleich ausgestellt.
- Schutz vor doppelter Abrechnung: Was schon auf einer Rechnung steht, wird nicht noch einmal berechnet; mehr als der offene Betrag lässt sich nicht buchen; ein versehentlicher Doppelklick wird abgefangen.
- Der Check-out zeigt deutlich, wenn noch etwas offen oder nicht berechnet ist.
- Rechnungsarchiv (bisher „Rechnungen“): Filter nach Status, Rechnungsdatum, Leistungszeitraum und Zahlungsart, Summenzeile, PDF-Ansicht und Download. Das Rechnungs-PDF wird beim Ausstellen gespeichert und danach unverändert ausgegeben; Druck, Download, E-Mail und E-Rechnung verwenden dieselbe Datei.
- Stornieren von Rechnungen und Gegenbuchen von Zahlungen darf nur noch der Administrator.
- Einstellungen → Haus: Logo hochladen (erscheint auf neuen Rechnungen und im Startmenü). Einstellungen → EC-Gerät: Hersteller, Modell und Terminal-ID lassen sich eintragen.

## 1.17.1

- Startmenü: „Heute im Haus“ lässt sich ein- und ausblenden und ist zunächst ausgeblendet. Die Wahl merkt sich das jeweilige Gerät.

## 1.17.0

- Startmenü: neue Übersicht „Heute im Haus“ – Anreisen, Abreisen, belegte Zimmer, Frühstück morgen, Tischreservierungen heute, offene Temperaturen und fällige Reinigung, überfällige Rechnungen. Jeder sieht nur seine freigegebenen Bereiche; ein Tipp führt zur passenden Seite.
- Einstellungen → Programm-Update: neuer Abschnitt „Was ist neu“ mit den Änderungen aller Versionen.

## 1.16.0

- EC-Gerät (Testbetrieb): Kartenzahlungen im Hotel lassen sich an ein EC-Gerät mit Kassenschnittstelle (ZVT über Netzwerk) senden – z. B. Geräte von VR Payment. Einrichten unter Einstellungen → EC-Gerät (IP-Adresse, Port, Passwort, „Verbindung prüfen“). Bei Zahlungen mit „Karte“ erscheint dann „Mit EC-Gerät kassieren“; bei Erfolg wird die Zahlung automatisch gebucht.
- Wichtig: Die Anbindung ist noch mit keinem echten EC-Gerät erprobt. Bitte zuerst mit einem kleinen Betrag testen; maßgeblich ist immer der Beleg des EC-Geräts.

## 1.15.0

- Übersichtlicher: Volle Seiten sind jetzt in Reiter aufgeteilt – Einstellungen (Haus, E-Mail, Drucker, Steuersätze, Hausnetz, Datensicherung, Programm-Update), Zimmer & Preise, Kontrollen (Temperatur, Reinigung, Wareneingang, Unterlagen, Kontrollbesuche) und Internet.
- Neue Suche im Startmenü und in der Seitenleiste (auch mit Strg+K): findet Seiten und Einstellungen sowie Gäste, Reservierungen, Rechnungen, Firmen und Tischreservierungen.

## 1.14.0

Schnelldruck erweitert:

- Neuer Zettel „Ihr Aufenthalt“ für Hotelgäste: Check-in/Check-out, Frühstückszeiten, Öffnungszeiten des Restaurants, WLAN und Telefon. Die Frühstückszeiten tragen Sie unter Einstellungen → Hotel ein.
- Neuer Zettel „Unsere Website“ mit QR-Code (erscheint, sobald in den Einstellungen eine Website steht).
- Knopf „Vorschläge“: fertige Zettel zum Übernehmen – Wichtige Rufnummern, Taxi, Parken, Bus und Bahn, Ausflugstipps, Feiern bei uns, Gutscheine, Gut zu wissen, Allergene. Stellen mit „(bitte eintragen)“ füllen Sie selbst aus; vorher druckt der Zettel nicht.

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
