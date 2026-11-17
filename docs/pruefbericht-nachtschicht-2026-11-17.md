# Prüfbericht Nachtschicht – 17.11.2026 (Version 1.79.1)

Fünf Prüfungen haben den Programmcode auf Logikfehler durchgesehen: Angebote, Hotel-Reservierungen,
Rechnungen/Zahlungen/TSE, Restaurant/Kontrollen/Posteingang und Verwaltung/Datenschutz.
Jeder Fund wurde im Code nachgeprüft. Die Prüfung beruht auf dem Lesen des Programmcodes und auf
automatischen Tests mit erfundenen Daten – **nicht** auf einem Test im echten Betrieb, mit echter Kasse,
echtem EC-Gerät oder echter TSE.

Sicherungspunkt vor den Änderungen: Version 1.79.0 (Commit `aba82b1`).

---

## A. Behoben in 1.79.1 (ohne Freigabe möglich, getestet)

### Angebote
1. Versand und gleichzeitige Online-Annahme konnten sich überschreiben (Annahme wäre verloren gegangen). Jetzt wird der Status nach dem Versand nur übernommen, wenn sich das Angebot währenddessen nicht geändert hat.
2. Online-Annahme prüft innerhalb der Sperre noch einmal, ob der Link zur aktuellen Fassung gehört.
3. Nur die interne Notiz geändert → das Angebot blieb fälschlich nicht „versendet“ und der Link des Kunden wurde ungültig. Jetzt: Notiz ändern hat keine Folgen; nur Änderungen am Inhalt machen es wieder zum Entwurf.
4. Interne Notiz lässt sich jetzt auch bei angenommenen/abgelehnten Angeboten speichern („Notiz speichern“).
5. „Angenommen …“ und „Abgelehnt“ mit ungespeicherten Änderungen: werden jetzt vorher gespeichert (sonst wäre die alte Fassung festgehalten worden).
6. Abgelaufenes „Gültig bis“: Versand wird mit klarer Meldung abgelehnt, im Angebot erscheint ein Hinweis.
7. Ausgeblendete Dokumente (z. B. alte AGB) werden nicht mehr in neue Angebote übernommen und lassen sich in der Vorlage abwählen.
8. Annahme eines Angebots ohne Positionen ist nicht mehr möglich.
9. Mengen werden auf 2 Nachkommastellen gerundet, damit Zeilensumme und gedruckte Menge zusammenpassen; zu hohe Zeilenbeträge werden abgelehnt.
10. Statusfilter der Angebotsliste (offen/angenommen/…) findet jetzt auch ältere Angebote (vorher nur unter den neuesten 300).
11. Mustervorlagen können nicht mehr doppelt angelegt werden.
12. Anzahlungen lassen sich nur noch im eigenen Bereich (Hotel / Restaurant / Angebote) ändern.

### Hotel
13. Bestätigungs-/Zusage-E-Mail nannte Zusatzleistungen (z. B. Frühstück) stornierter oder nicht gewählter Zimmer und rechnete sie in den Gesamtbetrag ein.
14. Personenänderung bei langem Aufenthalt: Nachlass für Einzelbelegung wurde nicht neu berechnet.
15. Ankunftszeit oder Storno über den Gäste-Link konnte von einem gleichzeitig geöffneten Formular des Personals überschrieben werden.
16. „Check-out zurücknehmen“ nach vorzeitiger Abreise war bei mehreren Zimmern trotz Sperre möglich.
17. Stammgast-Hinweis zählte auch spätere Aufenthalte als „früher“.
18. Reservierung wieder zur Anfrage gemacht: abgelaufene oder fehlende Optionsfrist wird neu gesetzt.
19. Hinweistexte zu „Gebuchte Preise behalten“ nennen jetzt ehrlich die Ausnahmen (Langzeitnachlass, Personenzuschlag).

### Restaurant, Kontrollen, Posteingang, Sonstiges
20. Posteingang: Kamen zwischen zwei Abrufen mehr als 200 E-Mails an, wurden ältere dauerhaft übersprungen. Jetzt werden die ältesten zuerst geholt, der Rest beim nächsten Abruf.
21. Posteingang: Ein kurzer Datenbankfehler konnte den Abruf bis zum Neustart blockieren.
22. Tischreservierung: Nur Telefon/Notiz ändern scheiterte, wenn der Tisch inzwischen verkleinert oder stillgelegt war.
23. Tischreservierung: ungültige Statuswechsel (z. B. künftige Reservierung auf „Tisch frei“) werden abgelehnt.
24. Sonderreinigungen: zwei gleichzeitige Einträge überschrieben sich gegenseitig.
25. Temperatur-Abfrage beim Start überschreibt keine Werte mehr, die jemand anderes inzwischen eingetragen hat.
26. Öffentliche Formulare: unmögliche Daten (z. B. 30.02.) führten zu einem Serverfehler; jetzt klare Ablehnung. Gleiches für Aufgaben- und Reinigungsdaten.
27. Begrenzung von Anfragen aus dem Internet: ließ sich mit wechselnden IPv6-Adressen umgehen und wurde bei vielen Absendern ganz zurückgesetzt. Bilder/Video der Gästeseite haben jetzt eine eigene, großzügige Begrenzung.
28. Firmenkunden: Firmen jenseits der ersten 300 (alphabetisch) ließen sich nicht öffnen.

