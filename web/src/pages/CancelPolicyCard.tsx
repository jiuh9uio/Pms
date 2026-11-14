import { useEffect, useState } from 'react';
import { addDays, cancelPolicyInput, cancelTerms, todayBerlin, type CancelPolicy } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

/** Algorithmen → Storno: Bedingungen, Online-Storno über den Gäste-Link, Adresse im Internet. */
export function CancelPolicyCard() {
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api<CancelPolicy>('GET', '/settings/cancel-policy'));
  const [v, setV] = useState<(Omit<CancelPolicy, 'freeDays' | 'feePercent'> & { freeDays: string; feePercent: string }) | null>(null);
  useEffect(() => { if (data) setV({ ...data, freeDays: String(data.freeDays), feePercent: String(data.feePercent) }); }, [data]);
  const f = useSubmit(cancelPolicyInput, async (d) => { await api('PUT', '/settings/cancel-policy', d); toast('Stornobedingungen gespeichert'); reload(); });
  if (!v) return <section className="card"><h2>Stornobedingungen</h2><LoadState error={error} loading /></section>;
  const num = (s: string) => (s.trim() === '' ? NaN : Number(s));
  const payload = { ...v, freeDays: num(v.freeDays), feePercent: num(v.feePercent) };
  const sample = Number.isInteger(payload.freeDays) && Number.isInteger(payload.feePercent) ? cancelTerms({ ...payload, enabled: true }, addDays(todayBerlin(), 14), 20000, todayBerlin()).text : '';
  return (
    <form className="card" onSubmit={(e) => void f.submit(payload, e)} noValidate>
      <h2>Stornobedingungen und Gäste-Link</h2>
      <p className="muted">Jede Reservierung hat einen persönlichen Link für den Gast. Darüber sieht er – nach Eingabe von Nachname und Postleitzahl – seine Buchung, teilt die Ankunftszeit mit und kann, wenn Sie es erlauben, selbst stornieren. Den Link finden Sie in der Reservierung unter „Angaben“.</p>
      <div className="formgrid cols3">
        <label className="check wide"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /><span>Stornobedingungen anwenden<small>Sie stehen dann in der Reservierungsbestätigung, auf der Seite des Gastes und in der Reservierung.</small></span></label>
        <Field label="Kostenfrei bis … Tage vor Anreise" error={f.errors.freeDays} hint="0 = bis zum Anreisetag"><input inputMode="numeric" value={v.freeDays} onChange={(e) => setV({ ...v, freeDays: e.target.value })} /></Field>
        <Field label="Danach in Prozent des Zimmerpreises" error={f.errors.feePercent} hint="auch bei Nichtanreise; 0 = nichts"><input inputMode="numeric" value={v.feePercent} onChange={(e) => setV({ ...v, feePercent: e.target.value })} /></Field>
        <Field label="Zusatz zum Text" error={f.errors.extraText} wide hint="freiwillig, z. B. Hinweis auf Messezeiten"><input value={v.extraText} onChange={(e) => setV({ ...v, extraText: e.target.value })} /></Field>
        <label className="check wide"><input type="checkbox" checked={v.online} onChange={(e) => setV({ ...v, online: e.target.checked, onlineLate: e.target.checked && v.onlineLate })} /><span>Gäste dürfen über ihren Link selbst stornieren<small>Bis zum Tag vor der Anreise. Das Zimmer wird sofort wieder frei, und im Übergabebuch erscheint eine Meldung.</small></span></label>
        {v.online && <label className="check wide"><input type="checkbox" checked={v.onlineLate} onChange={(e) => setV({ ...v, onlineLate: e.target.checked })} /><span>… auch nach Ablauf der kostenfreien Frist<small>Der Gast sieht vorher den Betrag der Ausfallgebühr. Berechnet wird sie nicht von selbst – das Programm meldet sie Ihnen zum Prüfen.</small></span></label>}
        <Field label="Adresse des Programms im Internet" error={f.errors.publicUrl} wide hint="z. B. https://hotel.example.de – nur dann kommt der Link in die E-Mails an den Gast"><input value={v.publicUrl} onChange={(e) => setV({ ...v, publicUrl: e.target.value })} inputMode="url" autoCapitalize="none" /></Field>
      </div>
      {sample && <p className="notice"><b>So lesen es Ihre Gäste</b> (Beispiel mit Anreise in 14 Tagen): {sample}</p>}
      <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button></div>
      <p className="muted small">Solange das Programm nur im Haus läuft, funktioniert der Link nur im Hausnetz – für Gäste zu Hause erst, wenn das Programm aus dem Internet erreichbar ist. Ob Ihre Bedingungen so zulässig sind und wie eine Ausfallgebühr steuerlich zu behandeln ist, prüfen bitte Sie bzw. Ihre Steuerberatung; das Programm rechnet nur.</p>
    </form>
  );
}
