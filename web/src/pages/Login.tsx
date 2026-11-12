import { useState } from 'react';
import { loginInput, setupInput } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { Button, Field, useSubmit } from '../ui.tsx';

export function Login({ setup, onDone }: { setup: boolean; onDone: () => Promise<void> }) {
  const [v, setV] = useState({ username: '', name: '', password: '' });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const login = useSubmit(loginInput, async (d) => { await api('POST', '/auth/login', d); await onDone(); });
  const first = useSubmit(setupInput, async (d) => { await api('POST', '/auth/setup', d); await onDone(); });
  const f = setup ? first : login;

  return (
    <div className="authpage">
      <form className="authcard" onSubmit={(e) => void f.submit(v, e)} noValidate>
        <div className="brand big"><span className="mark">S</span><span>Schützenhaus<small>Property Management</small></span></div>
        <p className="muted">
          {setup ? 'Ersteinrichtung: Legen Sie das Administrator-Konto an. Weitere Benutzer können Sie danach in der Benutzerverwaltung anlegen.' : 'Bitte melden Sie sich an.'}
        </p>
        {setup && (
          <Field label="Ihr Name" error={f.errors.name}>
            <input value={v.name} onChange={set('name')} autoComplete="name" autoFocus />
          </Field>
        )}
        <Field label="Benutzername" error={f.errors.username}>
          <input value={v.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" spellCheck={false} autoFocus={!setup} />
        </Field>
        <Field label="Passwort" error={f.errors.password} hint={setup ? 'Mindestens 10 Zeichen' : undefined}>
          <input type="password" value={v.password} onChange={set('password')} autoComplete={setup ? 'new-password' : 'current-password'} />
        </Field>
        <Button type="submit" variant="primary" busy={f.busy}>{setup ? 'Konto anlegen und starten' : 'Anmelden'}</Button>
      </form>
    </div>
  );
}
