# Versionen

Der Abschnitt einer Version erscheint im Programm unter Einstellungen → Programm-Update.
Eine neue Version wird veröffentlicht, sobald die Versionsnummer in `package.json` erhöht wird.

## 1.104.0

- **Gutschein anlegen mit Rechnung in einem Schritt:** Im Fenster „Neuer Gutschein“ gibt es unten „Rechnung und Versand“. „Rechnung gleich mit anlegen“ (vorausgewählt) erzeugt beim Speichern einen **Rechnungsentwurf** an den Käufer mit dem Gutscheinwert zu **0 %** (Hinweis „Mehrzweckgutschein – Umsatzsteuer fällt bei Einlösung an“). Bei „wird per Post verschickt“ kommen die **Versandkosten** dazu (Vorschlag aus „Nummern & Porto“, Steuersatz wählbar, Vorgabe 19 %).
- Der Entwurf öffnet sich direkt – prüfen und „Ausstellen“ drücken. Ohne Name oder Firma des Käufers weist das Fenster vorher darauf hin.
- Der Knopf „Rechnung schreiben“ beim Gutschein bleibt für Gutscheine ohne Rechnung.

## 1.103.0

- **Reservierungs-Fenster vereinfacht** (feste Reservierungen – wie zuvor bei den Anfragen): Beim Öffnen erscheint jetzt eine schlanke Ansicht:
  - Name des Gastes (ggf. „Stammgast“), vier Kästchen **Wann · Zimmer · Betrag · Stand** – „bezahlt“ grün,
  - ein großer Knopf für den **nächsten Schritt** (Check-in → Bezahlen → Check-out), vor der Anreise zusätzlich „Gleich bezahlen“,
  - **Gast:** Anrufen, E-Mail schreiben, Meldeschein drucken, Gästeprofil; darunter die Notiz zur Buchung.
  - Alles Weitere (Zimmer ändern oder hinzufügen, Stornieren, Frühstück und Leistungen, Rechnungen, Meldeschein per QR, Bestätigung per E-Mail, Verlauf) über **„Mehr einblenden …“** – dort ist alles wie bisher.

## 1.102.0

- **Gutscheine – fertige Design-Vorlagen** (Gutscheine → Motive → „Vorlagen“): sechs eigene Entwürfe zum Übernehmen – **Elegant Gold**, **Winterzeit**, **Fröhlich**, **Modern Dunkel**, **Genuss** und **Natur & Ruhe**. Mit Vorschau; „Übernehmen“ legt eine eigene Kopie an, „Anpassen …“ öffnet die Vorlage gleich im Editor. Eigene Designs stehen darunter unter „Ihre Designs“.
- Editor: runde Formen bis zum Kreis (Ecken abrunden bis halbe Breite), im PDF jetzt sauber rund.

## 1.101.1

- **Programm-Update robuster:** Das Entpacken des Updates nutzt unter Windows jetzt zuerst „tar“ (in Windows 10/11 enthalten) und nur ersatzweise das bisherige Verfahren; ist das Ergebnis unvollständig, wird einmal mit dem anderen Verfahren wiederholt. Im Update-Protokoll steht bei einem Fehler genauer, was gefunden wurde. Anlass: Auf dem Windows-Testrechner brach das Entpacken gelegentlich ohne Meldung ab („Paket unvollständig“).
- Enthält den Design-Editor aus 1.101.0.

## 1.101.0

- **Neu: Design-Editor für Gutscheine** (Gutscheine → Motive → „Neues Design gestalten“ bzw. „Im Editor bearbeiten“):
  - Vorschau in Originalproportion (DIN A5 quer). Elemente mit Maus oder Finger **verschieben**, an der Ecke unten rechts **in der Größe ändern**; Pfeiltasten verschieben um 1 mm (mit Umschalt 5 mm).
  - **Einfügen:** Text, Fläche (Farbe, Deckkraft, Rahmen, runde Ecken), Logo (aus den Einstellungen), Strichcode der Kassennummer.
  - **Texte:** Schrift mit/ohne Serifen, Größe, fett, kursiv, links/Mitte/rechts, Farbe. **Platzhalter** per Klick einfügen – Wert, beschenkte Person, Gruß, Kassennummer, interne Nummer, ausgestellt am, gültig bis, Name, Anschrift, Telefon, Website. Leere Angaben fallen beim Drucken weg.
  - **Hintergrund:** Farbe und/oder eigenes Bild (füllt die Seite oder ganz sichtbar).
  - **Farbpalette** je Design: Farben hinzufügen und entfernen, eigene Farbe wählen.
  - **Vorlagen:** Klassisch, Text rechts, Text unten. Ebenen nach vorn/hinten, Ausblenden, Duplizieren, Löschen.
  - „Speichern & Druckvorschau“ zeigt das echte PDF. Die Vorschau im Editor ist eine Annäherung.
- Ältere Motive (nur Bild) funktionieren unverändert und lassen sich im Editor weiterbearbeiten.
- Datenbank: Gutschein-Motive haben eine zusätzliche Spalte für die Gestaltung; das Hintergrundbild ist freiwillig (mit Freigabe).

## 1.100.0

- **Gutscheine mit zwei Nummern:** **Kassennummer** (die Gutscheinnummer aus der Kasse – steht groß auf dem Gutschein als „Gutschein-Nr.“) und **Gutscheinnummer intern** (automatisch fortlaufend, klein darunter als „interne Nr.“). Beide werden im selben Fenster eingegeben; die Kassennummer steht jetzt oben an erster Stelle. Die Liste zeigt beide Nummern.
- **Strichcode:** Die Kassennummer wird als Strichcode (Code 128) auf den Gutschein gedruckt – zum Scannen an der Kasse. Abschaltbar unter Gutscheine → Nummern & Porto.
- Kassennummer: nur einfache Zeichen (A–Z, 0–9, Satzzeichen), damit der Strichcode lesbar bleibt.

## 1.99.1

- **Gutscheine ohne PIN:** Das PIN-Feld ist entfernt – stattdessen gibt es das Feld **„Geschenkkarten-Nr. aus der Kasse“**. Sie steht auf dem Gutschein („Karten-Nr. …“), in der Liste unter der Gutscheinnummer und ist über die Suche auffindbar. Die E-Mail an den Käufer weist darauf hin, dass die Kartennummer zum Einlösen gebraucht wird.

## 1.99.0

- **Neu: Gutscheine** (Hauptmenü → Büro → Gutscheine; für alle mit Freigabe Hotel oder Restaurant):
  - **Neuer Gutschein:** interne Nummer wird automatisch fortlaufend vorgeschlagen (z. B. SH-1001, SH-1002 …), Wert, **PIN aus dem Kassenprogramm**, auf Wunsch die Kartennummer der Kasse, ausgestellt am, gültig bis (Vorschlag: Jahresende nach 3 Jahren – änderbar), beschenkte Person, Gruß und Käufer (Name, Anschrift, E-Mail).
  - **PIN:** wird verschlüsselt gespeichert und steht auf dem Gutschein. In Listen nur „••15“; ganz anzeigen kann ihn nur der Administrator, jedes Anzeigen steht im Protokoll. Im Änderungsprotokoll erscheint der PIN nie.
  - **Motive:** eigenes Bild hochladen (JPG/PNG, Querformat), Textfeld rechts, links oder unten, Vorschau als PDF. Ohne Motiv: schlichter Rahmen mit Logo.
  - **Ansehen / Drucken** als PDF (DIN A5 quer) und **Per E-Mail senden** (Gutschein als PDF im Anhang, Text vorher änderbar).
  - **Rechnung schreiben:** legt einen Rechnungsentwurf an den Käufer an – Gutscheinwert (Vorgabe 0 %, Hinweis „Mehrzweckgutschein – Umsatzsteuer fällt bei Einlösung an“) und Porto (Vorgabe 19 %). Ausgestellt wird erst unter Rechnungen mit „Ausstellen“.
  - **Als eingelöst markieren** (eingelöst wird weiterhin an der Kasse) und **Stornieren** – Gutscheine werden nie gelöscht.
  - Administrator: Reiter „Nummern & Porto“ (Kürzel, Startwert, Stellen, Gültigkeit, Porto-Vorschlag).
- Neue Datenbank-Tabellen „Gutscheine“ und „Gutschein-Motive“ (mit Freigabe).

