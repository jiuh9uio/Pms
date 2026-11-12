import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { ROLE_LABEL, type UserDto } from '../../src/shared/schemas.js';
import { api } from './api.ts';
import { Account } from './pages/Account.tsx';
import { Audit } from './pages/Audit.tsx';
import { DataProvider } from './data.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Guests } from './pages/Guests.tsx';
import { Login } from './pages/Login.tsx';
import { Plan } from './pages/Plan.tsx';
import { Reservations } from './pages/Reservations.tsx';
import { RoomsPrices } from './pages/RoomsPrices.tsx';
import { Settings } from './pages/Settings.tsx';
import { Users } from './pages/Users.tsx';
import { ToastProvider } from './ui.tsx';

interface AuthState { needsSetup: boolean; user: UserDto | null }
const AuthCtx = createContext<{ user: UserDto; refresh: () => Promise<void> }>(null!);
export const useAuth = () => useContext(AuthCtx);

const NAV = [
  { to: '/', label: 'Übersicht', icon: '◧', admin: false },
  { to: '/plan', label: 'Belegungsplan', short: 'Plan', icon: '▦', admin: false },
  { to: '/reservierungen', label: 'Reservierungen', short: 'Buchungen', icon: '☷', admin: false },
  { to: '/gaeste', label: 'Gäste', icon: '☺', admin: false },
  { to: '/zimmer', label: 'Zimmer & Preise', short: 'Zimmer', icon: '⌂', admin: true, more: true },
  { to: '/benutzer', label: 'Benutzer', icon: '◉', admin: true, more: true },
  { to: '/protokoll', label: 'Protokoll', icon: '☰', admin: true, more: true },
  { to: '/einstellungen', label: 'Einstellungen', short: 'Einstell.', icon: '⚙', admin: true, more: true },
  { to: '/konto', label: 'Mein Konto', short: 'Konto', icon: '◐', admin: false },
] as { to: string; label: string; short?: string; icon: string; admin: boolean; more?: boolean }[];

export function App() {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      setState(await api<AuthState>('GET', '/auth/state'));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    }
  }, []);
  useEffect(() => {
    void refresh();
    const out = () => void refresh();
    window.addEventListener('pms:signed-out', out);
    return () => window.removeEventListener('pms:signed-out', out);
  }, [refresh]);

  if (error && !state) return <div className="center"><p className="notice danger">{error}</p><button className="btn" onClick={() => void refresh()}>Erneut versuchen</button></div>;
  if (!state) return <div className="center muted">Lädt …</div>;
  return (
    <ToastProvider>
      {state.user
        ? <AuthCtx.Provider value={{ user: state.user, refresh }}><Shell user={state.user} /></AuthCtx.Provider>
        : <Login setup={state.needsSetup} onDone={refresh} />}
    </ToastProvider>
  );
}

function Shell({ user }: { user: UserDto }) {
  const isAdmin = user.role === 'admin';
  const nav = NAV.filter((n) => !n.admin || isAdmin);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="mark">S</span><span>Schützenhaus<small>PMS</small></span></div>
        <nav aria-label="Hauptnavigation">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={n.more ? 'more' : undefined}><span className="ico" aria-hidden>{n.icon}</span><span className="full">{n.label}</span><span className="short">{n.short ?? n.label}</span></NavLink>
          ))}
        </nav>
        <div className="whoami"><b>{user.name}</b><span>{ROLE_LABEL[user.role]}</span></div>
      </aside>
      <main className="content">
        <DataProvider>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/reservierungen" element={<Reservations />} />
          <Route path="/gaeste" element={<Guests />} />
          {isAdmin && <Route path="/zimmer" element={<RoomsPrices />} />}
          <Route path="/konto" element={<Account />} />
          {isAdmin && <Route path="/benutzer" element={<Users />} />}
          {isAdmin && <Route path="/protokoll" element={<Audit />} />}
          {isAdmin && <Route path="/einstellungen" element={<Settings />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </DataProvider>
      </main>
    </div>
  );
}
