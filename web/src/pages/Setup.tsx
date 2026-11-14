import { Link } from 'react-router-dom';
import type { SetupChecklist, SetupItem } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { useData } from '../data.tsx';
import { Badge, Button, LoadState, PageHeader, useLoad } from '../ui.tsx';

const LABEL: Record<SetupItem['state'], [string, 'ok' | 'danger' | 'neutral' | 'warn']> = { done: ['erledigt', 'ok'], todo: ['fehlt noch', 'danger'], optional: ['kann später', 'neutral'], check: ['bitte prüfen', 'warn'] };

/** Start-Checkliste für den Administrator: was vor dem echten Betrieb eingerichtet und geprüft sein sollte. */
export function Setup() {
  const { rev } = useData();
  const { data, error, reload } = useLoad(() => api<SetupChecklist>('GET', '/setup/checklist'), [rev]);
  return (
    <>
      <PageHeader title="Erste Schritte" sub="Was vor dem echten Betrieb eingerichtet und geprüft sein sollte" actions={<><Button onClick={reload}>Neu prüfen</Button><Button onClick={() => window.print()}>Drucken</Button></>} />
      <LoadState error={error} loading={!data} />
      {data && (
        <>
          <p className={`notice ${data.ready ? '' : 'warn'} printable`}>{data.ready
            ? <><b>Die Grundlagen stehen.</b> Sie können mit dem Hotelbetrieb im Programm beginnen. Die Punkte „bitte prüfen“ sind Dinge, die nur Sie an Ihren Geräten oder mit Ihrer Steuerberatung klären können.</>
            : <><b>Vor dem Start {data.open === 1 ? 'fehlt noch ein Punkt' : `fehlen noch ${data.open} Punkte`}</b> bei den Grundlagen.</>}</p>
          {data.groups.map((g) => (
            <section key={g.title} className="card printable">
              <h2>{g.title}</h2>
              <ul className="setuplist">{g.items.map((i) => (
                <li key={i.key} className={i.state}>
                  <span className="mark" aria-hidden>{i.state === 'done' ? '✓' : i.state === 'todo' ? '!' : i.state === 'check' ? '?' : '–'}</span>
                  <div><b>{i.title}</b> <Badge tone={LABEL[i.state][1]}>{LABEL[i.state][0]}</Badge><br /><small>{i.detail}</small></div>
                  <Link className="btn noprint" to={i.to}>Öffnen</Link>
                </li>
              ))}</ul>
            </section>
          ))}
          <section className="card printable">
            <h2>Empfohlene Reihenfolge</h2>
            <ol className="steps">
              <li>Die Punkte unter „Grundlagen“ erledigen.</li>
              <li>Ein paar Probe-Reservierungen anlegen, einchecken, abrechnen – und danach unter „Daten löschen“ wieder entfernen.</li>
              <li>Zwei bis vier Wochen neben dem bisherigen Ablauf arbeiten: Reservierungen in beiden führen, Rechnungen noch wie gewohnt schreiben.</li>
              <li>In dieser Zeit die Geräte der Reihe nach erproben und mit der Steuerberatung klären, ob Barzahlungen mit der TSE signiert werden müssen und ob Rechnung und Archiv so genügen.</li>
              <li>Erst danach Rechnungen und Zahlungen nur noch im Programm führen.</li>
            </ol>
            <p className="muted small">Die Checkliste liest nur die Einstellungen. Ob ein Gerät wirklich funktioniert und ob das Programm Ihre steuerlichen und datenschutzrechtlichen Pflichten erfüllt, kann sie nicht feststellen.</p>
          </section>
        </>
      )}
    </>
  );
}