## 1.98.1

- **Anfrage-Fenster:** drittes Feld in Gelb – **Nachfrage stellen**: mit E-Mail-Adresse öffnet sich eine Rückfrage-E-Mail an den Gast, ohne E-Mail die Notiz zum Anruf (die Anfrage bleibt offen). Reihenfolge: grün Zusagen · gelb Nachfrage · rot Absagen.
- Weitere Angaben (Zimmer ändern, Rechnungen, Meldeschein, Verlauf) über den Knopf **„Mehr einblenden …“**.

## 1.98.0

- **Anfrage-Fenster vereinfacht:** Wer eine offene Anfrage öffnet (aus dem Anfragen-Ordner, der Übersicht oder den Reservierungen), sieht jetzt ein schlankes Fenster statt der vollen Reservierung:
  - oben vier Kästchen: **Wann · Zimmer · Preis · Vorgemerkt bis** (abgelaufen = rot),
  - **1. Gast erreichen:** großer Knopf **Anrufen** mit Nummer, ggf. E-Mail „Zimmer ist vorgemerkt“, darunter „+ Notiz zum Rückruf“ (mit Schnellwahl „nicht erreicht“, „ruft zurück“ … und auf Wunsch 3 Tage länger vormerken),
  - **2. Entscheiden:** zwei große Felder – grün **Zusagen** (fest buchen) und rot **Absagen** (Zimmer wieder frei).
  - Alles andere (Rechnungen, Meldeschein, Zimmer ändern …) unter „Alle Details der Reservierung“.
- Anfragen-Ordner: Knöpfe aufgeräumt („Anfrage öffnen“ zuerst, Hinweise „kein Telefon/keine E-Mail“ entfernt).

## 1.97.1

- **Neue Reservierung:** Beim Wählen der Anreise wird die Abreise automatisch eingetragen – mit derselben Anzahl Nächte wie gerade gewählt (z. B. „2 Nächte“), sonst 1 Nacht. Mit den Knöpfen „1/2/3/7 Nächte“ lässt sie sich mit einem Tipp ändern.

## 1.97.0

- **Neue Reservierung, Schritt „Zimmer“:** wieder Anreise/Abreise (mit Schnellwahl) und darunter die Zimmer nach Etagen – jetzt farbig: **grün = frei**, **rot = belegt**, **blau mit Haken = gewählt**. Der Belegungsplan im Schritt ist wieder herausgenommen.

## 1.96.0

- **Neue Reservierung nach Ihrem Ablauf:** ① Zuerst wählen: **Feste Reservierung** oder **Anfrage**. ② Dann öffnet sich der **Belegungsplan** (2 Wochen, blättern mit ‹ ›): im gewünschten Zimmer auf den Anreisetag tippen, dann auf die letzte Nacht – belegte Tage sind grau. Weitere Zimmer für denselben Zeitraum in deren Zeile antippen. ③ Gast suchen oder eintragen. ④ Fertig: Übersicht, Extras (Frühstück, Quelle, Zahlung, Notiz, Firma) und ein Knopf – „Fest buchen“ bzw. „Anfrage speichern“.
- Bei einer **Anfrage** muss Telefon oder E-Mail eingetragen sein (für Rückruf bzw. Bestätigung); das Zimmer wird bis „Option bis“ vorgemerkt.
- **Neu: Anfragen-Ordner** (Hotel → Heute → Anfragen, auch über die Kachel „Offene Anfragen“): jede Anfrage mit Zeitraum, Zimmer, Option und Rückruf-Notiz; Knopf **Anrufen** (Telefonnummer), **Bestätigungs-E-Mail** und **Öffnen – zusagen oder absagen**. Abgelaufene Optionen sind rot markiert und stehen oben.
- Bei festen Reservierungen wird keine Bestätigungs-E-Mail angeboten; sie lässt sich bei Bedarf wie bisher in der Reservierung über „Bestätigung per E-Mail“ senden.

## 1.95.0

- **Neue Reservierung jetzt Schritt für Schritt:** Statt allem auf einer Seite gibt es fünf Schritte – ① Zeitraum ② Zimmer ③ Gast ④ Extras ⑤ Prüfen. Oben sieht man, wo man ist; erledigte Schritte haben einen Haken und lassen sich jederzeit wieder antippen.
- ① Zeitraum mit Schnellwahl „heute“, „morgen“ und „1/2/3/7 Nächte“; es wird gleich angezeigt, wie viele Zimmer frei sind.
- „Weiter“ geht erst, wenn der Schritt vollständig ist (Zimmer gewählt, Gast gewählt oder Nachname eingetragen). Die Enter-Taste führt zum nächsten Schritt.
- ⑤ Prüfen zeigt alles auf einen Blick mit „ändern“-Links und erklärt den Unterschied zwischen „Fest buchen“ und „Als Anfrage anlegen“ (mit „Option bis“).
- Aus dem Belegungsplan mit vorgewähltem Zimmer geht es direkt bei ② Zimmer los. Was gebucht wird, ist unverändert – nur die Bedienung ist neu.

## 1.94.0

- **Pfand beim Warenzugang und beim Leergut eintragen:** Felder „Pfand für die erhaltene Ware“ und „Pfand fürs mitgegebene Leergut“ (Warenzugang) bzw. „Pfand (Gutschrift)“ (Leergut). Der Betrag steht auf dem Bon, mit Pfand-Saldo.
- Unter „Artikel ändern“ lässt sich je Artikel ein **Pfand je Stück** hinterlegen (z. B. Pils – Fass 50 l: 30 €). Dann rechnet das Programm das Pfand beim Eintragen vor – änderbar, z. B. wenn der Lieferschein etwas anderes sagt.
- „Noch beim Lieferanten offen“ zeigt zusätzlich das geschätzte Pfand (offene Stück × Pfand je Stück); die Bon-Liste zeigt das Pfand je Bon.
- Bondruck: geschütztes Leerzeichen in Beträgen wird jetzt als normales Leerzeichen gedruckt (vorher „?“).

## 1.93.0

- **Einkauf umgebaut – aus Sicht des Restaurants:** Der Lieferschein für eigene Kunden und die Liste „Bei Kunden draußen“ sind entfernt (passten nicht, Sie liefern nicht selbst aus).
- **Warenzugang mit Bon:** Lieferung eintragen (z. B. Brauerei: Pils 50 l, Hefe 20 l, Kupfer 30 l), Bon wird gedruckt (Nummer WE-Jahr-Nummer) zum Abheften und Vergleichen mit der Rechnung. Nimmt der Fahrer gleich Leergut mit, steht es mit auf dem Bon – mit Unterschriftsfeld für den Fahrer, dann 2 Bons (Fahrer + uns).
- **Leergut-Bon für den Fahrer:** Unter Einkauf → Leergut Leergut eintragen, Bon drucken (Nummer LG-Jahr-Nummer, 2 Stück), Fahrer unterschreibt – Nachweis fürs Pfand. Vorschlag „alles übernehmen“ aus dem, was laut Warenzugang noch offen ist.
- Gespeichert wird immer, auch wenn der Drucker nicht erreichbar ist; dann erscheint ein Hinweis, und der Bon lässt sich unter „Bons“ nachdrucken.
- Fehler behoben, der mit 1.92.0 gespeicherte Warenzugänge in der neuen Bon-Liste hätte stören können.

## 1.92.0

- **Neu unter Einkauf → Warenzugang:** eintragen, was gekommen ist (z. B. die Brauerei bringt 4 Fässer Pils und 1 Fass Hefe). Lieferant (wird beim nächsten Mal vorgeschlagen), Datum, Lieferschein-Nr. des Lieferanten, Artikel mit + / −, weitere Artikel frei. Leergut, das der Lieferant gleich mitnimmt, wird im selben Schritt eingetragen.
- **Neu unter Einkauf → Leergut:** Übersicht in zwei Teilen:
  - **Bei Kunden draußen** – kommt automatisch aus jedem gedruckten Lieferschein. „zurückbekommen“ tippen, wenn die Fässer wieder da sind (auch teilweise).
  - **Beim Lieferanten noch zurückzugeben** – aus dem Warenzugang. „zurückgegeben“ tippen, wenn die Brauerei das Leergut abholt.
