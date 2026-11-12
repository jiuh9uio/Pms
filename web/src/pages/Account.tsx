import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ROLE_LABEL, changePasswordInput } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { applyTheme, storedTheme, type Theme } from '../theme.ts';
import { Button, Field, PageHeader, useSubmit, useToast } from '../ui.tsx';

const THEMES: [Theme, string][] = [['system', 'Wie Gerät'], ['light', 'Hell'], ['dark', 'Dunkel']];

export function Account() {
  const { user, refresh } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [theme, setTheme] = useState<Theme>(storedTheme());
  const [v, setV] = useState({ current: '', password: '' });
  const [out, setOut] = useState(false);
  const f = useSubmit(changePasswordInput, async (d) => {
    await api('POST', '/auth/password', d);
    setV({ current: '', password: '' });
    toast('Passwort geändert – andere Geräte wurden abgemeldet');
  });
  const logout = async () => {
    setOut(true);
    try { await api('POST', '/auth/logout'); } catch { /* Sitzung war bereits beendet */ }
    await refresh();
    navigate('/', { replace: true });
  };

  return (
    <>
      <PageHeader title="Mein Konto" sub={`${user.name} · ${user.username} · ${ROLE_LABEL[user.role]}`}
        actions={<Button busy={out} onClick={() => void logout()}>Abmelden</Button>} />
      {user.role === 'admin' && (
        <nav className="card adminlinks" aria-label="Verwaltung">
          <h2>Verwaltung</h2>
          <Link to="/zimmer">Zimmer &amp; Preise</Link><Link to="/benutzer">Benutzer</Link><Link to="/protokoll">Protokoll</Link><Link to="/einstellungen">Einstellungen</Link>
        </nav>
      )}
      <section className="card">
        <h2>Darstellung</h2>
        <div className="segmented" role="radiogroup" aria-label="Farbschema">
          {THEMES.map(([t, label]) => (
            <button key={t} type="button" role="radio" aria-checked={theme === t} className={theme === t ? 'on' : ''}
              onClick={() => { setTheme(t); applyTheme(t); }}>{label}</button>
          ))}
        </div>
      </section>
      <form className="card" onSubmit={(e) => void f.submit(v, e)} noValidate>
        <h2>Passwort ändern</h2>
        <div className="formgrid">
          <Field label="Aktuelles Passwort" error={f.errors.current}>
            <input type="password" value={v.current} onChange={(e) => setV({ ...v, current: e.target.value })} autoComplete="current-password" />
          </Field>
          <Field label="Neues Passwort" error={f.errors.password} hint="Mindestens 10 Zeichen">
            <input type="password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete="new-password" />
          </Field>
        </div>
        <div className="formactions"><Button type="submit" variant="primary" busy={f.busy}>Passwort ändern</Button></div>
      </form>
    </>
  );
}
