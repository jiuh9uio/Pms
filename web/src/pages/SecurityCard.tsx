import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { securityInput, type SecuritySettings, type UserDto } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { Badge, Button, Field, LoadState, useLoad, useSubmit, useToast } from '../ui.tsx';

/** Sicherheit: automatisches Abmelden und Überblick, wer die Zwei-Faktor-Anmeldung nutzt. */
export function SecurityCard() {
  const toast = useToast();
  const { data, error } = useLoad(() => api<SecuritySettings>('GET', '/settings/security'));
  const users = useLoad(() => api<UserDto[]>('GET', '/users')).data;
  const [idle, setIdle] = useState('');
  useEffect(() => { if (data) setIdle(String(data.idleMinutes)); }, [data]);
  const f = useSubmit(securityInput, async (d) => { await api('PUT', '/settings/security', d); window.dispatchEvent(new Event('pms-sicherheit')); toast('Gespeichert'); });
  if (!data) return <section className="card"><h2>Sicherheit</h2><LoadState error={error} loading /></section>;
  const active = (users ?? []).filter((u) => u.active);
  return (
    <>
      <form className="card" onSubmit={(e) => void f.submit({ idleMinutes: idle.trim() === '' ? NaN : Number(idle) }, e)} noValidate>
        <h2>Automatisches Abmelden</h2>
        <p className="muted">Meldet einen Arbeitsplatz ab, wenn dort so lange nichts getippt oder geklickt wurde – damit niemand an einem verlassenen Bildschirm weiterarbeiten kann. Unabhängig davon endet jede Anmeldung nach 12 Stunden ohne Aktivität.</p>
        <div className="formgrid cols3">
          <Field label="Abmelden nach … Minuten ohne Eingabe" error={f.errors.idleMinutes} hint="0 = aus · z. B. 15 an der Rezeption, 60 im Büro"><input inputMode="numeric" value={idle} onChange={(e) => setIdle(e.target.value)} /></Field>
        </div>
        <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Speichern</Button></div>
      </form>
      <section className="card">
        <h2>Zwei-Faktor-Anmeldung</h2>
        <p className="muted">Jeder Benutzer schaltet sie selbst unter <Link to="/konto">Mein Konto</Link> ein. Sobald das Programm über das Internet erreichbar ist, sollten zumindest alle Administratoren sie nutzen.</p>
        <ul className="plain compact">{active.map((u) => <li key={u.id}><span><b>{u.name}</b> <small>{u.username} · {u.role === 'admin' ? 'Administrator' : 'Benutzer'}</small></span>{u.twoFactor ? <Badge tone="ok">eingeschaltet</Badge> : <Badge tone={u.role === 'admin' ? 'warn' : undefined}>aus</Badge>}</li>)}</ul>
      </section>
    </>
  );
}