- Es kann nicht mehr Leergut zurück eingetragen werden, als offen ist. Fehleinträge werden **storniert** (bleiben durchgestrichen im Verlauf sichtbar), nicht gelöscht.
- Nur Stückzahlen, noch kein Pfand in Euro. Die Hygiene-Kontrolle beim Wareneingang bleibt unverändert unter Kontrollen.
- Neue Datenbank-Tabelle „Warenbewegungen“ (mit Freigabe); bestehende Daten bleiben unverändert.

## 1.91.0

- **Neuer Bereich „Einkauf“** im Menü (unter „Büro“). Er ist für alles rund um Einkauf und Lieferungen gedacht und wird nach und nach erweitert.
- Die **Lieferscheine** (z. B. Fassbier: Pils, Hefe, Kupfer) sind dorthin umgezogen. Unter Schnelldruck steht ein Hinweis mit Link.
- Zugang wie bisher über die Freigabe „Schnelldruck“; eine eigene Freigabe „Einkauf“ gibt es noch nicht.

## 1.90.0

- **Neu: Lieferschein auf dem Bondrucker** (Schnelldruck → ganz unten „Lieferschein“), z. B. für Fassbier zu einer Feier. Fertig hinterlegt sind **Pils – Fass 50 l, Hefe – Fass 20 l und Kupfer – Fass 30 l**; Anzahl mit + / − eintippen, weitere Positionen (z. B. Zapfanlage) frei dazuschreiben. Dazu Empfänger, Anschrift, Lieferdatum, „Leergut zurück bis“ und ein Hinweis.
- Jeder Lieferschein bekommt eine fortlaufende Nummer (LS-Jahr-Nummer). Bei 2 Ausdrucken kommt ein Exemplar für den Empfänger und eines mit Unterschriftsfeld „Ware vollständig und einwandfrei erhalten“. Klappt der Druck nicht, wird keine Nummer verbraucht.
- „Zuletzt gedruckt“ zeigt die letzten 30 Lieferscheine mit **Nachdruck** (als „Nachdruck“ gekennzeichnet).
- Der Administrator kann die Artikelliste über „Artikel ändern“ anpassen.
- Ohne Preise: Der Lieferschein ist keine Rechnung und kein Kassenbeleg; die Rechnung schreiben Sie wie gewohnt.

## 1.89.1

- **Fehler behoben: „Neue Reservierung“ → „Gewählte Zimmer“** war seit 1.86.0 verrutscht (schmaler Rahmen, „Preis/Nacht“ ragte heraus, Entfernen-Knopf darunter). Ursache: eine neue Gestaltung für „Aufs Zimmer“ im Restaurant trug denselben internen Namen. Jetzt wieder eine Zeile mit Erwachsenen, Kindern, Preis/Nacht und ✕.
- Ebenso behoben: Im Posteingang war der gewählte Filter (z. B. „Hotel“) seit 1.88.0 nur noch zart statt kräftig hervorgehoben.

## 1.89.0

- **Umsatzsteuer – Stand 2026 und Prüfung** (Einstellungen → Betrieb → Steuern & Nummern): Übersicht der Sätze für Hotel und Gastronomie mit Quellen (Übernachtung 7 %; Speisen inkl. Frühstück seit 1.1.2026 7 %; Getränke 19 %; Sonstiges in der Regel 19 %). Das Programm prüft Ihre Leistungen (z. B. Frühstück) und Speisen im Angebotskatalog und schlägt Änderungen vor – umgestellt wird nur auf Knopfdruck; bereits gebuchte Leistungen und ausgestellte Rechnungen behalten ihren Satz. Keine Steuerberatung – Sonderfälle bitte mit dem Steuerberater klären.
- **Restaurant „Aufs Zimmer“:** getrennte Felder für Speisen (7 %) und Getränke (19 %); gebucht werden zwei Posten.

## 1.88.1

- **Rechnung: Abschnitt „Zahlung per Überweisung“.** Ist auf einer Rechnung noch ein Betrag offen und Ihre IBAN hinterlegt, steht jetzt ein eigener Kasten mit Betrag, Zahlungsfrist, Empfänger, IBAN (in Viererblöcken), BIC, Bank und Verwendungszweck (Rechnungsnummer). Ist der GiroCode eingeschaltet, steht er rechts daneben.
- Bezahlte Rechnungen, Entwürfe und Stornobelege zeigen weder den Kasten noch den GiroCode – wie bisher.
- Gilt für Rechnungen, die ab jetzt ausgestellt werden; bereits ausgestellte bleiben unverändert im Archiv.

## 1.88.0

- **Temperaturprotokoll drucken und senden** (Kontrollen → Hygieneamt → Temperaturprotokoll → „Drucken / Senden …“): Zeitraum wählen (Dieser Monat, Letzter Monat, 7/30/90 Tage oder frei) und Bereich (alle oder einer).
  - **Großer Drucker / PDF:** Tabelle im Querformat mit Sollbereichen, Abweichungen rot hinterlegt, allen Bemerkungen und Maßnahmen, Zusammenfassung und Logo – zum Ansehen, Drucken oder Speichern.
  - **Per E-Mail:** dasselbe PDF als Anhang, z. B. an das Hygieneamt; Empfänger und Text prüfen Sie vor dem Senden.
  - **Bondrucker:** sehr kompakt – eine Legende der Messstellen (A, B, C …) und dann je Tag eine Zeile mit allen Werten, z. B. „06.11. A9! B1 C-20 D5“. So passen 30 Tage mit vier Messstellen auf rund 50 Zeilen Kassenzettel. „!“ = außerhalb des Sollbereichs, „ok“ = im Soll bestätigt, „-“ = fehlt; Maßnahmen stehen am Ende.

## 1.87.0

- **Fragenkatalog zum Anklicken** (Angebote): Bei „Nur Fragen stellen“ erscheinen alle gesammelten Fragen als Kästchen – einfach anklicken. Eigene Fragen tippen Sie dazu und können sie „für später im Katalog merken“. Der Katalog startet mit den Fragen der Vorlagen; entfernen kann ihn der Administrator (× an der Frage).
- **Angebot mit Leistungen:** Statt des großen Fragenfelds gibt es das Häkchen **„Fragen mitstellen“** – nur dann klappt derselbe Katalog zum Anklicken auf.
- Beim Umschalten von „Nur Fragen“ auf „Angebot mit Leistungen“ wird „Gültig bis“ auf 14 Tage gesetzt.

## 1.86.0

- **Restaurant: „Aufs Zimmer“** – Verzehr eines Hotelgastes auf seine Zimmerrechnung schreiben: Zimmer antippen (nur eingecheckte Gäste), Betrag und Steuersatz eintragen. Erscheint in der Reservierung unter „Frühstück und Leistungen“ und kommt mit auf die Zimmerrechnung. Speisen und Getränke mit unterschiedlichem Steuersatz als zwei Einträge buchen.
- **Ausfallgebühr mit einem Klick:** In der Reservierung unter „Rechnungen und Zahlungen“ → „Ausfallgebühr …“ (bei stornierten oder nicht angereisten Zimmern). Der Betrag wird nach Ihren Stornobedingungen vorgeschlagen; angelegt wird ein **Rechnungsentwurf**, den Sie prüfen und selbst ausstellen. Den Steuersatz wählen Sie selbst – ob eine Ausfallgebühr umsatzsteuerpflichtig ist, bitte mit dem Steuerberater klären.
- **Kurzanleitung fürs Team** (Menü → Hilfe → Kurzanleitung): die zehn häufigsten Abläufe auf einer Seite, zum Ausdrucken und Aushängen.

## 1.85.0

- **Als App auf dem Handy:** Das Programm lässt sich auf iPhone, iPad und Android-Handys auf den Home-Bildschirm legen und öffnet sich dann ohne Browserleiste wie eine App (eigenes Symbol „Schützenhaus“, passende Farben für hell und dunkel, Ränder für Notch und Home-Leiste, kein Hineinzoomen beim Tippen in Textfelder). Auf Android zeigt langes Drücken auf das Symbol Abkürzungen zu Belegungsplan, Reservierungen, Tischen und Übergabebuch.
- Anleitung unter **„Als Programm öffnen“** (Abschnitt „Auf dem iPhone oder iPad“).
- Das Handy muss das Programm erreichen: im WLAN des Hauses oder – mit dem geplanten Server – von überall. Auf einem echten iPhone noch nicht ausprobiert.