---

## B. Nach Freigabe behoben in 1.80.0 (17.11.2026)

Alle Punkte B1–B22 wurden nach Ihrer Freigabe umgesetzt und mit automatischen Tests (erfundene Daten) geprüft.
Entscheidungen, die ich dabei getroffen habe:
- **B12:** Nach dem Start des Echtbetriebs ist das Einspielen eines Umzugspakets gesperrt, sobald Rechnungen vorhanden sind. „Ziel nicht leer“ zählt jetzt alle Daten (ohne die Grunddaten einer neuen Installation).
- **B16:** Der Browser meldet bei jeder Anfrage, wie lange die letzte Eingabe her ist; automatische Hintergrund-Abfragen verlängern die Anmeldung nicht mehr.
- **B18:** Neue Spalten in der Datenbank (Sollbereich je Messwert). Ältere Werte haben keinen gespeicherten Sollbereich – für sie gilt weiter der der Messstelle (ich habe bewusst keinen heutigen Bereich rückwirkend eingetragen).
- **B19:** Mitarbeiter tragen nur für heute und gestern ein bzw. korrigieren nur diese Tage. Ältere Tage nur der Administrator; Änderungen dort nur mit Begründung im Bemerkungsfeld. Eine vermerkte Maßnahme zu einem Wert außerhalb des Sollbereichs lässt sich nicht entfernen.
- **B21:** Frühstück und Leistungen „pro Nacht/Person“ werden automatisch angepasst – aber nur, wenn die Menge nicht von Hand geändert wurde und die Leistung noch auf keiner Rechnung steht.
- **B8:** Das Nachholen abgebrochener TSE-Vorgänge ist nur mit einer nachgebildeten TSE getestet – **nicht mit Ihrer echten TSE**.

Die ursprüngliche Liste folgt unverändert zur Nachverfolgung.

## B (ursprüngliche Liste). Gefunden, zunächst NICHT geändert – brauchte Ihre Freigabe

Diese Punkte betreffen Rechnungen, Zahlungen, Löschlogik, Anmeldung oder die Datenbankstruktur.
Dafür haben Sie sich die Freigabe vorbehalten.

### Rechnungen und Zahlungen
| Nr. | Fund | Folge | Vorschlag |
|---|---|---|---|
| B1 | **Export für den Steuerberater bricht nach 500 Rechnungen ab** | Bei mehr als 500 Rechnungen im Zeitraum fehlen die ältesten ohne Warnung | Export ohne diese Grenze – **dringend vor dem ersten Jahresexport** |
| B2 | Zusatzleistungen stornierter Zimmer zählen im offenen Betrag der Reservierung | Reservierung zeigt „offen“, obwohl alles bezahlt ist; kein automatischer Check-out; Personal muss den Betrag kassieren | Nur Leistungen aktiver Zimmer zählen (wie bei der Rechnung) |
| B3 | Gegenbuchen einer Zahlung auf einer stornierten Rechnung | Übertragene Anzahlung bleibt bestehen → neue Rechnung erscheint bezahlt, obwohl nichts eingegangen ist | Gegenbuchung gegen die Anzahlung buchen oder ablehnen |
| B4 | Verrechnung zwischen Rechnungen berücksichtigt nach Storno die Anzahlung nicht | Gast müsste doppelt zahlen | Anzahlungen in die Verrechnung einbeziehen |
| B5 | E-Rechnung (XML) zeigt aktuellen Zahlungsstand, das eingebettete PDF den Stand bei Ausstellung | Widerspruch innerhalb derselben Datei | XML mit dem Stand bei Ausstellung |
| B6 | E-Rechnung rechnet Netto/Steuer etwas anders als das PDF (Rundung je Zeile) | Cent-Abweichungen zwischen PDF und XML | Gleiche Berechnung wie im PDF |
| B7 | Menge auf Rechnungen wird gerundet gespeichert, die Summe aber ungerundet berechnet | Cent-Abweichungen bei Mengen wie 0,125 | Menge vorher runden (wie jetzt bei Angeboten) |
| B8 | TSE: Bricht der Abschluss einer TSE-Transaktion ab, bleibt sie offen | Offene Transaktionen auf der TSE | Abschluss beim nächsten Lauf nachholen |
| B9 | TSE: Umbuchung beim Storno wird als Kassenbeleg mit falscher Steueraufteilung signiert | Fiktive Steuerbewegung in der TSE | Umbuchungen nicht signieren |
| B10 | „Anzahlung buchen“ schlägt bei Teilzahlungen einen Betrag vor, den das Programm für Mitarbeiter ablehnt | Fehlermeldung, Feld nicht änderbar | Offenen Anzahlungsbetrag vom Server nehmen |
| B11 | „Nächste Rechnungsnummer setzen“ während gleichzeitiger Ausstellung | Rechnungsausstellung kann blockieren | Sperre beim Setzen |

