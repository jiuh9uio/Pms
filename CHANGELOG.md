# Versionen

Der Abschnitt einer Version erscheint im Programm unter Einstellungen → Programm-Update.
Eine neue Version wird veröffentlicht, sobald die Versionsnummer in `package.json` erhöht wird.

## 1.61.1

- Programm-Update: Der Download brach bei langsamem Internet nach 60 Sekunden ab („The operation was aborted due to timeout“). Jetzt gibt es keine feste Gesamtzeit mehr – abgebrochen wird nur, wenn 90 Sekunden lang gar keine Daten kommen. Bricht die Verbindung ab, setzt das Programm bis zu fünfmal neu an, wo möglich an der Stelle, an der es aufgehört hat; auch ein späterer neuer Versuch macht dort weiter.
- Der Download nutzt die robuste Netzwerkfunktion von Node.js direkt (mit der eingebauten fetch-Funktion konnte das Programm bei großen Downloads abstürzen).
- Das Update läuft im Hintergrund (auch wenn die Seite geschlossen wird) und zeigt einen Fortschrittsbalken mit MB und Prozent. Fehlermeldungen kommen auf Deutsch.

## 1.61.0

- Meldeschein wahlweise auf dem Bondrucker: Nach dem Check-in stehen „A4 drucken“ und „Bon drucken“ zur Wahl. Auf dem Bondrucker kommen zwei Bons: der Meldeschein zum Unterschreiben (fehlende Angaben als Linie zum Ausfüllen von Hand, Ort/Datum und Unterschrift) und die Gästeinformationen zum Mitgeben (Begrüßung, Zimmer, WLAN mit QR-Code, Hausinformationen, Schlusssatz).
- Einstellungen → Haus → Check-in & Meldeschein: „Bevorzugter Druck nach dem Check-in“ (A4-Blatt oder Bondrucker) – die bevorzugte Möglichkeit ist nach dem Check-in hervorgehoben.
- Auch auf der Druckseite des Meldescheins gibt es „Stattdessen auf Bondrucker“. Gedruckt wird auf dem Bondrucker vorne, sonst auf dem Küchendrucker.

## 1.60.0

- Check-in: Nach „Anreise bestätigen“ erscheint „Eingecheckt – Meldeschein drucken?“. Ein Klick öffnet den Meldeschein und gleich das Druckfenster.
- Meldeschein mit Gästeinformationen zum Abtrennen (passt auf eine A4-Seite): oben der Meldeschein zum Unterschreiben, darunter „✂ hier abtrennen“ und für den Gast: Begrüßung, Zimmer, WLAN-Name und Passwort mit QR-Code zum direkten Verbinden sowie Hausinformationen (z. B. Frühstück, Zimmerreinigung, Abreise, Restaurant, Rezeption) und ein Schlusssatz.
- Einstellungen → Betrieb → Haus → „Check-in & Meldeschein“: Abfrage nach dem Check-in ein/aus, Gästeinformationen ein/aus, WLAN ein/aus (dieselben WLAN-Angaben wie beim Aushang unter Internet), Überschrift, Informationen (je Zeile „Bezeichnung | Angabe“) und Schlusssatz. Beim ersten Öffnen ist der Text aus Frühstückszeiten, Abreisezeit, Öffnungszeiten und Telefon des Hauses vorausgefüllt.

## 1.59.0

- Neue Reservierung: Die Zimmer stehen jetzt oben als Kacheln zum Antippen, nach Etage geordnet (1. Etage, 2. Etage …) und farblich nach Kategorie (z. B. Einzelzimmer blau, Doppelzimmer grün) mit Legende. Belegte Zimmer sind ausgegraut. Darunter Zeitraum, Status und die gewählten Zimmer mit Personen und Preis; rechts wie bisher Gast und Angaben. Wird ein gewähltes Zimmer durch einen geänderten Zeitraum belegt, weist ein Hinweis darauf hin.
- Etage: aus dem Feld „Etage“ des Zimmers; ist es leer, gilt bei dreistelligen Nummern die erste Ziffer (101 → 1. Etage).
- Check-in übersichtlicher: oben eine Zusammenfassung (Zimmer groß, Gast, Anreise, Abreise, Nächte, Personen, Reservierungsnummer, Ankunftszeit und Nachricht des Gastes), daneben „Anderes Zimmer zuweisen“. Darunter ein Überblick, welche Angaben noch fehlen, und die Gastdaten in Abschnitten: Name & Kontakt, Anschrift (mit Adresssuche), Meldedaten.