## 1.84.0

- **Angebote: erst nur Fragen stellen.** Beim Anlegen wählen Sie „Erst Fragen stellen“ oder „Direkt ein Angebot“ (im Entwurf lässt sich das noch umschalten).
  - **Nur Fragen:** ohne Leistungen, Preise und PDF. Der Kunde bekommt eine E-Mail mit Ihren Fragen und einem Link, über den er sie direkt beantworten kann – oder er antwortet per E-Mail (dann landet die Antwort wie gewohnt im Posteingang).
  - Online-Antworten erscheinen im Vorgang („beantwortet“) und als Aufgabe im Übergabebuch.
  - Mit **„Angebot erstellen“** wird daraus das Angebot mit Leistungen (die Leistungen der Vorlage stehen schon bereit, die Antworten bleiben sichtbar).
- **Angenommen/Abgelehnt erst nach dem Versand:** Im Entwurf gibt es diese Knöpfe nicht mehr – der Kunde kann ja noch nichts annehmen. Nach dem Versand sind sie da (bei reinen Fragen: „Kein Interesse“).

## 1.83.0

- **Logo überall** (Einstellungen → Betrieb → Haus → Logo → „Logo außerdem zeigen auf“):
  - **Ausdrucke:** Meldeschein, Tagesabschluss, Frühstücks-, Reinigungs- und Tischliste, Auswertungen, Temperaturprotokoll und Buchhaltungszettel tragen Ihr Logo (voreingestellt: an).
  - **Seiten für Gäste:** Gäste-Link zur Reservierung, Online-Meldeschein, Angebot zum Annehmen und Anfrageformular zeigen oben Ihr Logo (voreingestellt: an).
  - **E-Mails:** Bestätigungen, Angebote, Rechnungen usw. erhalten oben Ihr Logo; der Text bleibt unverändert (voreingestellt: aus – bitte vor dem Einschalten eine Test-E-Mail an sich selbst senden).
  - Rechnungen und Angebote hatten das Logo schon; Lage und Größe stellen Sie dort im Rechnungslayout bzw. unter Angebote → Gestaltung ein.
  - Der Bondrucker druckt weiterhin kein Logo aus dem Programm.

## 1.82.0

- **Neu: Gestaltung der Angebote** (Angebote → Reiter „Gestaltung“, Administrator):
  - **„Wie die Rechnung gestalten“** (voreingestellt): Stil, Farbe, Schrift, Logo, Tabelle, Abstände und Papier kommen aus dem Rechnungslayout. Ausschalten, um Angebote eigens zu gestalten.
  - Eigene Gestaltung: **Stil** (klassisch, modern, elegant), **Farbe** inkl. eigener Farbe, **Schrift**, **Logo-Lage** (rechts, links, mittig) und **Logo-Größe**, **Positionen** (Trennlinien, abwechselnd hinterlegt, ohne Linien), **Abstände** und **Schriftgröße**.
  - **Preise:** Einzelpreis und Betrag je Position oder nur der Gesamtbetrag (z. B. für Pauschalangebote).
  - **Feld für die Unterschrift** („Angebot angenommen: Ort, Datum, Unterschrift“) für die Annahme auf Papier.
  - **Fragen zum Ausfüllen:** Fragenkatalog als Kästchen zum handschriftlichen Ausfüllen.
  - **Absenderzeile**, **Falz- und Lochmarken**, **vorgedrucktes Briefpapier**.
  - **Vorschau** als Muster-Angebot mit erfundenen Angaben, auch ohne zu speichern.
  - Gilt für Angebote, die ab jetzt erzeugt oder versendet werden; bereits versendete bleiben unverändert.
- Das Angebots-PDF zeigt Angebotsnummer, Datum, Gültigkeit, Termin und Personen jetzt übersichtlich rechts neben der Anschrift und Seitenzahlen bei mehreren Seiten.

## 1.81.0

- **Neues Erscheinungsbild der Symbole:** Alle Symbole in Menü, Seitenleiste und Startseite sind jetzt einheitliche, eigens gezeichnete Linien-Symbole (vorher gemischte Schriftzeichen und bunte Emojis).
- **Meldungen** („Gespeichert“ usw.) zeigen einen Haken, der sich kurz zeichnet, und eine feine Linie, wie lange die Meldung noch steht. Wer in Windows „Animationen reduzieren“ eingestellt hat, sieht sie ohne Bewegung.
- **Rechnungslayout – neue Möglichkeiten** (Einstellungen → Betrieb → Haus → Rechnungslayout):
  - **Eigene Farbe** über das Plus-Feld neben den Farben (zu helle Farben werden für die Lesbarkeit automatisch etwas abgedunkelt).
  - **Logo-Größe** klein, mittel oder groß.
  - **Zahlungs-QR-Code (GiroCode)** bei offenem Betrag: Gäste scannen ihn mit der Banking-App; Empfänger, IBAN, Betrag und Rechnungsnummer sind ausgefüllt. Noch nicht mit einer echten Banking-App getestet – bitte einmal mit der Vorschau ausprobieren.
  - **Falz- und Lochmarken** am linken Rand.
  - **Vorgedrucktes Briefpapier:** Kopf und Fuß werden nicht gedruckt, der Platz bleibt frei.
  - **Absenderzeile** über der Anschrift ein- oder ausschalten.
  - Gilt für Rechnungen, die ab jetzt ausgestellt werden; bereits ausgestellte bleiben unverändert im Archiv. Angebote übernehmen die eigene Farbe ebenfalls.

## 1.80.0

Weitere Fehlerbehebungen aus der Prüfung (Teil B, nach Freigabe – Einzelheiten: docs/pruefbericht-nachtschicht-2026-11-17.md):

- **Export für den Steuerberater:** enthält jetzt alle Rechnungen des Zeitraums (vorher höchstens 500).
- **Datenübernahme (Umzugspaket):** nach dem Start des Echtbetriebs gesperrt, sobald Rechnungen vorhanden sind; die Prüfung „hier stehen schon Daten“ berücksichtigt alle Bereiche.
- **Offener Betrag:** Leistungen stornierter Zimmer zählen nicht mehr mit (wie auf der Rechnung).
- **Abmelden nach Inaktivität** gilt jetzt auch, wenn der Browser geschlossen und wieder geöffnet wird; Hintergrund-Aktualisierungen verlängern die Anmeldung nicht.
- **Meldescheine:** Die Löschung nach einem Jahr bereinigt auch jüngere Protokolleinträge, erfasst Gäste ohne Check-in (z. B. storniert) und alte, nie abgeschlossene Reservierungen. Beim Zusammenführen von Gästen werden die Protokolleinträge des entfernten Gastes anonymisiert.
- **Zahlungen:** Gegenbuchung einer Zahlung auf einer stornierten Rechnung geht gegen die übertragene Anzahlung. Nach einem Storno übertragene Anzahlungen werden mit offenen Rechnungen der Reservierung verrechnet. „Anzahlung buchen“ schlägt den tatsächlich offenen Betrag vor. Das Setzen der nächsten Rechnungsnummer kann eine gleichzeitige Ausstellung nicht mehr blockieren.
- **E-Rechnung:** Netto und Steuer je Satz wie auf der PDF-Rechnung; der Zahlungsstand entspricht dem Stand bei Ausstellung (wie im eingebetteten PDF).
- **Mengen auf Rechnungen** werden auf 2 Nachkommastellen gerundet, damit Summe und gedruckte Menge zusammenpassen.
- **TSE:** Abgebrochene Vorgänge werden beim nächsten Lauf abgeschlossen (nur mit nachgebildeter TSE getestet). Interne Umbuchungen beim Storno werden nicht mehr als Kassenbeleg signiert.
- **Anmeldung:** Die Bremse gegen massenhaftes Passwort-Ausprobieren lässt sich nicht mehr mit wechselnden IPv6-Adressen umgehen.
- **Temperaturkontrolle (HACCP):** Jeder Messwert speichert den Sollbereich, der beim Eintragen galt. Mitarbeiter tragen nur für heute und gestern ein; ältere Tage ändert der Administrator mit Begründung. Eine vermerkte Maßnahme lässt sich nicht entfernen.
- **Posteingang:** Von Hand eingeordnete E-Mails werden von „Neu einordnen“ nicht mehr überschrieben.
- **Frühstück:** passt sich bei Verlängerung oder geänderter Personenzahl automatisch an (sofern nicht von Hand geändert und noch nicht berechnet).
- **Storno über den Gäste-Link:** bei mehreren Zimmern jetzt alles oder nichts.

