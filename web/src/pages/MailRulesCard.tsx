import { useEffect, useState } from 'react';
import { mailRulesInput, type MailRules } from '../../../src/shared/inbox.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useToast } from '../ui.tsx';

const lines = (s: string) => s.split(/[\n,;]/).map((x) => x.trim()).filter(Boolean);

/** Algorithmen → E-Mail: welche Nachrichten als Anfrage gelten und was im Posteingang erscheint. */
export function MailRulesCard() {
  const toast = useToast();
  const { data, error } = useLoad(() => api<MailRules>('GET', '/settings/mail-rules'));
  const [v, setV] = useState<{ hideOther: boolean; hotelWords: string; tableWords: string; ignoreSenders: string } | null>(null);
  const [busy, setBusy] = useState<'' | 'save' | 'apply'>('');
  const [fail, setFail] = useState<string | null>(null);
  useEffect(() => { if (data) setV({ hideOther: data.hideOther, hotelWords: data.hotelWords.join('\n'), tableWords: data.tableWords.join('\n'), ignoreSenders: data.ignoreSenders.join('\n') }); }, [data]);
  if (!v) return <section className="card"><h2>E-Mail-Regeln</h2><LoadState error={error} loading /></section>;
  const save = async (apply: boolean) => {
    setFail(null);
    const parsed = mailRulesInput.safeParse({ hideOther: v.hideOther, hotelWords: lines(v.hotelWords), tableWords: lines(v.tableWords), ignoreSenders: lines(v.ignoreSenders) });
    if (!parsed.success) { setFail('Bitte die Einträge prüfen: jeder Eintrag braucht 2 bis 60 Zeichen, höchstens 50 je Feld.'); return; }
    setBusy(apply ? 'apply' : 'save');
    try {
      await api('PUT', '/settings/mail-rules', parsed.data);
      if (apply) { const r = await api<{ checked: number; changed: number }>('POST', '/inbox/reclassify', {}); toast(`Regeln gespeichert – ${r.changed} von ${r.checked} offenen Nachrichten neu eingeordnet`); }
      else toast('E-Mail-Regeln gespeichert');
    } catch (e) { setFail(e instanceof Error ? e.message : 'Fehler'); }
    setBusy('');
  };
  return (
    <section className="card">
      <h2>E-Mail-Regeln</h2>
      <p className="muted">Das Programm ordnet jede abgerufene Nachricht als Zimmeranfrage, Tischanfrage oder Sonstiges ein. Hier stellen Sie ein, was im Posteingang erscheint und woran Anfragen zusätzlich erkannt werden.</p>
      <div className="formgrid">
        <label className="check wide"><input type="checkbox" checked={v.hideOther} onChange={(e) => setV({ ...v, hideOther: e.target.checked })} />
          <span>Nur Zimmer- und Tischanfragen anzeigen<small>Alles andere (Rechnungen, Werbung, Rundschreiben) wird gleich unter „Ignoriert“ abgelegt. Dort bleibt es sichtbar und lässt sich zurückholen.</small></span></label>
        <Field label="Zusätzliche Stichwörter für Zimmeranfragen" hint="ein Wort je Zeile, z. B. Monteurzimmer"><textarea rows={4} value={v.hotelWords} onChange={(e) => setV({ ...v, hotelWords: e.target.value })} /></Field>
        <Field label="Zusätzliche Stichwörter für Tischanfragen" hint="ein Wort je Zeile, z. B. Stammtisch, Familienfeier"><textarea rows={4} value={v.tableWords} onChange={(e) => setV({ ...v, tableWords: e.target.value })} /></Field>
        <Field label="Absender, die nie eine Anfrage sind" hint="Teil der Adresse oder des Namens je Zeile, z. B. newsletter@, noreply, Lieferant GmbH" wide><textarea rows={4} value={v.ignoreSenders} onChange={(e) => setV({ ...v, ignoreSenders: e.target.value })} /></Field>
      </div>
      {fail && <p className="notice danger" role="alert">{fail}</p>}
      <div className="formactions">
        <Button variant="primary" busy={busy === 'save'} disabled={busy !== ''} onClick={() => void save(false)}>Speichern</Button>
        <Button busy={busy === 'apply'} disabled={busy !== ''} onClick={() => void save(true)}>Speichern und auf vorhandene Nachrichten anwenden</Button>
      </div>
      <p className="muted small">Fest eingebaut erkennt das Programm Wörter wie Zimmer, Übernachtung, Anreise, Tisch, Abendessen oder Restaurant, zusammen mit einer Bitte oder Frage (reservieren, buchen, frei, Anfrage). Die Regeln gelten für neu abgerufene Nachrichten; „anwenden“ ordnet die noch offenen neu ein. Bereits bearbeitete Nachrichten bleiben unverändert.</p>
    </section>
  );
}