## 1.58.0

- Gästeseite: eigenes Logo für die Webseite (Einstellungen → Online → Gästeseite → Kopf und Startbild), getrennt vom Logo auf den Rechnungen. PNG mit durchsichtigem Hintergrund bleibt durchsichtig. Größe wählbar (klein, mittel, groß, kein Logo); der Name des Hauses unter dem Logo lässt sich ausblenden, wenn er schon im Logo steht.
- Ohne eigenes Logo wird wie bisher das Rechnungslogo gezeigt.

## 1.57.0

- E-Mail-Posteingang: Nachrichten werden jetzt in sieben Arten eingeordnet – Zimmer, Tisch, Feier / Veranstaltung, Tagung / Versammlung, Gutschein, allgemeine Frage und Sonstiges (Werbung, Rechnungen, Newsletter, automatische Nachrichten). Oben im Posteingang gibt es eine Filterleiste mit der Anzahl je Art.
- Die Erkennung arbeitet mit gewichteten Stichwörtern (Betreff zählt doppelt) und Alltagsregeln: kleiner Geburtstag am Tisch = Tischanfrage, Geburtstag im Saal oder mit Buffet = Feier, Tagung oder Feier mit Übernachtung bleibt Tagung bzw. Feier, eine Frage ohne Anfrage-Stichwort = allgemeine Frage. Umlaute an Wortgrenzen (Menü, Ärzte, Übernachtung) werden richtig erkannt; „Teilnehmer“, „Mitarbeiter“ und „Kollegen“ zählen als Personenangabe.
- Anfragen über die Gästeseite bekommen ihre Art direkt (bisher landeten Feier, Tagung, Gutschein und Frage unter „Sonstiges“). „Speichern und auf vorhandene Nachrichten anwenden“ ordnet auch ältere Online-Anfragen nachträglich richtig ein.
- Einstellungen → Algorithmen → E-Mail: eigene Stichwörter für jede Art; „Sonstiges gleich ausblenden“ blendet allgemeine Fragen nicht mehr aus.
- Feier und Tagung: Anzeige der erkannten Angaben (Termin, Personen, Telefon) und eine passende Absage-Vorlage.

## 1.56.0

- Check-in und Gästeprofil: „Adresse nachschlagen“ direkt bei den Gastdaten – Google-Maps-Link einfügen, Impressum einer Website lesen oder über die Karte (OpenStreetMap) suchen. Übernommen werden Straße, PLZ, Ort und Land (bei leerem Feld auch die Firma).
- Google-Maps-Links werden ausgelesen (auch bei Firmen): Name und Anschrift stehen meist im Link selbst. Bei Kurzlinks (maps.app.goo.gl) wird nur die Weiterleitung abgerufen; steht keine Anschrift im Link, wird über OpenStreetMap nach dem Namen bzw. den Koordinaten gesucht. Google selbst wird nicht nach Daten abgefragt.

## 1.55.2

- Programm-Update: Lehnt die GitHub-Schnittstelle die Abfrage ab („Antwort 403 von api.github.com“ – Begrenzung auf 60 Abfragen je Stunde und Internetanschluss), sucht das Programm die neueste Version über die normale GitHub-Seite weiter. Die Prüfsumme wird wie bisher geprüft. Klappt auch das nicht, erscheint eine verständliche Meldung.

## 1.55.1

- Sicherheitsprüfung (Prüfbericht unter docs/pruefbericht-2026-11.md). Kleine Härtungen: zusätzliche Sicherheits-Header (Permissions-Policy, Cross-Origin-Opener-/Resource-Policy, HSTS im HTTPS-Betrieb); öffentliche Seiten greifen nicht mehr auf den Speicher des Browsers zu; das Datenbank-Passwort steht bei Sicherung und Wiederherstellung nicht mehr in der Befehlszeile; Fehlermeldungen des Servers durchgehend auf Deutsch.

## 1.55.0

- Einstellungen → Online → Gästeseite → „Anfrageformular bearbeiten“: ein Fenster, in dem Sie festlegen, welche Anfragen Gäste stellen können (Zimmer, Tisch, Feier, Tagung, Gutschein, Frage), und die Auswahllisten selbst pflegen – Art der Veranstaltung, Bestuhlung, Technik, Verpflegung: eigene Einträge hinzufügen, löschen, verschieben, Vorgabe wiederherstellen. Für Tischanfragen: früheste und späteste Uhrzeit, Abstand und Höchstzahl Personen.
- Der Server prüft Anfragen gegen diese Einstellungen (abgeschaltete Arten, nicht angebotene Technik, Uhrzeit außerhalb, zu viele Personen).

