import { PageHeader } from '../ui.tsx';

/** Das PMS wie ein Programm öffnen: eigenes Fenster, Symbol auf dem Desktop, im Startmenü und an der Taskleiste. */
export function AsProgram() {
  const here = window.location.origin;
  const local = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  return (
    <>
      <PageHeader title="Als Programm öffnen" sub="Eigenes Fenster mit Symbol auf dem Desktop und an der Taskleiste – auf jedem Windows-PC einzeln einrichten" />
      <section className="card">
        <h2>Symbol auf diesem PC anlegen</h2>
        <p>Die Datei legt auf <b>diesem PC</b> ein Symbol „Schuetzenhaus PMS“ auf dem Desktop und im Startmenü an. Ein Klick darauf öffnet das PMS in einem eigenen Fenster – ohne Adressleiste und Tabs, wie ein gewöhnliches Programm. Es wird nichts installiert; das Fenster stellt Microsoft Edge (oder Google Chrome) bereit.</p>
        <ol className="steps">
          <li><a className="btn primary" href="/api/v1/desktop-shortcut.bat" download>Datei herunterladen</a></li>
          <li>Die heruntergeladene Datei „PMS als Programm einrichten.bat“ doppelt anklicken. Fragt Windows nach („Der Computer wurde durch Windows geschützt“), auf „Weitere Informationen“ und „Trotzdem ausführen“ klicken.</li>
          <li><b>An die Taskleiste anheften:</b> Rechtsklick auf das neue Symbol auf dem Desktop → „An Taskleiste anheften“ (unter Windows 11 zuerst „Weitere Optionen anzeigen“). Für das Startmenü: „An Start anheften“.</li>
        </ol>
        <p className="muted small">Das Symbol öffnet die Adresse <code>{here}</code>, unter der Sie das PMS gerade benutzen. {local ? 'Das ist die Adresse für den Rechner, auf dem das PMS läuft. Für einen anderen PC rufen Sie diese Seite dort im Browser auf und laden die Datei dort herunter – dann stimmt die Adresse für jenen PC.' : 'Ändert sich die Adresse des PMS-Rechners im Netz, die Datei einfach noch einmal herunterladen und ausführen.'} Das PMS selbst läuft weiter auf dem PMS-Rechner; das Fenster zeigt es nur an. Anmelden müssen Sie sich wie bisher.</p>
      </section>
      <section className="card">
        <h2>Ohne Datei: direkt im Browser</h2>
        <p>In Microsoft Edge geht es auch von Hand: oben rechts auf „…“ → „Apps“ → „Diese Website als App installieren“. Edge bietet danach selbst an, das Programm an Taskleiste und Startmenü anzuheften. In Google Chrome: „⋮“ → „Streamen, speichern und teilen“ → „Seite als App installieren“.</p>
        <p className="muted small">Die Bezeichnungen der Menüpunkte können je nach Browser-Version etwas anders lauten. Auf einem Windows-PC habe ich beides nicht selbst ausprobieren können; das Anlegen des Symbols über die Datei wird beim Bau der Windows-Version automatisch geprüft.</p>
      </section>
    </>
  );
}
