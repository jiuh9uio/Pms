import { Button, PageHeader } from '../ui.tsx';
import { PrintLogo } from '../logo.tsx';

/** Kurzanleitung fürs Team: die häufigsten Abläufe auf einer Seite – zum Ausdrucken und Aushängen. */
const STEPS: { title: string; steps: string[] }[] = [
  { title: 'Zimmeranfrage am Telefon', steps: ['Hotel → Belegungsplan oder „Neue Reservierung“.', 'Datum und Zimmer wählen, Gast eintragen.', 'Noch nicht sicher? „Als Anfrage anlegen“ – sonst „Fest buchen“.', 'Später in der Reservierung: „Anfrage ❗“ → „Zusagen“ (E-Mail prüfen, senden) oder „Absagen“.'] },
  { title: 'Anfrage per E-Mail', steps: ['E-Mail → „Jetzt abrufen“ (oder es geht automatisch).', 'Nachricht öffnen, Zimmer- oder Tischanfrage übernehmen bzw. „Angebot erstellen“.', 'Erledigte Nachrichten als erledigt markieren.'] },
  { title: 'Anreise (Check-in)', steps: ['Hotel → Übersicht: Anreisen heute.', 'Reservierung öffnen → „Check-in“.', 'Meldeschein: „Meldeschein per QR“ (Gast füllt am Handy aus) oder „Meldeschein drucken“.', 'Wird gleich bezahlt: „Gleich bezahlen“.'] },
  { title: 'Abreise und Bezahlen', steps: ['Reservierung öffnen → „Bezahlen / Abrechnen“.', 'Zahlungsart wählen (Bar, Karte über das EC-Gerät, Überweisung).', 'Rechnung ausstellen, drucken oder per E-Mail senden.', '„Check-out“ – das Zimmer steht danach auf „zu reinigen“.'] },
  { title: 'Restaurant: Tisch reservieren', steps: ['Restaurant → Tag wählen → „Neue Reservierung“.', 'Gäste kommen: „Gäste da“; gehen: „Tisch frei“; nicht gekommen: „Nicht erschienen“.', 'Hotelgast will mit der Zimmerrechnung zahlen: „Aufs Zimmer“ → Zimmer antippen, Betrag und Steuersatz eintragen.'] },
  { title: 'Feier oder Tagung anfragen', steps: ['Angebote → „Neues Angebot“.', 'Erst Fragen klären? „Erst Fragen stellen“ wählen, Fragen eintragen, „Fragen per E-Mail senden“.', 'Sind die Antworten da: „Angebot erstellen“, Leistungen eintragen, „Per E-Mail senden“.', 'Nach der Annahme: Hotel- oder Tischreservierung anlegen, ggf. Anzahlung anfordern.'] },
  { title: 'Morgens: Kontrollen', steps: ['Beim Start fragt das Programm nach den Temperaturen – abgelesene Werte antippen oder eintragen.', 'Werte außerhalb des Sollbereichs: kurz die Maßnahme notieren (z. B. „Ware entsorgt, Gerät neu eingestellt“).', 'Frühstücks- und Reinigungsliste unter Hotel → Frühstück bzw. Reinigung.'] },
  { title: 'Übergabe an die nächste Schicht', steps: ['Team → „Neuer Eintrag“: Übergabe, Aufgabe oder Reparatur.', 'Erledigtes mit „Erledigt“ abhaken (mit kurzer Notiz).'] },
  { title: 'Abends: Tagesabschluss', steps: ['Rechnungen → Tagesabschluss.', 'Zahlungen je Zahlungsart mit Kasse und EC-Gerät vergleichen.', 'Ausdrucken bzw. abheften.'] },
  { title: 'Storniert oder nicht angereist', steps: ['Reservierung öffnen → Zimmer stornieren bzw. „Nicht angereist“.', 'Ausfallgebühr fällig? Bei „Rechnungen und Zahlungen“ → „Ausfallgebühr …“ – das legt einen Rechnungsentwurf an.', 'Entwurf prüfen und ausstellen.'] },
];

export function QuickGuide() {
  return (
    <>
      <PageHeader title="Kurzanleitung" sub="Die häufigsten Abläufe im Überblick – zum Ausdrucken und Aushängen" actions={<Button variant="primary" onClick={() => window.print()}>Drucken</Button>} />
      <section className="card printable quickguide">
        <h2 className="printhead"><PrintLogo />Kurzanleitung – die häufigsten Abläufe</h2>
        <div className="qg-grid">
          {STEPS.map((s, i) => (
            <article key={s.title} className="qg-item">
              <h3><span className="qg-num">{i + 1}</span>{s.title}</h3>
              <ol>{s.steps.map((t) => <li key={t}>{t}</li>)}</ol>
            </article>
          ))}
        </div>
        <p className="muted small">Wo etwas nicht passt oder fehlt: im Übergabebuch notieren – dann wird die Anleitung ergänzt. Rechte: Stornieren von Rechnungen, Einstellungen und Benutzer nur Administrator.</p>
      </section>
    </>
  );
}
