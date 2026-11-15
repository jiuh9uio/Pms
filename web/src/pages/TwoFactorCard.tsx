import { useState, type ReactNode } from 'react';
import { totpConfirmInput, totpDisableInput, type TotpSetupDto } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { Badge, Button, Field, useSubmit, useToast } from '../ui.tsx';

/** Zwei-Faktor-Anmeldung für das eigene Konto: einrichten mit QR-Code, bestätigen mit einem Code, ausschalten mit Passwort. */
export function TwoFactorCard() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const [pw, setPw] = useState('');
  const [off, setOff] = useState(false);
  const disable = useSubmit(totpDisableInput, async (d) => { await api('POST', '/auth/totp/disable', d); setOff(false); setPw(''); toast('Zwei-Faktor-Anmeldung ausgeschaltet'); await refresh(); });
  return (
    <section className="card">
      <h2>Zwei-Faktor-Anmeldung {user.twoFactor ? <Badge tone="ok">eingeschaltet</Badge> : <Badge>aus</Badge>}</h2>
      <p className="muted">Zusätzlich zum Passwort fragt das Programm bei der Anmeldung nach einem 6-stelligen Code aus der App „Microsoft Authenticator“ auf Ihrem Handy (kostenlos im App Store und bei Google Play; andere Authenticator-Apps gehen genauso). Wer nur Ihr Passwort kennt, kommt damit nicht hinein. Dringend empfohlen, sobald das Programm über das Internet erreichbar ist.</p>
      {!user.twoFactor && <TwoFactorSetup base="/auth/totp" onDone={refresh} />}
      {user.twoFactor && !off && <div className="formactions"><Button onClick={() => setOff(true)}>Ausschalten …</Button></div>}
      {user.twoFactor && off && (
        <form className="inline" onSubmit={(e) => void disable.submit({ password: pw }, e)} noValidate>
          <Field label="Zur Bestätigung Ihr Passwort" error={disable.errors.password}><input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" autoFocus /></Field>
          <Button type="submit" variant="danger" busy={disable.busy}>Ausschalten</Button><Button onClick={() => { setOff(false); setPw(''); }}>Abbrechen</Button>
        </form>
      )}
      <p className="muted small"><b>Handy verloren oder neu?</b> Ein Administrator kann die Zwei-Faktor-Anmeldung unter Verwaltung → Benutzer aufheben und neu einrichten. Ist niemand sonst da: Am PMS-Rechner „Passwort vergessen.bat“ ausführen – das setzt Passwort und Zwei-Faktor-Anmeldung zurück.</p>
    </section>
  );
}

/**
 * Einrichtung mit QR-Code – für das eigene Konto oder (Administrator) für einen anderen Benutzer.
 * `base` ist '/auth/totp' bzw. '/users/<id>/totp'.
 */
export function TwoFactorSetup({ base, who, onDone, onCancel }: { base: string; who?: string; onDone: () => void | Promise<void>; onCancel?: () => void }) {
  const toast = useToast();
  const [setup, setSetup] = useState<TotpSetupDto | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const begin = async () => {
    setBusy(true);
    try { setSetup(await api<TotpSetupDto>('POST', `${base}/begin`, {})); }
    catch (e) { toast(e instanceof Error ? e.message : 'Fehler', 'error'); }
    setBusy(false);
  };
  const confirm = useSubmit(totpConfirmInput, async (d) => { await api('POST', `${base}/confirm`, d); setSetup(null); setCode(''); toast('Zwei-Faktor-Anmeldung eingeschaltet'); await onDone(); });
  if (!setup) return <div className="formactions"><Button variant="primary" busy={busy} onClick={() => void begin()}>Einrichten{who ? ` für ${who}` : ''}</Button></div>;
  const step = (n: ReactNode) => n;
  return (
    <form onSubmit={(e) => void confirm.submit({ code }, e)} noValidate>
      <ol className="steps">
        {who && step(<li><b>{who}</b> nimmt sein Handy zur Hand.</li>)}
        <li>Auf dem Handy „Microsoft Authenticator“ öffnen, oben auf „+“ tippen und <b>„Anderes Konto (Google, Facebook usw.)“</b> wählen – nicht „Geschäfts- oder Schulkonto“.</li>
        <li>Mit der App diesen QR-Code scannen:<br /><img src={setup.qr} alt="QR-Code für Microsoft Authenticator" width={220} height={220} className="qrimg" /><br />
          <small>Ohne Kamera: Schlüssel von Hand eintragen (Konto „{setup.account}“, zeitbasiert): <code className="wrapcode">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code></small></li>
        <li>In der App erscheint ein Eintrag mit dem Namen Ihres Hauses. Den 6-stelligen Code daraus hier eingeben:
          <div className="inline"><Field label="Code" error={confirm.errors.code}><input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" maxLength={6} autoFocus /></Field>
            <Button type="submit" variant="primary" busy={confirm.busy}>Bestätigen und einschalten</Button><Button onClick={() => { setSetup(null); setCode(''); onCancel?.(); }}>Abbrechen</Button></div></li>
      </ol>
      <p className="muted small">Erst nach der Bestätigung ist die Zwei-Faktor-Anmeldung aktiv – so kann sich niemand aussperren, falls das Scannen nicht geklappt hat.</p>
    </form>
  );
}
