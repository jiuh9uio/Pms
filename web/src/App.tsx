import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABEL, hasModule, type UserDto } from '../../src/shared/schemas.js';
import { api } from './api.ts';
import { Account } from './pages/Account.tsx';
import { Audit } from './pages/Audit.tsx';
import { DataProvider } from './data.tsx';
import { ControlType } from './pages/ControlType.tsx';
import { Controls } from './pages/Controls.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Guests } from './pages/Guests.tsx';
import { Invoices } from './pages/Invoices.tsx';
import { Companies } from './pages/Companies.tsx';
import { InvoicePrint } from './billing/InvoicePrint.tsx';
import { Launcher } from './pages/Launcher.tsx';
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

/** Abmelden – für alle Benutzer erreichbar, auch ohne die Seite „Mein Konto“. */
export function useLogout() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  return async () => {
    try { await api('POST', '/auth/logout'); } catch { /* Sitzung war bereits beendet */ }
    await refresh();
    navigate('/', { replace: true });
  };
}

const NAV = [
  { to: '/hotel', label: 'Übersicht', icon: '◧', admin: false, module: 'hotel' },
  { to: '/plan', label: 'Belegungsplan', short: 'Plan', icon: '▦', admin: false, module: 'hotel' },
  { to: '/reservierungen', label: 'Reservierungen', short: 'Buchungen', icon: '☷', admin: false, module: 'hotel' },
  { to: '/gaeste', label: 'Gäste', icon: '☺', admin: false, module: 'hotel' },
  { to: '/firmen', label: 'Firmen', icon: '⌘', admin: false, module: 'hotel', more: true },
  { to: '/rechnungen', label: 'Rechnungen', icon: '€', admin: false, module: 'hotel' },
  { to: '/zimmer', label: 'Zimmer & Preise', short: 'Zimmer', icon: '⌂', admin: true, more: true, module: 'hotel' },
  { to: '/kontrollen', label: 'Kontrollen', icon: '✓', admin: false, module: 'kontrollen' },
  { to: '/benutzer', label: 'Benutzer', icon: '◉', admin: true, module: 'verwaltung' },
  { to: '/protokoll', label: 'Protokoll', icon: '☰', admin: true, module: 'verwaltung' },
  { to: '/einstellungen', label: 'Einstellungen', short: 'Einstell.', icon: '⚙', admin: true, module: 'verwaltung' },
] as { to: string; label: string; short?: string; icon: string; admin: boolean; more?: boolean; module: string }[];
const MODULE_TITLE: Record<string, string> = { hotel: 'Hotel', kontrollen: 'Kontrollen', verwaltung: 'Verwaltung' };

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
  const { pathname } = useLocation();
  // Der Bereich (Hotel, Kontrollen, Verwaltung) ergibt sich aus der Adresse; das Startmenü hat keine Seitenleiste.
  const module = NAV.find((n) => pathname === n.to || pathname.startsWith(n.to + '/'))?.module;
  const nav = NAV.filter((n) => n.module === module && (!n.admin || isAdmin));
  const logout = useLogout();
  const hotel = hasModule(user, 'hotel');
  const kontrollen = hasModule(user, 'kontrollen');
  if (pathname === '/') return <Launcher />;
  if (hotel && pathname.startsWith('/rechnung/')) return <Routes><Route path="/rechnung/:id" element={<InvoicePrint />} /></Routes>;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="mark">S</span><span>Schützenhaus<small>{module ? MODULE_TITLE[module] : 'PMS'}</small></span></div>
        <nav aria-label="Hauptnavigation">
          <NavLink to="/" end className="menu"><span className="ico" aria-hidden>☰</span><span className="full">Menü</span><span className="short">Menü</span></NavLink>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/hotel'} className={n.more ? 'more' : undefined}><span className="ico" aria-hidden>{n.icon}</span><span className="full">{n.label}</span><span className="short">{n.short ?? n.label}</span></NavLink>
          ))}
          {isAdmin && <NavLink to="/konto" className="konto"><span className="ico" aria-hidden>◐</span><span className="full">Mein Konto</span><span className="short">Konto</span></NavLink>}
        </nav>
        <div className="whoami"><b>{user.name}</b><span>{ROLE_LABEL[user.role]}</span><button type="button" className="linkbtn" onClick={() => void logout()}>Abmelden</button></div>
      </aside>
      <main className="content">
        <DataProvider>
        <Routes>
          {hotel && <Route path="/hotel" element={<Dashboard />} />}
          {kontrollen && <Route path="/kontrollen" element={<Controls />} />}
          {kontrollen && <Route path="/kontrollen/:id" element={<ControlType />} />}
          {hotel && <Route path="/plan" element={<Plan />} />}
          {hotel && <Route path="/reservierungen" element={<Reservations />} />}
          {hotel && <Route path="/gaeste" element={<Guests />} />}
          {hotel && <Route path="/rechnungen" element={<Invoices />} />}
          {hotel && <Route path="/firmen" element={<Companies />} />}
          {isAdmin && <Route path="/zimmer" element={<RoomsPrices />} />}
          {isAdmin && <Route path="/konto" element={<Account />} />}
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
