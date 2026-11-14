import { useEffect, useState } from 'react';
import { inboxSettingsInput, type InboxSettingsDto } from '../../../src/shared/inbox.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

/** Zugang zum Geschäftspostfach für das Modul „E-Mail“ (Empfang per IMAP, nur lesend). */
export function InboxSettings() {
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api<InboxSettingsDto>('GET', '/settings/inbox'));
  const [v, setV] = useState({ enabled: false, host: 'imap.gmx.net', port: '993', user: '', password: '', folder: 'INBOX', autoMinutes: '0' });
  const [testing, setTesting] = useState(false);
  useEffect(() => { if (data) setV({ enabled: data.enabled, host: data.host, port: String(data.port), user: data.user, password: '', folder: data.folder, autoMinutes: String(data.autoMinutes) }); }, [data]);
  const payload = () => ({ ...v, port: Number(v.port), autoMinutes: Number(v.autoMinutes) });
  const f = useSubmit(inboxSettingsInput, async (d) => { await api('PUT', '/settings/inbox', d); toast('E-Mail-Empfang gespeichert'); reload(); });
  const test = async () => {
    setTesting(true);
    try {
      await api('PUT', '/settings/inbox', inboxSettingsInput.parse({ ...payload(), enabled: true }));
      const r = await api<{ added: number }>('POST', '/inbox/fetch', {});
      toast(`Abruf hat geklappt – ${r.added} neue ${r.added === 1 ? 'Nachricht' : 'Nachrichten'}`); reload();
    } catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setTesting(false);
  };
  if (!data) return <section className="card"><h2>E-Mail-Empfang</h2><LoadState error={error} loading /></section>;
  return (
    <form className="card" onSubmit={(e) => void f.submit(payload(), e)} noValidate>
      <h2>E-Mail-Empfang (Modul „E-Mail“)</h2>
      <p className="muted">Zugang zum Geschäftspostfach, dessen Nachrichten im Modul „E-Mail“ erscheinen. Das Programm liest nur: Im Postfach wird nichts gelöscht, verschoben oder als gelesen markiert. Für GMX sind Server und Port bereits eingetragen.</p>
      <div className="formgrid cols3">
        <label className="check wide"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /><span>E-Mail-Empfang aktiv</span></label>
        <Field label="E-Mail-Adresse (Anmeldename)" error={f.errors.user}><input type="email" value={v.user} onChange={(e) => setV({ ...v, user: e.target.value })} placeholder="hotel@gmx.de" autoComplete="off" /></Field>
        <Field label="Passwort" error={f.errors.password} hint={data.hasPassword ? 'gespeichert – leer lassen zum Behalten' : undefined}>
          <input type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete="new-password" placeholder={data.hasPassword ? '••••••••' : ''} />
        </Field>
        <Field label="Automatisch abrufen" error={f.errors.autoMinutes}>
          <select value={v.autoMinutes} onChange={(e) => setV({ ...v, autoMinutes: e.target.value })}>
            <option value="0">nein, nur auf Knopfdruck</option><option value="5">alle 5 Minuten</option><option value="15">alle 15 Minuten</option><option value="60">jede Stunde</option>
          </select>
        </Field>
        <Field label="Posteingangsserver (IMAP)" error={f.errors.host}><input value={v.host} onChange={(e) => setV({ ...v, host: e.target.value })} /></Field>
        <Field label="Port" error={f.errors.port} hint="993 (SSL)"><input inputMode="numeric" value={v.port} onChange={(e) => setV({ ...v, port: e.target.value })} /></Field>
        <Field label="Ordner" error={f.errors.folder} hint="Posteingang = INBOX"><input value={v.folder} onChange={(e) => setV({ ...v, folder: e.target.value })} /></Field>
      </div>
      <div className="formactions">
        <Button type="submit" variant="primary" busy={f.busy}>Speichern</Button>
        <Button busy={testing} onClick={() => void test()}>Speichern und jetzt abrufen</Button>
      </div>
      <p className="muted small">Beim ersten Abruf werden die Nachrichten der letzten 30 Tage geholt, danach nur noch neue. Die Texte werden im Programm gespeichert (ohne Anhänge) und sind für alle Benutzer mit dem Modul „E-Mail“ sichtbar. Bei GMX muss der IMAP-Zugriff im Postfach erlaubt sein. Das Passwort wird verschlüsselt gespeichert.</p>
    </form>
  );
}