## 1.79.1

Fehlerbehebungen aus der nächtlichen Prüfung (Einzelheiten: docs/pruefbericht-nachtschicht-2026-11-17.md):

- **Angebote:** Versand und gleichzeitige Online-Annahme überschreiben sich nicht mehr. Die interne Notiz lässt sich ohne Folgen ändern – auch bei angenommenen Angeboten („Notiz speichern“). „Angenommen …“/„Abgelehnt“ speichern ungespeicherte Änderungen vorher. Abgelaufenes „Gültig bis“ wird beim Versand gemeldet. Ausgeblendete AGB werden nicht mehr übernommen. Kein „angenommen“ ohne Positionen. Listenfilter findet auch ältere Angebote.
- **Anzahlungen** lassen sich nur noch im eigenen Bereich (Hotel, Restaurant, Angebote) ändern.
- **Hotel:** Bestätigungs-E-Mail nennt nur Leistungen der genannten Zimmer. Einzelbelegungs-Nachlass bei langem Aufenthalt wird bei Personenänderung neu berechnet. Angaben des Gastes über den Link werden nicht mehr von einem offenen Formular überschrieben. „Check-out zurücknehmen“ nach vorzeitiger Abreise ist auch bei mehreren Zimmern gesperrt. Wieder zur Anfrage gemacht: Optionsfrist wird neu gesetzt. Stammgast-Hinweis zählt nur frühere Aufenthalte.
- **Posteingang:** Bei mehr als 200 neuen E-Mails gehen ältere nicht mehr verloren; ein kurzer Datenbankfehler blockiert den Abruf nicht mehr.
- **Restaurant:** Telefon/Notiz einer Reservierung lässt sich ändern, auch wenn der Tisch inzwischen verkleinert wurde; unmögliche Statuswechsel werden abgelehnt.
- **Kontrollen:** Die Temperatur-Abfrage beim Start überschreibt keine Werte, die jemand anderes schon eingetragen hat. Sonderreinigungen gehen bei gleichzeitigen Einträgen nicht mehr verloren.
- **Gästeseite und Formulare:** Unmögliche Daten (z. B. 30.02.) werden sauber abgelehnt; Schutz vor zu vielen Anfragen verbessert.
- **Firmenkunden:** Firmen jenseits der ersten 300 lassen sich wieder öffnen.
- Weitere Funde zu Rechnungen, Zahlungen, TSE, Löschfristen und Anmeldung sind **nicht** geändert – sie warten auf Freigabe (siehe Prüfbericht, Teil B).

## 1.79.0

- **Neu: Angebote** (Hotel → Kunden → Angebote; im Restaurant über das Menü erreichbar) für Tagungen, Feiern und Gruppen:
  - **Leistungen** (nur Administrator): Katalog mit Preis, Abrechnungsart (pro Person, pro Tag, pro Nacht, pauschal …) und Steuersatz.
  - **Vorlagen** (nur Administrator): Tagung, Familienfeier, Weihnachtsfeier und Gruppenübernachtung sind mit Fragenkatalog vorbereitet – **noch ohne Preise**, bitte Ihre eigenen Leistungen und Preise eintragen.
  - **AGB & Dokumente** (nur Administrator): eigene AGB als PDF hochladen; sie werden beim Versand automatisch angehängt.
  - **Angebot erstellen:** Kunde, Termin, Personen → Positionen werden mit passenden Mengen vorgeschlagen und lassen sich ändern. Angebot als PDF im Rechnungs-Layout.
  - **Versenden:** E-Mail mit Angebot als PDF, den AGB und einem Link. Über den Link kann der Kunde das Angebot ansehen und **online annehmen** (vollständiger Name + Bestätigung). Gespeichert werden Zeitpunkt, Name und ein Prüfwert des versendeten PDFs. Die Annahme erscheint als Aufgabe in der Übersicht.
  - Annahme auch **von Hand** vermerken (per E-Mail, Telefon, persönlich, schriftlich).
  - Nach der Annahme: daraus eine **Hotelreservierung** oder **Tischreservierung** anlegen und eine **Anzahlung anfordern**.
  - Hinweis: Ob diese Form der Annahme für Ihre Verträge rechtlich ausreicht, ist nicht geprüft – bitte von einem Anwalt bestätigen lassen. Von außerhalb des Hauses funktioniert der Link erst mit dem geplanten Server.
- Posteingang: Bei Anfragen zu Feiern und Tagungen gibt es „Angebot erstellen“ – Name, E-Mail, Telefon, Datum und Personen werden übernommen.
- Reservierung: **Stammgast-Hinweis** neben dem Namen („War schon einmal hier“ bzw. „Stammgast“ ab zwei früheren Aufenthalten, mit Datum der letzten Abreise). Es gibt keine automatischen Rabatte.
- **Fehler behoben:** Ein Teil der Gäste-Links (Meldeschein per QR, Gäste-Link zur Buchung) ließ sich nicht öffnen und zeigte eine leere Fehlerseite. Diese Links funktionieren jetzt.

## 1.78.1

- Restaurant: Der **Ausblick** (Gäste ohne Reservierung / Gäste gehen früher, Wetter, Fußball, Veranstaltungen) ist vorerst ausgeblendet. Es werden dafür auch keine Wetter- oder Fußballdaten mehr abgerufen. Die Funktion bleibt im Programm erhalten und kann später wieder eingeschaltet werden. Anzahlungen und alles andere im Restaurant bleiben unverändert.

## 1.78.0

- Restaurant-Ausblick nach den Erfahrungen des Hauses:
  - **Kälte:** ab 10 °C und kälter zu den Essenszeiten deutlich mehr Gäste ohne Reservierung (bei Frost noch etwas mehr). Die bisherigen Stufen „kalt/kühl“ entfallen.
  - **Wintersaison** (November bis März): mehr Gäste – passend zur deftigen Winterküche.
  - **Fußball:** Läuft ein Spiel während der Öffnungszeit (mittags oder abends), gehen die Gäste erfahrungsgemäß schnell – die Einschätzung „Gäste gehen früher“ steigt deutlich.
  - Alle drei Werte lassen sich unter Ausblick → „Einstellen“ → „Erfahrungswerte des Hauses“ anpassen (Temperaturgrenze, Stärke, Wintersaison an/aus, Fußball-Stärke).

## 1.77.0

- **Anzahlung anfordern – Hotel:** In der Reservierung unter „Rechnungen und Zahlungen“ → „Anzahlung anfordern“: Betrag (Vorschlag 30 %), Frist, dann erscheint die E-Mail mit Bankverbindung und Verwendungszweck zum Prüfen. „Anfordern und senden“ oder „Nur vermerken (ohne E-Mail)“; „Abbrechen“ ändert nichts. Stand je Anzahlung: offen / überfällig / eingegangen. Eingang = Zahlung buchen über „Anzahlung buchen“ (das dürfen auch Mitarbeiter, genau in Höhe der angeforderten Anzahlung). Überfällige Anzahlungen stehen als Aufgabe in der Übersicht.
- **Anzahlung anfordern – Restaurant:** Bei einer Tischreservierung („Ändern“) → „Anzahlung anfordern“ (E-Mail-Adresse eintragen). Das Programm kassiert hier nicht: Eingang wie gewohnt in der Kasse buchen und hier „Eingang vermerken“. In der Tagesliste steht der Stand an der Reservierung; überfällige Anzahlungen werden oben angezeigt.
- **Meldescheine automatisch löschen:** Ein Jahr nach der Anreise löscht das Programm Geburtsdatum, Staatsangehörigkeit und Ausweisnummer aus dem Gästeprofil (nur wenn der Gast inzwischen nicht wieder da war und keine Reservierung offen hat). Name und Anschrift bleiben für Rechnungen. Alte Protokolleinträge mit diesen Angaben werden anonymisiert. Im Meldeschein-Archiv steht dann „Angaben gelöscht“; der Administrator kann es dort aus- und einschalten. Papier-Meldescheine bitte weiterhin selbst vernichten.
- **Buchungsliste für den Steuerberater** (Rechnungen → Export): Rechnungen je Steuersatz (Forderung an Erlös) und Zahlungen (Kasse/Bank/Karte an Forderung) mit Soll- und Haben-Konto. Konten einstellbar (Vorschlag SKR03 oder SKR04) – ungeprüft, bitte mit dem Steuerberater abstimmen. Ein DATEV-Importformat ist noch nicht enthalten.

