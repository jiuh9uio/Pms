import { useState } from 'react';
import { DEFAULT_MODULES, MODULES, MODULE_LABEL, ROLES, ROLE_LABEL, type Module, passwordResetInput, userCreateInput, userUpdateInput, type Role, type UserDto } from '../../../src/shared/schemas.js';
import { api } from '../api.ts';
import { useAuth } from '../App.tsx';
import { Badge, Button, Dialog, Field, LoadState, PageHeader, fmtDateTime, useLoad, useSubmit, useToast } from '../ui.tsx';

export function Users() {
  const { data, error, reload } = useLoad(() => api<UserDto[]>('GET', '/users'));
  const [edit, setEdit] = useState<UserDto | 'new' | null>(null);
  const done = () => { setEdit(null); reload(); };

  return (
    <>
      <PageHeader title="Benutzer" sub="Konten und Rollen für den Zugang zum PMS"
        actions={<Button variant="primary" onClick={() => setEdit('new')}>Benutzer anlegen</Button>} />
      <LoadState error={error} loading={!data} />
      {data && (
        <div className="tablewrap card flush">
          <table>
            <thead><tr><th>Name</th><th>Benutzername</th><th>Rolle</th><th className="hide-sm">Bereiche</th><th>Status</th><th>Letzte Anmeldung</th></tr></thead>
            <tbody>
              {data.map((u) => (
                <tr key={u.id} className="rowlink" tabIndex={0} onClick={() => setEdit(u)} onKeyDown={(e) => { if (e.key === 'Enter') setEdit(u); }}>
                  <td className="strong">{u.name}</td>
                  <td>{u.username}</td>
                  <td>{u.role === 'admin' ? <Badge tone="accent">{ROLE_LABEL.admin}</Badge> : ROLE_LABEL.user}</td>
                  <td className="hide-sm">{u.role === 'admin' ? 'alle' : u.modules.map((m) => MODULE_LABEL[m]).join(', ') || <span className="muted">keine</span>}</td>
                  <td>{!u.active ? <Badge tone="neutral">Deaktiviert</Badge> : u.lockedUntil ? <Badge tone="warn">Vorübergehend gesperrt</Badge> : <Badge tone="ok">Aktiv</Badge>}</td>
                  <td className="muted">{fmtDateTime(u.lastLoginAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {edit === 'new' && <CreateUser onClose={() => setEdit(null)} onDone={done} />}
      {edit && edit !== 'new' && <EditUser user={edit} onClose={() => setEdit(null)} onDone={done} />}
    </>
  );
}

const RoleSelect = ({ value, onChange }: { value: Role; onChange: (r: Role) => void }) => (
  <select value={value} onChange={(e) => onChange(e.target.value as Role)}>
    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
  </select>
);
const ROLE_HINT = 'Benutzer: nur die freigegebenen Bereiche. Administrator: alle Bereiche, dazu Verwaltung und Konto.';

/** Welche Bereiche darf der Benutzer öffnen? Für Administratoren ohne Bedeutung – sie dürfen alles. */
function ModuleChecks({ role, value, onChange }: { role: Role; value: Module[]; onChange: (m: Module[]) => void }) {
  if (role === 'admin') return <p className="muted wide small">Administratoren haben Zugriff auf alle Bereiche.</p>;
  return (
    <fieldset className="wide checks">
      <legend>Zugriff auf Bereiche</legend>
      {MODULES.map((m) => (
        <label key={m} className="check"><input type="checkbox" checked={value.includes(m)} onChange={(e) => onChange(e.target.checked ? [...value, m] : value.filter((x) => x !== m))} /><span>{MODULE_LABEL[m]}</span></label>
      ))}
    </fieldset>
  );
}

function CreateUser({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [v, setV] = useState({ name: '', username: '', password: '', role: 'user' as Role, modules: [...DEFAULT_MODULES] });
  const f = useSubmit(userCreateInput, async (d) => {
    await api('POST', '/users', d);
    toast(`${d.name} wurde angelegt`);
    onDone();
  });
  return (
    <Dialog title="Benutzer anlegen" onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={() => void f.submit(v)}>Anlegen</Button></>}>
      <form className="formgrid" onSubmit={(e) => void f.submit(v, e)} noValidate>
        <Field label="Name" error={f.errors.name}><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} autoFocus /></Field>
        <Field label="Benutzername" error={f.errors.username}><input value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} autoCapitalize="none" spellCheck={false} /></Field>
        <Field label="Startpasswort" error={f.errors.password} hint="Mindestens 10 Zeichen. Ein neues Passwort vergibt später der Administrator.">
          <input type="text" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} autoComplete="off" />
        </Field>
        <Field label="Rolle" error={f.errors.role} hint={ROLE_HINT}><RoleSelect value={v.role} onChange={(role) => setV({ ...v, role })} /></Field>
        <ModuleChecks role={v.role} value={v.modules} onChange={(modules) => setV({ ...v, modules })} />
        <button type="submit" hidden />
      </form>
    </Dialog>
  );
}

function EditUser({ user, onClose, onDone }: { user: UserDto; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const me = useAuth();
  const [v, setV] = useState({ name: user.name, role: user.role, active: user.active, modules: user.modules });
  const [pw, setPw] = useState('');
  const f = useSubmit(userUpdateInput, async (d) => {
    await api('PATCH', `/users/${user.id}`, d);
    toast('Gespeichert');
    if (user.id === me.user.id) await me.refresh();
    onDone();
  });
  const reset = useSubmit(passwordResetInput, async (d) => {
    await api('POST', `/users/${user.id}/password`, d);
    toast(`Neues Passwort für ${user.name} gesetzt – alle Sitzungen wurden beendet`);
    onDone();
  });
  return (
    <Dialog title={user.name} onClose={onClose}
      footer={<><Button onClick={onClose}>Abbrechen</Button><Button variant="primary" busy={f.busy} onClick={() => void f.submit({ ...v, version: user.version })}>Speichern</Button></>}>
      <form className="formgrid" onSubmit={(e) => void f.submit({ ...v, version: user.version }, e)} noValidate>
        <Field label="Name" error={f.errors.name}><input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} /></Field>
        <Field label="Benutzername" hint="Kann nicht geändert werden"><input value={user.username} disabled /></Field>
        <Field label="Rolle" error={f.errors.role} hint={ROLE_HINT}><RoleSelect value={v.role} onChange={(role) => setV({ ...v, role })} /></Field>
        <ModuleChecks role={v.role} value={v.modules} onChange={(modules) => setV({ ...v, modules })} />
        <label className="check wide">
          <input type="checkbox" checked={v.active} onChange={(e) => setV({ ...v, active: e.target.checked })} />
          <span>Konto aktiv <small>Deaktivierte Benutzer werden sofort abgemeldet und können sich nicht mehr anmelden.</small></span>
        </label>
        <button type="submit" hidden />
      </form>
      <form className="subform" onSubmit={(e) => void reset.submit({ password: pw }, e)} noValidate>
        <h3>Passwort zurücksetzen</h3>
        <div className="inline">
          <Field label="Neues Passwort" error={reset.errors.password} hint="Hebt auch eine Sperre nach Fehlversuchen auf">
            <input type="text" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" busy={reset.busy}>Passwort setzen</Button>
        </div>
      </form>
    </Dialog>
  );
}
