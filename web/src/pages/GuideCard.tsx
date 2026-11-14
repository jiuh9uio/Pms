import { useEffect, useState } from 'react';
import { GUIDE_PROVIDERS, GUIDE_PROVIDER_LABEL, guestGuideInput, type GuestGuide } from '../../../src/shared/hotel.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

/** Digitale Gästemappe (z. B. Gastfreund): Adresse hinterlegen – erscheint auf einem Bon-Zettel, in E-Mails und auf der Seite des Gastes. */
export function GuideCard() {
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api<GuestGuide>('GET', '/settings/guest-guide'));
  const [v, setV] = useState<GuestGuide | null>(null);
  useEffect(() => { if (data) setV(data); }, [data]);
  const f = useSubmit(guestGuideInput, async (d) => { await api('PUT', '/settings/guest-guide', d); toast('Gästemappe gespeichert'); reload(); });
  if (!v) return <section className="card"><h2>Digitale Gästemappe</h2><LoadState error={error} loading /></section>;
  return (
    <form className="card" onSubmit={(e) => void f.submit(v, e)} noValidate>
      <h2>Digitale Gästemappe</h2>
      <p className="muted">Wenn Sie eine digitale Gästemappe haben (zum Beispiel von Gastfreund), tragen Sie hier ihre Adresse ein. Das Programm verweist dann an drei Stellen darauf: auf einem Bon-Zettel mit QR-Code im Schnelldruck, in den E-Mails an den Gast und auf seiner Reservierungsseite.</p>
      <div className="formgrid">
        <label className="check wide"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /><span>Auf die Gästemappe verweisen</span></label>
        <Field label="Anbieter"><select value={v.provider} onChange={(e) => setV({ ...v, provider: e.target.value as GuestGuide['provider'] })}>{GUIDE_PROVIDERS.map((p) => <option key={p} value={p}>{GUIDE_PROVIDER_LABEL[p]}</option>)}</select></Field>
        <Field label="Bezeichnung für den Gast" error={f.errors.label}><input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} /></Field>
        <Field label="Adresse der Gästemappe" error={f.errors.url} wide hint="die Adresse, die Ihr Anbieter Ihnen für Gäste nennt – dieselbe wie auf dessen QR-Code"><input value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} inputMode="url" autoCapitalize="none" placeholder="https://…" /></Field>
        <Field label="Kurzer Satz dazu" error={f.errors.text} wide><input value={v.text} onChange={(e) => setV({ ...v, text: e.target.value })} /></Field>
        <label className="check"><input type="checkbox" checked={v.inMails} onChange={(e) => setV({ ...v, inMails: e.target.checked })} /><span>In E-Mails an den Gast nennen<small>Bestätigung und Nachricht vor der Anreise</small></span></label>
        <label className="check"><input type="checkbox" checked={v.onGuestPage} onChange={(e) => setV({ ...v, onGuestPage: e.target.checked })} /><span>Auf der Reservierungsseite des Gastes zeigen</span></label>
      </div>
      <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button>{v.url && <a className="btn" href={v.url} target="_blank" rel="noreferrer">Adresse testen</a>}</div>
      <p className="muted small">Das ist ein Verweis: Die Gästemappe selbst bleibt beim Anbieter, und es werden keine Reservierungsdaten dorthin übertragen. Eine echte Anbindung ist vorbereitet, aber noch nicht möglich – dafür braucht es eine Schnittstellenbeschreibung des Anbieters. Der Bon-Zettel erscheint im Schnelldruck, sobald die Adresse eingetragen ist.</p>
    </form>
  );
}