## 1.76.0

Korrekturen bei Rechnungen, Zahlungen, Löschen und TSE (aus der Logik-Durchsicht, freigegeben):
- **Anzahlung bei Teilrechnungen:** Landet eine Anzahlung ganz auf der ersten Rechnung (z. B. „nur Übernachtung“), wird der Überschuss automatisch mit den übrigen Rechnungen derselben Reservierung verrechnet. Es wird nichts mehr doppelt zum Kassieren angeboten; offene Rechnungen, Übersicht und Rechnungs-PDF zeigen die Verrechnung („Verrechnet aus Anzahlung“). Die Zahlungen selbst bleiben unverändert.
- **Zahlungen:** Mitarbeiter buchen immer genau den offenen Betrag (Feld ist gesperrt). Teilzahlungen (z. B. Teilüberweisung) und Minusbeträge (Erstattungen) bucht nur der Administrator.
- **Testphase beenden** (Einstellungen → System → Daten löschen, mit Passwort und dem Wort ECHTBETRIEB): Danach lassen sich Rechnungen, Zahlungen und TSE-Aufzeichnungen nicht mehr löschen. Probedaten vorher mit „Alles auf Null“ entfernen. Im Programm nicht rückgängig zu machen.
- **Umzugspaket einspielen:** verlangt jetzt Ihr Passwort; stehen auf dem Zielrechner schon Buchungen oder Rechnungen, muss das Ersetzen ausdrücklich angekreuzt werden; vorher wird automatisch gesichert (Windows-Version).
- **E-Rechnung:** je Rechnung höchstens eine unversendete (erneutes Erzeugen ersetzt sie mit aktuellem Stand); zu einer stornierten Rechnung wird keine E-Rechnung mehr versendet.
- **Unklare Kartenzahlung:** Nach „Ja, am Gerät gezahlt“ geht es wie beim normalen Bezahlen weiter (Rechnung, Check-out).
- **TSE:** Nach einer abgelehnten PIN bleibt die Aufzeichnung pausiert, bis eine neue PIN eingetragen wird – Aus- und Einschalten verbraucht keinen weiteren PIN-Versuch mehr. Neues Häkchen „TSE verwenden“; ist es aus, greift das Programm nicht auf die TSE zu (Zahlungen werden als nicht aufgezeichnet vermerkt). Lesen/Selbsttest schalten die Verbindung nicht mehr stillschweigend ein.
- **Rechnung ausstellen:** Wurde die Reservierung nach dem Anlegen des Entwurfs geändert (Preis, Nächte, Leistungen), wird nicht ausgestellt – Hinweis: Entwurf löschen und neu erstellen.

## 1.75.0

- Temperaturkontrolle beim Start: Statt „Ja, alles im Sollbereich“ wird je Messstelle der **abgelesene Wert angetippt** (z. B. Tiefkühler −18° bis −25°, Kühlschrank +2° bis +7°) oder eingetippt. Gespeichert wird der echte Wert mit Name und Uhrzeit. Werte außerhalb des Sollbereichs gehen über „Nein – Werte eintragen“ (mit Maßnahme).
- Durchsicht auf Logikfehler – behoben:
  - Übersicht: „Check-out“ bei den Abreisen öffnet jetzt die Reservierung (mit Prüfung offener Beträge) statt sofort auszuchecken.
  - Zusage/Absage für ein einzelnes Zimmer: die E-Mail nennt nur dieses Zimmer. Klappt das Senden nach der Änderung nicht, steht klar da, was schon geändert ist („Abbrechen“ heißt dann „Schließen ohne E-Mail“).
  - Belegungsplan: Verschieben per Ziehen erst nach Rückfrage (vorher/nachher).
  - Leistung entfernen: mit Rückfrage.
  - Check-out zurücknehmen nach vorzeitiger Abreise wird abgelehnt (die entfernten Nächte kämen sonst nicht zurück); Hinweis auf das automatische Auschecken.
  - Temperaturprotokoll: Eingaben in anderen Bereichen gehen beim Speichern nicht mehr verloren; Warnung beim Datumswechsel mit ungespeicherten Werten.
  - Startabfrage Reinigung: „Ja“ ist nicht mehr vorausgewählt (Eingabetaste bestätigt nichts mehr ungesehen); „Nein – einzeln abhaken“ öffnet das Reinigungsprotokoll.
  - Zimmerreinigung: „Fertig/Zu reinigen“ nur in der Liste von heute.
  - Restaurant: „Gäste da“ nur am Tag der Reservierung, „Nicht erschienen“ nicht im Voraus.
  - Übergabebuch: ein zweites „Erledigt“ überschreibt den ersten Vermerk nicht mehr; „Wieder öffnen“ mit Rückfrage.
  - Gästeseite: Stornieren bricht ab, wenn sich die angezeigte Gebühr inzwischen geändert hat; die Ankunftszeit erzeugt nur bei Änderung einen Eintrag im Übergabebuch; Online-Anfragen aus dem Internet höchstens 6 je Absender und Tag.
  - Online-Meldeschein: leere Felder löschen keine vorhandenen Angaben (z. B. Ausweisnummer).
  - Kartenzahlung „Nur buchen (ohne Gerät)“ mit Rückfrage; „Neue Rechnung“ legt bei Doppelklick nur eine an.
  - Anfrageformular der Gästeseite speichert keine anderen, noch ungespeicherten Änderungen mehr mit.
  - Benutzer: Rückfrage, bevor man das eigene Konto deaktiviert oder sich selbst die Administrator-Rechte nimmt.

## 1.74.0

- Reservierung: Zusagen, Absagen und Stornieren laufen jetzt immer gleich – **zuerst erscheint die E-Mail an den Gast**, geändert wird erst mit „… und senden“ oder „Ohne E-Mail …“. **„Abbrechen“ ändert nichts.** Ohne E-Mail-Adresse kommt eine Rückfrage.
  - **Zusagen / Bestätigen** (Anfrage): Text „Wir bestätigen Ihnen …“, danach fest gebucht.
  - **Absagen** (Anfrage): Text „Leider können wir Ihnen … kein passendes Zimmer anbieten“, danach ist das Zimmer wieder frei.
  - **Stornieren** (fest gebuchtes Zimmer): Text „Hiermit bestätigen wir die Stornierung …“ mit dem betroffenen Zimmer.
- Neu bei Anfragen: **„✉ Nachfrage per E-Mail“** – Vorlage „Damit wir Ihre Reservierung bearbeiten können, benötigen wir noch folgende Angaben: …“. Die Anfrage bleibt offen; in der Notiz wird „Rückfrage per E-Mail gesendet“ vermerkt.
- **Reaktivieren** eines stornierten Zimmers fragt jetzt nach: „Als Anfrage (vorläufig)“ oder „Fest buchen“ – vorher wurde ohne Rückfrage fest gebucht.
- Alle Texte sind vor dem Senden änderbar.

## 1.73.1

- Fehler behoben: Bei einer offenen Anfrage hat „Zusagen“ sofort fest gebucht – auch wenn man die E-Mail danach mit „Abbrechen“ geschlossen hat. Jetzt erscheint zuerst die Zusage-E-Mail (Text „Wir bestätigen Ihnen …“), und gebucht wird erst mit **„Zusagen und senden“** oder **„Ohne E-Mail zusagen“**. **„Abbrechen“ ändert nichts** – die Anfrage bleibt offen. Ohne E-Mail-Adresse des Gastes kommt wie bisher eine Rückfrage.
- Klappt das Senden nach der Zusage nicht (z. B. Postfach nicht erreichbar), meldet das Programm „Zugesagt, aber die E-Mail wurde nicht gesendet“ und das Fenster bleibt zum erneuten Senden offen.

## 1.73.0