## 1.54.1

- Anfrageformular: „Tagung oder Versammlung“ jetzt allgemein für Innungen, Vereine, Verbände, Praxen und Firmen – mit Auswahl der Art (Tagung/Konferenz, Innungs- oder Mitgliederversammlung, Jahreshauptversammlung, Seminar/Fortbildung/Schulung, Sitzung/Besprechung, Workshop, Vortrag/Infoabend, Sonstiges). Technik zusätzlich mit Rednerpult und Videokonferenz. Die Art steht im Betreff der Anfrage im Posteingang.

## 1.54.0

- Gästeseite → Anfrageformular: neue Art „Tagung oder Seminar“ (z. B. Ärzte-Fortbildungen, Qualitätszirkel, Firmentagungen) mit Veranstalter (Praxis, Klinik, Firma), erstem und letztem Tag, Teilnehmerzahl, Zimmern je Nacht, Bestuhlung, Technik (Beamer, Flipchart, Moderationskoffer, Mikrofon, WLAN) und Verpflegung (Kaffeepausen, Mittag- und Abendessen, Getränke). Im Bereich „Feiern & Tagen“ gibt es dafür den Knopf „Tagung anfragen“; Anlässe wie „Tagungen & Seminare“ führen ebenfalls dorthin.
- Die Tagungsanfrage kommt mit allen Angaben übersichtlich in den E-Mail-Posteingang.

## 1.53.0

- Sicherheitsprüfung „von außen“ als fester Test: Jede der über 150 Adressen des Servers wird ohne Anmeldung aufgerufen – nur die öffentlichen (Gästeseite, Anfrage, Gäste-Link, Online-Meldeschein, Anmeldung) antworten, alle anderen mit „nicht angemeldet“. Ein Benutzer ohne freigegebene Bereiche kommt an keine Administrator- oder Bereichsfunktion. Geprüft werden außerdem fremde Herkunft, wiederholte Ersteinrichtung und Fehlermeldungen ohne interne Einzelheiten.
- Neue Bremse bei der Anmeldung: höchstens 20 Versuche je 10 Minuten und Gerät (zusätzlich zur Kontosperre nach 5 Fehlversuchen); der PMS-Rechner selbst ist ausgenommen.
- Besucher der Gästeseite laden nicht mehr den Programmcode der internen Verwaltung mit – er wird erst nach dem Aufruf der Anmeldung geladen. Die Gästeseite lädt dadurch etwa halb so viel.

## 1.52.0

- Gästeseite: Video im Startbild (z. B. ein Drohnenflug über das Haus). Läuft ohne Ton in Schleife hinter der Überschrift; das Startbild dient als Vorschaubild. Mit Knopf zum Anhalten; bei Gästen mit „Bewegung reduzieren“ oder Datensparen erscheint nur das Startbild. Hochladen unter Einstellungen → Online → Gästeseite → „Kopf und Startbild“ (MP4 oder WebM, höchstens 80 MB, mit Fortschrittsanzeige).

## 1.51.0

- Gästeseite: ein gemeinsames Anfrageformular für Zimmer, Tisch im Restaurant, Feier oder Veranstaltung, Gutschein und allgemeine Fragen – jeweils mit den passenden Feldern (Reisedaten und Zimmerwunsch, Tag/Uhrzeit/Personen, Anlass/Termin/Gästezahl, Wert des Gutscheins). Alle Knöpfe der Seite führen dorthin und füllen die Art schon aus; nach einer Zimmersuche sind Reisedaten und Zimmer eingetragen. Es wird nichts gebucht.
- Die Anfragen landen im E-Mail-Posteingang; Zimmer- und Tischanfragen sind als solche erkannt (mit Datum, Uhrzeit, Personen) und lassen sich wie gewohnt übernehmen. Ist die Online-Anfrage ausgeschaltet, bieten die Knöpfe wie bisher Telefon und E-Mail an.

## 1.50.0

