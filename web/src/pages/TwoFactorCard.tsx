import { useState } from 'react';
import { totpConfirmInput, totpDisableInput, type TotpSetupDto } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { Badge, Button, Field, useSubmit, useToast } from '../ui.tsx';

/** Zwei-Faktor-Anmeldung für das eigene Konto: einrichten mit QR-Code, bestätigen mit einem Code, ausschalten mit Passwort. */
export function TwoFactorCard() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [setup, setSetup] = useState<TotpSetupDto | null>(null);
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const begin = async () => {
    setBusy(true);
    try { setSetup(await api<TotpSetupDto>('POST', '/auth/totp/begin', {})); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  const confirm = useSubmit(totpConfirmInput, async (d) => { await api('POST', '/auth/totp/confirm', d); setSetup(null); setCode(''); toast('Zwei-Faktor-Anmeldung eingeschaltet'); await refresh(); });
  const disable = useSubmit(totpDisableInput, async (d) => { await api('POST', '/auth/totp/disable', d); setOff(false); setPw(''); toast('Zwei-Faktor-Anmeldung ausgeschaltet'); await refresh(); });
  return (
    <section className="card">
      <h2>Zwei-Faktor-Anmeldung {user.twoFactor ? <Badge tone="ok">eingeschaltet</Badge> : <Badge>aus</Badge>}</h2>
      <p className="muted">Zusätzlich zum Passwort fragt das Programm bei der Anmeldung nach einem 6-stelligen Code aus einer Authenticator-App auf Ihrem Handy (z. B. Google Authenticator, Microsoft Authenticator, Aegis). Wer nur Ihr Passwort kennt, kommt damit nicht hinein. Dringend empfohlen, sobald das Programm über das Internet erreichbar ist.</p>
      {!user.twoFactor && !setup && <div className="formactions"><Button variant="primary" busy={busy} onClick={() => void begin()}>Einrichten</Button></div>}
      {!user.twoFactor && setup && (
        <form onSubmit={(e) => void confirm.submit({ code }, e)} noValidate>
          <ol className="steps">
            <li>Authenticator-App auf dem Handy öffnen und „Konto hinzufügen“ → „QR-Code scannen“ wählen.</li>
            <li>Diesen Code scannen:<br /><img src={setup.qr} alt="QR-Code für die Authenticator-App" width={220} height={220} className="qrimg" /><br />
              <small>Ohne Kamera: Schlüssel von Hand eintragen (Konto „{setup.account}“, zeitbasiert): <code className="wrapcode">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code></small></li>
            <li>Den 6-stelligen Code eingeben, den die App jetzt anzeigt:
              <div className="inline"><Field label="Code" error={confirm.errors.code}><input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus /></Field>
                <Button type="submit" variant="primary" busy={confirm.busy}>Bestätigen und einschalten</Button><Button onClick={() => { setSetup(null); setCode(''); }}>Abbrechen</Button></div></li>
          </ol>
          <p className="muted small">Erst nach der Bestätigung ist die Zwei-Faktor-Anmeldung aktiv – so können Sie sich nicht aussperren, falls das Scannen nicht geklappt hat.</p>
        </form>
      )}
      {user.twoFactor && !off && <div className="formactions"><Button onClick={() => setOff(true)}>Ausschalten …</Button></div>}
      {user.twoFactor && off && (
        <form className="inline" onSubmit={(e) => void disable.submit({ password: pw }, e)} noValidate>
          <Field label="Zur Bestätigung Ihr Passwort" error={disable.errors.password}><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus /></Field>
          <Button type="submit" variant="danger" busy={disable.busy}>Ausschalten</Button><Button onClick={() => { setOff(false); setPw(''); }}>Abbrechen</Button>
        </form>
      )}
      <p className="muted small"><b>Handy verloren oder neu?</b> Ein Administrator kann die Zwei-Faktor-Anmeldung unter Benutzer aufheben. Ist niemand sonst da: Am PMS-Rechner „Passwort vergessen.bat“ ausführen – das setzt Passwort und Zwei-Faktor-Anmeldung zurück.</p>
    </section>
  );
}