- Meldeschein: Auf Wunsch steht neben dem WLAN-QR-Code ein zweiter QR-Code **„Ihre Buchung online“** mit dem persönlichen Gäste-Link (A4 und Bondrucker). Einschalten unter Einstellungen → Haus → Check-in & Meldeschein → „Persönlichen Gäste-Link als QR-Code aufdrucken“; der Text daneben ist änderbar.
- Gästeseite während des Aufenthalts (nach dem Check-in): neuer Bereich **„Während Ihres Aufenthalts“** mit
  - **Zimmerreinigung wünschen** – Aufgabe im Übergabebuch und das Zimmer steht unter „Zu reinigen“,
  - **Heute keine Reinigung** – Notiz im Übergabebuch,
  - **Etwas bringen lassen** – Handtücher, Kopfkissen, Decke … antippen oder selbst schreiben; Aufgabe im Übergabebuch,
  - **Abreise melden** – Aufgabe „Bezahlung und Check-out prüfen“; der Gast wird dabei **nicht** automatisch ausgecheckt.
  Jede Meldung erscheint auch im Verlauf der Reservierung. Zweimal dieselbe Meldung innerhalb von 3 Minuten wird abgefangen.
- Hinweis: Ohne eingetragene Internet-Adresse führt der QR-Code zu diesem Rechner im Hausnetz – das klappt nur, wenn das Handy des Gastes im selben Netz ist. Zuverlässig mit dem Online-Server.

## 1.72.0

- Reservierung: Das Anfrage-Feld nimmt keinen Platz mehr weg. Bei vorläufigen Reservierungen steht oben neben „Gästeprofil“ der Knopf **„Anfrage ❗“** – erst ein Klick darauf öffnet Anrufen, Nachfrage vermerken, Zusagen und Absagen (mit ✕ wieder schließen).
- Neu im Restaurant: **Ausblick** über der Reservierungsliste (heute und künftige Tage). Zwei Einschätzungen – „Gäste ohne Reservierung“ und „Gäste gehen früher“ – jeweils niedrig/mittel/hoch; ein Klick zeigt die Gründe mit Punkten. Berücksichtigt werden:
  - Wochentag und bundesweite Feiertage (heute und morgen),
  - Wetter zu den Essenszeiten (kalt oder nass → eher mehr Gäste ohne Reservierung; warm und trocken → eher weniger; Gewitter/Schnee → eher weniger) – Daten des Deutschen Wetterdienstes über den freien Dienst Bright Sky,
  - Fußball am Abend (1./2. Bundesliga, DFB-Pokal über OpenLigaDB; ein Lieblingsverein zählt extra) → Gäste gehen eher früher,
  - selbst eingetragene Veranstaltungen („+ Veranstaltung“: bringt Gäste / hält fern / Gäste gehen früher),
  - wie viele Plätze schon reserviert sind (Hinweis bei fast voll).
- Einrichten (Administrator, „Einstellen“): Standort per Google-Maps-Link übernehmen, Essenszeiten, Ligen, Lieblingsverein. An die Dienste gehen nur die Koordinaten des Hauses bzw. das Liga-Kürzel, keine Gästedaten.
- Wichtig: Das ist eine einfache Regel-Schätzung mit selbst gewählten Gewichten, keine Vorhersage aus Erfahrungsdaten. Schulferien, regionale Feiertage, Länderspiele und Champions League sind nicht automatisch dabei.

## 1.71.0

- Offene Anfragen direkt bearbeiten: In einer vorläufigen Reservierung erscheint oben das Feld **„Offene Anfrage“** mit
  - **Anrufen** (zeigt die Telefonnummer; öffnet das Telefonprogramm des Geräts, falls eines eingerichtet ist – am Handy die Telefon-App),
  - E-Mail-Adresse zum Anklicken,
  - **Nachfrage vermerken**: Ergebnis antippen („nicht erreicht“, „Nachricht hinterlassen“, „überlegt noch“, „ruft zurück“, „wartet auf Angebot“) oder frei eintippen, auf Wunsch die Option um 1/3/7/14 Tage verlängern (höchstens bis zur Anreise). Der Vermerk wird mit Datum, Uhrzeit und Namen in die Notiz geschrieben,
  - **Zusagen** (alle vorläufigen Zimmer werden fest gebucht; ist eine E-Mail-Adresse da, öffnet sich gleich die Bestätigungs-E-Mail zum Prüfen und Senden),
  - **Absagen / Stornieren** (mit Rückfrage; das Zimmer wird wieder frei).
- Angezeigt werden außerdem, wann angefragt wurde und bis wann die Option läuft (rot, wenn abgelaufen).

## 1.70.0

- Neue Reservierung, schneller am Telefon: Anreise und Abreise stehen jetzt ganz oben, darunter sofort die freien Zimmer.
- Statt des Auswahlfelds „Status“ zwei Knöpfe: **„Als Anfrage anlegen“** (vorläufig – das Zimmer wird freigehalten, später bestätigen oder stornieren) und **„Fest buchen“**. Die Eingabetaste legt absichtlich nichts an.
- Bei Anfragen ist „Option bis“ automatisch vorbelegt: heute + 3 Tage, höchstens bis zur Anreise. Die Anzahl Tage lässt sich unter Einstellungen → Haus ändern („Anfragen: Zimmer freihalten (Tage)“).
- Das Feld „Notiz (intern)“ ist für Rückruf-Notizen gedacht („ruft Freitag zurück“); bei Anfragen erscheinen Notiz und Optionsfrist in der Reservierungsliste unter dem Gastnamen.
- Übersicht: neue Kachel **„Offene Anfragen“** mit der Anzahl aller vorläufigen Reservierungen, egal wie weit die Anreise entfernt ist. Ein Klick öffnet die Liste der Anfragen.

## 1.69.0

- Neu: Umzug auf einen anderen Rechner oder Server (Einstellungen → System → Datensicherung, nur Administrator). „Umzugspaket erstellen“ schreibt ALLE Daten (Gäste, Buchungen, Rechnungen, Zahlungen, Benutzerkonten samt Passwörtern und Zwei-Faktor-Anmeldung, Einstellungen, Protokoll, Bilder) und den Schlüssel dieser Installation in eine einzige Datei, verschlüsselt mit einem selbst gewählten Passwort (mind. 10 Zeichen). Auf dem neuen Rechner bzw. Server: Programm installieren (gleiche oder neuere Version), dort ein vorläufiges Administrator-Konto anlegen, Paket auswählen, Passwort eingeben, „Paket prüfen“ zeigt den Inhalt, mit dem Wort UMZUG bestätigen. Danach gelten dort die bisherigen Zugangsdaten. Das Einspielen ersetzt alle Daten des Zielrechners und geschieht in einem Schritt – klappt etwas nicht, bleibt der Zielrechner unverändert. Der Schutz von Rechnungen, Zahlungen und Protokoll gegen Ändern und Löschen ist danach wieder aktiv.

## 1.68.0

- Neu: Kunden aus dem alten Programm importieren (Gäste → „Kunden importieren“, nur Administrator). Die Datei Kunden.dat auswählen; das Programm zeigt zuerst nur an, was übernommen würde (Anzahl, Beispiele), erst „Jetzt importieren“ legt an. Privatpersonen werden Gäste (Anrede, Vor- und Nachname, Straße, PLZ, Ort, Telefon, E-Mail), Firmen (erkannt an Rechtsform/Stichwort oder Ansprechpartner „Herr/Frau …“) werden Firmen mit Ansprechpartner. Die alte Kundennummer steht in den Bemerkungen. Platzhalter („*** … ***“) und leere Datensätze werden übersprungen, schon vorhandene Gäste/Firmen (gleicher Name und PLZ) ebenfalls – ein zweiter Lauf legt nichts doppelt an. Im Protokoll stehen nur die Anzahlen.

## 1.67.0

- Daten löschen: neuer Knopf „Alles auf Null“ – wählt mit einem Klick alles aus: Rechnungen, Zahlungen und Umsätze, alle Buchungen und Sperren, Gäste, Firmen, E-Mail-Posteingang; Rechnungs- und Buchungsnummern beginnen wieder bei 1, alle Zimmer gelten wieder als sauber, von Hand eingetragene Reinigungen entfallen. Die Einrichtung (Zimmer, Preise, Benutzer, Einstellungen) bleibt. Wie bisher: erst „Prüfen“, dann Passwort und LÖSCHEN eintippen; vorher wird automatisch eine Datensicherung geschrieben.
- Daten löschen: neue Auswahl „Firmen ohne Buchung“.