- Gästeseite neu gestaltet nach der Gestaltungsvorlage des Hauses: warme Cremetöne, Serifen-Überschriften mit kursiver zweiter Zeile, Name und Untertitel mittig mit Navigation, großes Startbild mit Monogramm, Begrüßung, Restaurant, Hotel & Zimmer (mit Verfügbarkeit, Preis und Anfrage), Speisekarte, Feiern & Tagen, Gutscheine, Tischreservierung, Kontakt mit Öffnungszeiten und „Route planen“, häufige Fragen, dunkler Fußbereich. Bereiche blenden beim Scrollen weich ein; auf dem Handy mit Menü-Knopf.
- Einstellungen → Online → Gästeseite: je Bereich ein- und ausblenden, Texte ändern (mit Vorschlagstext aus der Vorlage), Bilder für Startbild, Restaurant, Hotel und Feiern hochladen, Öffnungszeiten, häufige Fragen, Verfügbarkeitsabfrage ein/aus.
- Telefon, E-Mail und Adresse kommen aus Einstellungen → Haus. Feiern- und Gutschein-Anfragen öffnen das E-Mail-Programm des Gastes; es werden keine Bilder oder Schriften von fremden Servern geladen.

## 1.49.0

- Neue Gästeseite (Adresse /willkommen): eine öffentliche Seite für Gäste mit Überschrift, Einleitung, „Das bieten wir“, Zimmerkategorien mit Foto, Beschreibung und „ab … / Nacht“, Verfügbarkeitsprüfung für Reisedaten und Personen (mit Preis für den Aufenthalt nach Ihren Preisregeln) und unverbindlicher Anfrage, die mit der gewünschten Kategorie in den E-Mail-Posteingang kommt. Kontakt, Impressum- und Datenschutz-Link unten. Gebucht oder bezahlt wird darüber nichts.
- Einstellungen → Online → „Gästeseite“: freischalten (vorher Vorschau nur für Administratoren), als Startseite verwenden (Mitarbeiter melden sich dann über /anmelden an), Texte, Preise ein/aus, je Kategorie anzeigen, Beschreibung und Foto (wird beim Hochladen verkleinert). Die Einstellungs-Gruppe „E-Mail“ heißt jetzt „Online“.
- Gäste sehen nur, ob etwas frei ist – nicht, wie viele Zimmer; keine internen Angaben wie Steuernummer oder Bankverbindung.

## 1.48.2

- Zwei-Faktor-Anmeldung über die Benutzerverwaltung: Der Administrator öffnet unter Verwaltung → Benutzer den Benutzer, klickt „Einrichten“, der Benutzer scannt den QR-Code mit Microsoft Authenticator auf seinem Handy, der Administrator trägt den angezeigten Code ein. Aufheben ebenfalls dort.

## 1.48.1

- Zwei-Faktor-Anmeldung: Anleitung und Beschriftungen auf „Microsoft Authenticator“ abgestimmt (Konto hinzufügen über „Anderes Konto“). Andere Authenticator-Apps funktionieren weiterhin.

## 1.48.0

- Zwei-Faktor-Anmeldung: Unter „Mein Konto“ kann jeder Benutzer einstellen, dass bei der Anmeldung zusätzlich zum Passwort ein 6-stelliger Code aus einer Authenticator-App verlangt wird. Aufheben: selbst mit Passwort, durch einen Administrator unter Benutzer, oder im Notfall mit „Passwort vergessen.bat“ am PMS-Rechner.
- Einstellungen → System → „Sicherheit“: automatisches Abmelden nach einer einstellbaren Zeit ohne Eingabe; Überblick, wer die Zwei-Faktor-Anmeldung nutzt.
- „Mein Konto“ steht jetzt allen Benutzern offen (bisher nur Administratoren) – damit jeder sein Passwort ändern und den zweiten Faktor einrichten kann.

## 1.47.0

- Einstellungen → Betrieb → neuer Reiter „Mitteilungen“: Für das ganze Haus lässt sich ein- und ausschalten, was das Programm von sich aus meldet – die Abfragen der Eigenkontrolle beim Start (Temperatur, Reinigung), der Hinweis „Internet ausgefallen“, die Zähler an den Kacheln E-Mail und Team sowie die Hinweise für den Administrator (Datensicherung, Programm-Update, Einrichtung).

## 1.46.0

- Zimmer & Preise → Kategorie: Der Nachlass bei längerem Aufenthalt lässt sich für Einzelbelegung getrennt festlegen („… – Einzelbelegung“). Er gilt, wenn nur eine Person in einem Mehrbettzimmer wohnt, zusätzlich zum Nachlass bei Einzelbelegung. Bestehende Kategorien behalten ihren bisherigen Betrag für beide Fälle.
- Kontrollen → Eigenkontrolle: Der Administrator kann Messstellen (z. B. eine Kühltruhe), ganze Bereiche und Reinigungsaufgaben löschen und über „Alles löschen“ die gesamte Eigenkontrolle zurücksetzen. Beim Anlegen eines Geräts fragt das Programm nach dem Namen; ein Klick auf den Namen öffnet Umbenennen, Sollwert und Löschen.
- Die tägliche Abfrage „alles im Sollwert?“ / „Reinigung erledigt?“ erscheint jetzt beim Start des Programms im Startmenü statt beim Öffnen der Kontrollen. „Später“ gilt, bis das Programmfenster geschlossen wird.

