import { useEffect, useState } from 'react';
import { mailRulesInput, type MailRules } from '../../../src/shared/inbox.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useToast } from '../ui.tsx';

const lines = (s: string) => s.split(/[\n,;]/).map((x) => x.trim()).filter(Boolean);

/** Algorithmen → E-Mail: welche Nachrichten als Anfrage gelten und was im Posteingang erscheint. */
export function MailRulesCard() {
  const toast = useToast();
  const { data, error } = useLoad(() => api<MailRules>('GET', '/settings/mail-rules'));
  type Words = 'hotelWords' | 'tableWords' | 'eventWords' | 'meetingWords' | 'voucherWords' | 'questionWords';
  const [v, setV] = useState<({ hideOther: boolean; ignoreSenders: string } & Record<Words, string>) | null>(null);
  const [busy, setBusy] = useState<'' | 'save' | 'apply'>('');
  const [fail, setFail] = useState<string | null>(null);
  useEffect(() => {
    if (data) setV({ hideOther: data.hideOther, ignoreSenders: data.ignoreSenders.join('\n'), hotelWords: data.hotelWords.join('\n'), tableWords: data.tableWords.join('\n'),
      eventWords: (data.eventWords ?? []).join('\n'), meetingWords: (data.meetingWords ?? []).join('\n'), voucherWords: (data.voucherWords ?? []).join('\n'), questionWords: (data.questionWords ?? []).join('\n') });
  }, [data]);
  if (!v) return <section className="card"><h2>E-Mail-Regeln</h2><LoadState error={error} loading /></section>;
  const save = async (apply: boolean) => {
    setFail(null);
    const parsed = mailRulesInput.safeParse({ hideOther: v.hideOther, ignoreSenders: lines(v.ignoreSenders), hotelWords: lines(v.hotelWords), tableWords: lines(v.tableWords),
      eventWords: lines(v.eventWords), meetingWords: lines(v.meetingWords), voucherWords: lines(v.voucherWords), questionWords: lines(v.questionWords) });
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
      <p className="muted">Das Programm ordnet jede abgerufene Nachricht ein: Zimmer, Tisch, Feier / Veranstaltung, Tagung / Versammlung, Gutschein, allgemeine Frage oder Sonstiges (z. B. Werbung, Rechnungen, Newsletter). Hier stellen Sie ein, was im Posteingang erscheint und woran Anfragen zusätzlich erkannt werden.</p>
      <div className="formgrid">
        <label className="check wide"><input type="checkbox" checked={v.hideOther} onChange={(e) => setV({ ...v, hideOther: e.target.checked })} />
          <span>„Sonstiges“ gleich ausblenden<small>Nachrichten, die weder Anfrage noch Frage sind (Rechnungen, Werbung, Rundschreiben), werden gleich unter „Ignoriert“ abgelegt. Dort bleibt es sichtbar und lässt sich zurückholen.</small></span></label>
        {([['hotelWords', 'Zimmer', 'z. B. Monteurzimmer, Pension'], ['tableWords', 'Tisch', 'z. B. Mittagstisch, Schnitzeltag'], ['eventWords', 'Feier / Veranstaltung', 'z. B. Kirmes, Abiball'],
          ['meetingWords', 'Tagung / Versammlung', 'z. B. Landfrauen, Ortsverband'], ['voucherWords', 'Gutschein', 'z. B. Wellness-Gutschein'], ['questionWords', 'allgemeine Frage', 'z. B. Fahrradkeller']] as const).map(([k, label, hint]) => (
          <Field key={k} label={`Zusätzliche Stichwörter: ${label}`} hint={`ein Wort je Zeile, ${hint}`}><textarea rows={3} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /></Field>
        ))}
        <Field label="Absender, die nie eine Anfrage sind" hint="Teil der Adresse oder des Namens je Zeile, z. B. newsletter@, noreply, Lieferant GmbH" wide><textarea rows={4} value={v.ignoreSenders} onChange={(e) => setV({ ...v, ignoreSenders: e.target.value })} /></Field>
      </div>
      {fail && <p className="notice danger" role="alert">{fail}</p>}
      <div className="formactions">
        <Button variant="primary" busy={busy === 'save'} disabled={busy !== ''} onClick={() => void save(false)}>Speichern</Button>
        <Button busy={busy === 'apply'} disabled={busy !== ''} onClick={() => void save(true)}>Speichern und auf vorhandene Nachrichten anwenden</Button>
      </div>
      <p className="muted small">Fest eingebaut erkennt das Programm u. a.: Zimmer, Übernachtung, Anreise, Schlafen (Zimmer) · Tisch, Mittag-/Abendessen, Restaurant (Tisch) · Feier, Geburtstag, Hochzeit, Taufe, Jugendweihe, Trauerkaffee, Saal, Buffet (Feier) · Tagung, Seminar, Versammlung, Innung, Schulung, Beamer (Tagung) · Gutschein (Gutschein). Ein kleiner Geburtstag am Tisch (bis 12 Personen, ohne Saal oder Buffet) gilt als Tischanfrage; Tagungen und Feiern mit Übernachtung bleiben Tagung bzw. Feier. Ohne solche Wörter, aber mit einer Frage, ist es eine allgemeine Frage. Newsletter und automatische Nachrichten sind „Sonstiges“. Eigene Stichwörter zählen wie die festen. Die Regeln gelten für neu abgerufene Nachrichten; „anwenden“ ordnet die noch offenen neu ein. Bereits bearbeitete Nachrichten bleiben unverändert.</p>
    </section>
  );
}