## 1.66.0

- Gästeseite, Gutscheine: Beträge 25 €, 50 €, 75 €, 100 € und „Individuell“ zum Antippen – direkt im Abschnitt Gutscheine (öffnet die Anfrage mit dem Betrag) und im Anfrageformular. Bei „Individuell“ erscheint ein Feld für den Wunschbetrag oder Wunsch (z. B. „Abendessen für zwei“). Der Betrag steht im Betreff der Anfrage im Posteingang.

## 1.65.0

- Reinigung: „+ Reinigung von Hand eintragen“ – Zimmer wählen, Komplettreinigung oder Zwischenreinigung (Gäste noch da), optional eine Notiz (z. B. „Handtücher wechseln“). Die Einträge stehen über der Liste, lassen sich mit „Fertig“ abhaken oder entfernen.
- Reinigung: „Bon drucken“ druckt die Reinigungsliste des Tages auf dem Bondrucker – was laut Belegung ansteht (Endreinigung, Zwischenreinigung, danach Anreise) und darunter die von Hand eingetragenen, noch offenen Reinigungen, je mit „[ ] erledigt“ zum Abhaken.

## 1.64.0

Reservierung übersichtlicher, Bezahlen in einem Schritt:

- Reservierungsfenster: oben der Gast (Name, Kontakt, Anschrift, „Gästeprofil“) mit Anreise, Abreise, Nächten, Zimmer, Personen und dem Stand („Anreise heute“, „Im Haus“, „Im Haus · bezahlt – Check-out am … automatisch“, „Abgeschlossen“). Daneben ein großer Knopf für den nächsten Schritt: Check-in → Bezahlen → (Check-out). Geldbeträge stehen nur noch klein darunter; Leistungen, Rechnungen/Zahlungen, Angaben und Verlauf sind aufklappbar.
- Nach dem Check-in: „Weiter zum Bezahlen“ direkt im Fenster „Eingecheckt“.
- Bezahlen: immer der ganze offene Betrag (keine Teilzahlung, keine Überzahlung); die Rechnung wird dabei ausgestellt, sobald der Gast angereist ist. Reist der Gast heute ab, wird er nach dem Bezahlen gleich ausgecheckt (Haken, vorbelegt).
- Automatischer Check-out: Bezahlte Gäste werden am Abreisetag nach der Check-out-Zeit des Hauses ausgecheckt (Zimmer wird als zu reinigen markiert). Nur wenn alles berechnet und bezahlt ist; abschaltbar unter Einstellungen → Haus → Check-in & Meldeschein.
- Vorzeitige Abreise: Hinweis, dass eine schon ausgestellte Rechnung danach nicht mehr passt.

## 1.63.0

- Neu: Zettel für die Buchhaltung. Nach „Bezahlen / Abrechnen“ gibt es „A4 drucken“ und „Bon drucken“. Der Zettel zeigt Reservierung, Gast, Aufenthalt, Zimmer, die eben gebuchte Zahlung (Zahlungsart, Betrag, bei Bar gegeben/Rückgeld, Rechnungsnummer, TSE-Vorgang, wer kassiert hat), Summe je Zahlungsart, die Rechnungen mit Steueraufteilung (netto, MwSt je Steuersatz, brutto), Gesamtbetrag, bezahlt und offen sowie ein Feld „Geprüft / abgelegt“.
- In der Reservierung unter Abrechnung: „Zettel Buchhaltung“ mit allen Zahlungen und Rechnungen der Reservierung.
- Der Zettel ist ein interner Vermerk zum Abheften – kein Kassenbeleg und keine Rechnung.

## 1.62.1

- Meldeschein (A4): Lange WLAN-Namen liefen aus dem Kasten und über die Hausinformationen. Jetzt steht der WLAN-Kasten über die ganze Breite, darunter die Hausinformationen; lange Namen und Texte werden umbrochen. Passt weiterhin auf eine Seite.

## 1.62.0

- Neu: Meldeschein-Archiv (Hotel → Kunden → Meldeschein-Archiv). Alle Check-ins mit Anreise, Abreise, Gast, Zimmer, Personen und Reservierungsnummer; Suche nach Name, Ort, Zimmer oder Reservierung; Zeitraum wählbar.
- Je Eintrag: ob Angaben fehlen (Anschrift, Geburtsdatum, Staatsangehörigkeit), ob der Gast sie online ausgefüllt hat, „Drucken“ (Nachdruck ohne Gästeinformationen) und ein Klick auf den Namen öffnet die Reservierung.
- Sammeldruck: mehrere oder alle angezeigten Meldescheine auswählen und auf einmal drucken (je einer pro Seite).
- Aufbewahrungsfrist je Eintrag (§ 30 Abs. 4 BMG: ein Jahr ab Anreise, danach innerhalb von drei Monaten vernichten – bitte selbst prüfen); Filter „Nur abgelaufene Aufbewahrungsfrist“. Gelöscht wird nichts automatisch.
- Hinweis: Die Angaben kommen aus Reservierung und aktuellem Gästeprofil; eine eigene, unveränderliche Kopie wird nicht gespeichert (dafür wäre eine Erweiterung der Datenbank nötig).

## 1.61.4

Ergebnisse einer Fehlerprüfung aller Änderungen seit 1.55.2:

- E-Mail-Erkennung: „Stammtisch“ mit Tischwunsch wird wieder als Tischanfrage erkannt; eigene Stichwörter aus den Einstellungen zählen stärker als die festen; bei Gleichstand gewinnt die konkretere Anfrage (Tisch, Zimmer). Werbe-Newsletter mit „Gutschein“ im Betreff landen unter „Sonstiges“ statt als Gutscheinanfrage.
- Programm-Update: Ein zweiter Klick auf „Jetzt aktualisieren“ (z. B. an einem anderen Gerät) während der Prüfung startet kein zweites Update mehr.
- „Update von Hand.bat“: Eine vollständig geladene, aber beschädigte Datei wird gelöscht und neu geladen, statt 15-mal erfolglos zu prüfen.
- Google-Maps-Link: Bei 4-stelliger Postleitzahl ohne Länderangabe (Österreich/Schweiz) wird nicht mehr „Deutschland“ eingetragen.
- Check-in & Meldeschein (Einstellungen): Ist der WLAN-Abschnitt ausgeblendet, werden die WLAN-Angaben beim Speichern nicht mehr geprüft und gespeichert (vorher konnte das Speichern ohne Meldung scheitern).
- Webseiten-Logo: Sehr große PNG-Logos werden notfalls weiter verkleinert, statt abgelehnt zu werden.
- Kleinere Verbesserungen: Maps-Erkennung an einer Stelle, Gästeseite lädt das Rechnungslogo nicht mehr bei jedem Aufruf, Bondruck lädt seine Daten gleichzeitig.

## 1.61.3

- Behoben: Die Seite „Programm-Update“ blieb seit 1.61.1 leer (Programmierfehler in der Seite).
- Tritt beim Anzeigen einer Seite ein Fehler auf, erscheint jetzt ein Hinweis mit „Neu laden“ statt einer leeren Seite; die anderen Seiten bleiben über das Menü erreichbar.
- Neue automatische Code-Prüfung (oxlint) für die Oberfläche; sie läuft bei jedem Windows-Bau und hätte diesen Fehler verhindert.
- „Update von Hand.bat“: arbeitet jetzt nur mit Windows-Bordmitteln (curl, certutil, tar) – die erste Fassung scheiterte an der Prüfsummen-Kontrolle über PowerShell.

## 1.61.2

- Neu im Programmordner: „Update von Hand.bat“ – der Notweg, falls das Update im Programm nicht klappt. Doppelklick lädt die neueste Version (setzt bei Verbindungsabbruch fort, bis zu 15 Versuche), prüft die Prüfsumme, beendet das PMS, schreibt eine Datensicherung, kopiert die neuen Programmdateien (data, backups und pms.env bleiben unverändert, die bisherigen Dateien liegen in update\previous) und startet das PMS wieder. Der Windows-Bau prüft diesen Weg automatisch mit.

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