## 1.45.0

- Neue Gliederung. Startmenü in drei Gruppen: Tagesgeschäft (Hotel, Restaurant, E-Mail, Team – große Kacheln), Büro (Rechnungen, Auswertung, Kontrollen) und Haus & Technik (Internet, Schnelldruck, Verwaltung, Mein Konto – kleine Kacheln).
- Neuer Bereich „Rechnungen“: Hotelrechnungen, Tagesabschluss, E-Rechnung erstellen und E-Rechnungs-Archiv an einem Ort. Aus dem Hotel führt „Rechnungen“ dorthin, „Zurück zu Hotel“ wieder zurück. Jede Zeile erscheint nur mit der passenden Freigabe – niemand sieht mehr als vorher.
- Menü links mit Zwischenüberschriften (Hotel: Heute, Haus, Kunden, Abrechnung, Einrichtung) und Vor-/Zurück-Knöpfen oben. Sprünge in einen anderen Bereich sind mit „›“ gekennzeichnet (z. B. E-Mail → Einrichtung, Team → Reinigung).
- Einstellungen in vier Gruppen statt elf Reitern: Betrieb, Geräte, E-Mail, System. Alle bisherigen Adressen und die Suche funktionieren unverändert.

## 1.44.0

- Oberfläche überarbeitet: Seiten, Kacheln und Kennzahlen blenden weich ein; Fenster öffnen sich mit sanfter Bewegung vor unscharfem Hintergrund; Knöpfe, Kacheln, Tabellenzeilen und Balken im Belegungsplan reagieren beim Überfahren und Drücken; Eingabefelder mit weichem Leuchtrand; feinere Schatten; schimmernde Ladeanzeige statt „Lädt …“; Markierung des aktiven Menüpunkts.
- Mein Konto → Darstellung: „Animationen und weiche Übergänge“ lässt sich je Gerät ausschalten. Die Windows-Einstellung „Animationseffekte“ aus wird ebenfalls beachtet.

## 1.43.0

- Das PMS wie ein Programm öffnen: Verwaltung → „Als Programm öffnen“ bietet eine Datei zum Herunterladen, die auf dem jeweiligen Windows-PC ein Symbol auf dem Desktop und im Startmenü anlegt. Das Symbol öffnet das PMS in einem eigenen Fenster ohne Adressleiste und lässt sich an die Taskleiste anheften. Im Programmordner liegt dafür zusätzlich „Als Programm einrichten.bat“ (bei neuen Installationen).
- Eigenes Programm-Symbol (blaues „S“) für Fenster, Browser-Tab und Verknüpfung; der Browser kann das PMS jetzt auch selbst „als App installieren“.

## 1.42.1

- Internet → Geräte: Die FRITZ!Box hängt an jeden Gerätenamen „.fritz.box“ an – dadurch wurden alle Geräte als Router eingeschätzt. Der angehängte Netzname (auch „.lan“, „.local“, „.speedport.ip“ u. a.) wird jetzt vor der Einschätzung entfernt und in der Liste und bei „im Internet suchen“ nicht mehr mitgeführt.

## 1.42.0

- Internet → Geräte: neue Spalte „Vermutlich“ – das Programm schätzt aus dem Namen, mit dem sich ein Gerät im Netz meldet, was es ist (Handy, Tablet, Computer, Drucker, Bondrucker, EC-Gerät, Fernseher, Router …) und nennt den Grund. Dafür wird nichts ins Internet gesendet; „im Internet suchen“ öffnet auf Klick eine Suche nach dem Gerätenamen.
- Einstellbar: je Gerät festlegen, was es ist („bearbeiten“), und eigene Regeln „Name enthält … → ist ein …“.
- Ist die FRITZ!Box eingerichtet, kommen deren Gerätenamen, LAN/WLAN, Gastnetz und Verbindungsgeschwindigkeit dazu, außerdem der aktuelle Datendurchsatz des Anschlusses. Eine Datenmenge je Gerät gibt die FRITZ!Box über ihre Schnittstelle nicht heraus. Mit einer echten FRITZ!Box noch nicht erprobt.

