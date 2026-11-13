import { useEffect, useState } from 'react';
import { mailSettingsInput, type MailSettingsDto } from '../../../src/shared/einvoice.js';
import { api } from '../api.ts';
import { Button, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

/** E-Mail-Zugang für den Versand (z. B. GMX). Das Passwort wird verschlüsselt gespeichert und nie wieder angezeigt. */
export function MailSettings() {
  const toast = useToast();
  const { data, error, reload } = useLoad(() => api<MailSettingsDto>('GET', '/settings/mail'));
  const [v, setV] = useState({ enabled: false, host: 'mail.gmx.net', port: '587', user: '', fromName: '', password: '' });
  const [testTo, setTestTo] = useState('');
  const [testing, setTesting] = useState(false);
  useEffect(() => { if (data) setV({ enabled: data.enabled, host: data.host, port: String(data.port), user: data.user, fromName: data.fromName, password: '' }); }, [data]);
  const f = useSubmit(mailSettingsInput, async (d) => { await api('PUT', '/settings/mail', d); toast('E-Mail-Einstellungen gespeichert'); reload(); });
  const test = async () => {
    setTesting(true);
    try { await api('POST', '/settings/mail/test', { to: testTo || v.user }); toast(`Testnachricht an ${testTo || v.user} gesendet`); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setTesting(false);
  };
  if (!data) return <section className="card"><h2>E-Mail-Versand</h2><LoadState error={error} loading /></section>;
  return (
    <form className="card" onSubmit={(e) => void f.submit({ ...v, port: Number(v.port) }, e)} noValidate>
      <h2>E-Mail-Versand</h2>
      <p className="muted">Zugang zum Postfach, über das E-Rechnungen verschickt werden. Für GMX sind Server und Port bereits eingetragen.</p>
      <div className="formgrid cols3">
        <label className="check wide"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /><span>E-Mail-Versand aktiv</span></label>
        <Field label="E-Mail-Adresse (Anmeldename)" error={f.errors.user}><input type="email" value={v.user} onChange={(e) => setV({ ...v, user: e.target.value })} placeholder="hotel@gmx.de" autoComplete="off" /></Field>
        <Field label="Passwort" error={f.errors.password} hint={data.hasPassword ? 'gespeichert – leer lassen zum Behalten' : undefined}>
          <input type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete="new-password" placeholder={data.hasPassword ? '••••••••' : ''} />
        </Field>
        <Field label="Absendername" error={f.errors.fromName}><input value={v.fromName} onChange={(e) => setV({ ...v, fromName: e.target.value })} placeholder="Hotel & Restaurant Schützenhaus" /></Field>
        <Field label="Postausgangsserver (SMTP)" error={f.errors.host}><input value={v.host} onChange={(e) => setV({ ...v, host: e.target.value })} /></Field>
        <Field label="Port" error={f.errors.port} hint="587 (STARTTLS) oder 465 (SSL)"><input inputMode="numeric" value={v.port} onChange={(e) => setV({ ...v, port: e.target.value })} /></Field>
      </div>
      <div className="formactions">
        <Button type="submit" variant="primary" busy={f.busy}>Speichern</Button>
        <input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="Testnachricht an … (leer = eigene Adresse)" aria-label="Empfänger der Testnachricht" className="testto" />
        <Button busy={testing} onClick={() => void test()}>Testnachricht senden</Button>
      </div>
      <p className="muted small">Bei GMX muss unter „E-Mail → Einstellungen → POP3/IMAP Abruf“ der Zugriff über POP3/IMAP erlaubt sein; mit Zwei-Faktor-Anmeldung wird ein anwendungsspezifisches Passwort benötigt.
        Das Passwort wird verschlüsselt gespeichert; der Schlüssel liegt als Datei „secret.key“ im Datenordner und gehört mit in die Datensicherung.</p>
    </form>
  );
}
