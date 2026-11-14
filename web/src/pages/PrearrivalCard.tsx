import { useEffect, useState } from 'react';
import { prearrivalInput, type PrearrivalState } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, fmtDateTime, useLoad, useSubmit, useToast } from '../ui.tsx';

/** Algorithmen → Gäste-E-Mail: Nachricht einige Tage vor der Anreise. */
export function PrearrivalCard() {
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api<PrearrivalState>('GET', '/settings/prearrival'));
  const [v, setV] = useState<{ enabled: boolean; daysBefore: string; time: string; extraText: string } | null>(null);
  useEffect(() => { if (data) setV({ enabled: data.settings.enabled, daysBefore: String(data.settings.daysBefore), time: data.settings.time, extraText: data.settings.extraText }); }, [data]);
  const f = useSubmit(prearrivalInput, async (d) => { await api('PUT', '/settings/prearrival', d); toast('Gespeichert'); reload(); });
  if (!v || !data) return <section className="card"><h2>Nachricht vor der Anreise</h2><LoadState error={error} loading /></section>;
  return (
    <>
      <form className="card" onSubmit={(e) => void f.submit({ ...v, daysBefore: Number(v.daysBefore) }, e)} noValidate>
        <h2>Nachricht vor der Anreise</h2>
        <p className="muted">Einige Tage vor der Anreise bekommt der Gast von selbst eine E-Mail mit Anreisetag, Check-in-Zeit, Anschrift und Ihrem Zusatztext. Jede Reservierung bekommt die Nachricht höchstens einmal.</p>
        {!data.mailReady && <p className="notice warn">Der E-Mail-Versand ist noch nicht eingerichtet (Einstellungen → E-Mail). Solange wird nichts gesendet.</p>}
        <div className="formgrid cols3">
          <label className="check wide"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /><span>Nachricht vor der Anreise senden</span></label>
          <Field label="Tage vor der Anreise" error={f.errors.daysBefore} hint="1 bis 14"><input inputMode="numeric" value={v.daysBefore} onChange={(e) => setV({ ...v, daysBefore: e.target.value })} /></Field>
          <Field label="Frühestens um" error={f.errors.time}><input type="time" value={v.time} onChange={(e) => setV({ ...v, time: e.target.value })} /></Field>
          <Field label="Eigener Zusatztext" error={f.errors.extraText} hint="z. B. Anfahrt, Parken, Schlüssel bei später Anreise" wide><textarea rows={4} value={v.extraText} onChange={(e) => setV({ ...v, extraText: e.target.value })} /></Field>
        </div>
        <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button></div>
        <p className="muted small">Bisher gesendet: {data.sentTotal}{data.settings.enabled ? ` · stehen jetzt an: ${data.dueNow}` : ''}{data.lastRun ? ` · zuletzt geprüft ${fmtDateTime(data.lastRun)}` : ''}.
          Gesendet wird nur an bestätigte Reservierungen mit E-Mail-Adresse beim Gast, die vor mehr als 12 Stunden angelegt wurden. Die Nachricht enthält nur Angaben zur gebuchten Reise – keine Werbung und keine Bitte um Bewertung.</p>
      </form>
      <section className="card">
        <h2>So sieht die Nachricht aus</h2>
        <p className="muted">Beispiel mit erfundenem Gast; nach dem Speichern wird es aktualisiert.</p>
        <p><b>{data.sample.subject}</b></p>
        <pre className="mailbody">{data.sample.text}</pre>
      </section>
    </>
  );
}