## 1.41.0

- Rechnungslayout mit mehr Gestaltung: drei Stile (klassisch, modern mit Farbbalken und farbiger Kopfzeile, elegant mit feinen Linien), sechs Farben (Schwarz, Dunkelblau, Tannengrün, Weinrot, Gold, Petrol), Schrift mit oder ohne Serifen, Logo rechts, links oder mittig, Positionen mit Trennlinien, abwechselnd hinterlegt oder ohne Linien. Die Vorschau zeigt jede Kombination sofort.

## 1.40.0

- Hotelrechnung neu gestaltet: mehr Abstand zwischen Kopf, Anschrift, Positionen und Summen; Positionen mit Kopfzeile und Trennlinien; Summen als eigener Block rechts (Netto und Umsatzsteuer je Steuersatz, Gesamtbetrag hervorgehoben); Fuß in drei Spalten; Seitenzahl bei mehrseitigen Rechnungen.
- Einstellungen → Haus → „Rechnungslayout“: Abstände (eng, normal, großzügig), Schriftgröße (klein, normal, groß), ein Satz über den Positionen und ein Schlusssatz – mit Vorschau als Muster-Rechnung. Gilt für neu ausgestellte Rechnungen; bereits ausgestellte bleiben unverändert.

## 1.39.1

- Reservierung → Rechnungen und Zahlungen: Ist alles berechnet und bezahlt, werden „Bezahlen / Abrechnen“ und „Einzelne Zahlung“ nicht mehr angeboten; stattdessen steht dort ein Hinweis. (Der Server hat eine zweite Zahlung auch bisher schon abgelehnt.)

## 1.39.0

- Einstellungen → TSE: „Zahlungen in der TSE aufzeichnen“. Eingeschaltet wird nach jeder gebuchten Zahlung und jeder Gegenbuchung ein Vorgang „Kassenbeleg-V1“ in der TSE aufgezeichnet (wahlweise nur Barzahlungen oder alle Zahlungsarten); Transaktionsnummer, Signaturzähler, Zeiten und Signatur werden zur Zahlung gespeichert und stehen in der Zahlungsliste, in „Letzte Aufzeichnungen“ und im Zahlungs-Export.
- Ist die TSE nicht erreichbar, bleibt die Zahlung gebucht und wird als „TSE-Ausfall“ vermerkt. Lehnt die TSE die Anmeldung ab, pausiert die Aufzeichnung sofort, damit keine weiteren PIN-Versuche verbraucht werden.
- Nicht enthalten: Kassenbeleg mit QR-Code, DSFinV-K-Export, Export der TSE-Daten. Mit einem echten Stick noch nicht erprobt, steuerlich nicht geprüft.

## 1.38.1

- Einstellungen → TSE: neue Karte „Kassen-Kennung anmelden“. Meldet die Test-Signatur „TSE1_ERROR_CLIENT_NOT_REGISTERED“, lässt sich die Kennung hier mit der Admin-PIN in der TSE anmelden; danach funktioniert die Test-Signatur mit dieser Kennung. Mit einem echten Stick noch nicht erprobt.

## 1.38.0

- Verwaltung → neue Seite „Erste Schritte“: eine Checkliste, die anzeigt, was für den Start eingerichtet ist, was noch fehlt und was Sie an Ihren Geräten prüfen sollten – jeweils mit direktem Sprung zur passenden Einstellung. Solange Grundlagen fehlen, weist das Startmenü darauf hin.
- Einstellungen → Steuern & Nummern: „Rechnungsnummern“ – festlegen, mit welcher laufenden Nummer es in diesem Jahr weitergeht, falls schon Rechnungen mit einem anderen Programm geschrieben wurden. Die Nummer lässt sich nur erhöhen.

## 1.37.0

- Gleichzeitiges Arbeiten an mehreren Rechnern: Ändert jemand an einem anderen Platz etwas (neue Reservierung, Check-in, Zahlung …), erscheint das innerhalb weniger Sekunden von selbst in den Listen und im Belegungsplan. Ist gerade ein Fenster zum Bearbeiten offen, wird erst nach dem Schließen aktualisiert, damit keine Eingabe verloren geht.
- Firmen → „Adresse nachschlagen“: Website eingeben und das Impressum lesen lassen (Name, Anschrift, Telefon, E-Mail, USt-IdNr.) oder Firmenname und Ort über die Karte suchen (OpenStreetMap). Gefundenes lässt sich mit einem Klick in die Felder übernehmen.

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
