import { useEffect, useState } from 'react';
import { webRequestSettingsInput, type WebRequestSettings } from '../../../src/shared/inbox.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

/** Online-Buchungsanfrage: öffentliche Seite ein- und ausschalten, Begrüßung und Datenschutzhinweis. */
export function WebRequestCard() {
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api<WebRequestSettings>('GET', '/settings/web-request'));
  const [v, setV] = useState<WebRequestSettings | null>(null);
  useEffect(() => { if (data) setV(data); }, [data]);
  const f = useSubmit(webRequestSettingsInput, async (d) => { await api('PUT', '/settings/web-request', d); toast('Online-Anfrage gespeichert'); reload(); });
  if (!v) return <section className="card"><h2>Online-Buchungsanfrage</h2><LoadState error={error} loading /></section>;
  const url = `${window.location.origin}/anfrage`;
  return (
    <form className="card" onSubmit={(e) => void f.submit(v, e)} noValidate>
      <h2>Online-Buchungsanfrage (Vorbereitung)</h2>
      <p className="muted">Eine Seite ohne Anmeldung, auf der Gäste Zeitraum, Personenzahl und Kontaktdaten eintragen. Es wird nichts gebucht: Die Anfrage erscheint im Modul „E-Mail“ als Zimmeranfrage und wird dort wie gewohnt übernommen und beantwortet.</p>
      <p className="notice warn">Die Seite ist nur dort erreichbar, wo auch das Programm erreichbar ist – im Moment also nur im Hausnetz. Für Gäste im Internet muss das Programm auf einem von außen erreichbaren Server laufen; erst dann lässt sich die Adresse auf Ihrer Website verlinken.</p>
      <div className="formgrid">
        <label className="check wide"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /><span>Online-Anfragen annehmen</span></label>
        <Field label="Begrüßungstext auf der Seite" error={f.errors.intro} wide><textarea rows={2} value={v.intro} onChange={(e) => setV({ ...v, intro: e.target.value })} placeholder="z. B. Schön, dass Sie bei uns übernachten möchten." /></Field>
        <Field label="Datenschutzhinweis" error={f.errors.privacy} wide hint="Wer verarbeitet die Daten, wozu und wie lange – der Text kommt von Ihnen bzw. Ihrem Datenschutzberater"><textarea rows={4} value={v.privacy} onChange={(e) => setV({ ...v, privacy: e.target.value })} /></Field>
      </div>
      <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button>{v.enabled && <a className="btn" href="/anfrage" target="_blank" rel="noreferrer">Seite ansehen</a>}</div>
      <p className="muted small">Adresse der Seite: <code>{url}</code>. Geschützt ist sie gegen Massen-Einträge (höchstens 30 Aufrufe je Minute und Absender, verstecktes Köderfeld). Ohne eigenen Datenschutzhinweis sollte die Seite nicht öffentlich geschaltet werden.</p>
    </form>
  );
}