### Löschlogik, Datenschutz, Datenübernahme
| Nr. | Fund | Folge | Vorschlag |
|---|---|---|---|
| B12 | **Datenübernahme (Migrationspaket) prüft die Echtbetrieb-Sperre nicht** | Nach dem Start des Echtbetriebs könnte ein Import alle Rechnungen, Zahlungen und TSE-Daten ersetzen (auf dem Server ohne automatische Sicherung) | Import mit Überschreiben nach Echtbetrieb sperren; Prüfung „Ziel nicht leer“ auf alle Tabellen ausweiten |
| B13 | Meldeschein-Löschung: Einträge im Änderungsprotokoll jünger als ein Jahr werden nie bereinigt | Geburtsdatum/Ausweisnummer bleiben dort dauerhaft stehen | Alle Protokolleinträge des Gastes bereinigen |
| B14 | Beim Zusammenführen doppelter Gäste bleiben die Protokolleinträge des entfernten Gastes stehen | Ausweisdaten bleiben dauerhaft im Protokoll | Beim Zusammenführen mitbereinigen |
| B15 | Meldeschein-Löschung erfasst Gäste ohne Check-in (z. B. Online-Meldeschein ausgefüllt, dann storniert) und Gäste mit vergessener alter Reservierung nicht | Daten bleiben dauerhaft | Auswahlregel anpassen |

### Anmeldung
| Nr. | Fund | Folge | Vorschlag |
|---|---|---|---|
| B16 | „Abmelden nach Inaktivität“ wirkt nur im Browser | Am gemeinsamen Rezeptions-PC ist nach Schließen und Wiederöffnen des Browsers noch die vorige Person angemeldet | Zeitgrenze auch auf dem Server prüfen |
| B17 | Anmelde-Begrenzung lässt sich mit wechselnden IPv6-Adressen umgehen | Nur die Kontosperre nach 5 Fehlversuchen schützt noch | Wie bei den öffentlichen Formularen je /64-Netz zählen |

### Braucht eine Änderung der Datenbankstruktur oder eine Entscheidung
| Nr. | Fund | Folge | Vorschlag |
|---|---|---|---|
| B18 | HACCP: Temperaturwerte speichern den damals gültigen Sollbereich nicht | Wird der Sollbereich später geändert, erscheinen alte Werte im Ausdruck anders markiert | Sollbereich je Messwert speichern (Datenbankänderung) |
| B19 | HACCP: Werte vergangener Tage lassen sich von allen ändern, auch eine Maßnahme-Notiz entfernen | Protokoll lässt sich nachträglich „glätten“ (bleibt nur im Änderungsprotokoll sichtbar) | Ihre Entscheidung: z. B. Korrektur nur heute/gestern, ältere nur Administrator mit Begründung |
| B20 | Posteingang: „Neu einordnen“ überschreibt von Hand geänderte Einordnungen | Von Hand eingeordnete E-Mails können ausgeblendet werden | Merker „von Hand eingeordnet“ speichern |
| B21 | Frühstück: Wird ein Aufenthalt verlängert oder die Personenzahl geändert, bleibt die Frühstücksmenge gleich | Küche plant Frühstück für alle Tage, berechnet wird die alte Menge | Ihre Entscheidung: automatisch anpassen oder nur Hinweis |
| B22 | Storno über den Gäste-Link bei mehreren Zimmern ist nicht „alles oder nichts“ | Bei gleichzeitiger Bearbeitung kann nur ein Teil storniert werden, ohne Meldung ans Personal | In einem Schritt ausführen |

**Meine Empfehlung für die Reihenfolge:** B1, B12, B2, B16, B13–B15, dann der Rest.

---

## C. Ausdrücklich nicht getestet
- Alles mit echter Kasse, EC-Gerät, TSE, echtem E-Mail-Versand und echtem Postfach.
- Verhalten unter Last oder bei echten Angriffen (keine Last- oder Angriffstests durchgeführt).
- Rechtliche Bewertung (HACCP, Meldegesetz, Aufbewahrung, Kassenrecht) – hierzu wurde nichts geprüft oder recherchiert.
