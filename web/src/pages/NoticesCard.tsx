import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type NoticeKey, type Notices } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { noticesChanged, useNotices } from '../notices.ts';
import { Button, LoadState, useToast } from '../ui.tsx';

const GROUPS: { title: string; items: [NoticeKey, string, string][] }[] = [
  { title: 'Beim Start des Programms', items: [
    ['hygieneTemp', 'Eigenkontrolle: „Alles im Sollwert?“', 'Fragt im Startmenü je Bereich nach den Temperaturen, solange heute noch nichts eingetragen ist.'],
    ['hygieneClean', 'Eigenkontrolle: „Reinigung erledigt?“', 'Fragt im Startmenü nach fälligen Reinigungsaufgaben.'],
  ] },
  { title: 'Während der Arbeit', items: [
    ['netAlert', 'Internet ausgefallen', 'Hinweisfenster und roter Balken, wenn die Internetverbindung weg ist. Jeder Arbeitsplatz kann das zusätzlich für sich ausschalten (Internet → Internetverbindung).'],
    ['mailCount', 'Zähler neuer E-Mail-Anfragen', 'Zahl an der Kachel „E-Mail“ im Startmenü.'],
    ['teamCount', 'Zähler ungelesener Übergaben', 'Zahl an der Kachel „Team“ im Startmenü.'],
  ] },
  { title: 'Für den Administrator', items: [
    ['backupWarn', 'Warnung zur Datensicherung', 'Roter Hinweis im Startmenü, wenn die Sicherung fehlt oder zu alt ist. Bitte nur ausschalten, wenn die Sicherung anders überwacht wird.'],
    ['updateHint', 'Programm-Update verfügbar', 'Hinweis im Startmenü, sobald eine neue Version bereitsteht.'],
    ['setupHint', 'Einrichtung unvollständig', 'Hinweis im Startmenü, solange bei „Erste Schritte“ Grundlagen fehlen.'],
  ] },
];

/** Mitteilungen: was das Programm von sich aus meldet – für das ganze Haus ein- und ausschaltbar. */
export function NoticesCard() {
  const toast = useToast();
  const loaded = useNotices();
  const [v, setV] = useState<Notices | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (loaded && !v) setV(loaded); }, [loaded, v]);
  if (!v) return <section className="card"><h2>Mitteilungen</h2><LoadState error={null} loading /></section>;
  const save = async () => {
    setBusy(true);
    try { noticesChanged(await api<Notices>('PUT', '/settings/notices', v)); toast('Mitteilungen gespeichert'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  const all = (on: boolean) => setV(Object.fromEntries(Object.keys(v).map((k) => [k, on])) as unknown as Notices);
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="cardhead"><div><h2>Mitteilungen</h2><p className="muted">Was das Programm von sich aus meldet. Die Auswahl gilt für alle Arbeitsplätze im Haus.</p></div>
        <div className="actions"><Button onClick={() => all(true)}>Alle an</Button><Button onClick={() => all(false)}>Alle aus</Button></div></div>
      {GROUPS.map((g) => (
        <div key={g.title}>
          <h3>{g.title}</h3>
          <div className="noticelist">
            {g.items.map(([k, label, text]) => (
              <label key={k} className="noticeitem"><input type="checkbox" role="switch" checked={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} /><span><b>{label}</b><small>{text}</small></span></label>
            ))}
          </div>
        </div>
      ))}
      <div className="formactions"><Button type="submit" variant="primary" busy={busy}>Speichern</Button></div>
      <p className="muted small">Ausgeschaltet heißt nur: Das Programm meldet sich nicht von selbst. Die Angaben bleiben an ihrem Platz abrufbar – z. B. offene Temperaturen unter Kontrollen, die Sicherung unter <Link to="/einstellungen?ansicht=sicherung">Datensicherung</Link>. E-Mails an Gäste (Bestätigung, Nachricht vor der Anreise) stellen Sie unter <Link to="/einstellungen?ansicht=algorithmen">Algorithmen</Link> ein.</p>
    </form>
  );
}
