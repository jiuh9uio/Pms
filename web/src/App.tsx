import { Fragment, createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_LABEL, hasModule, type Module, type UserDto } from '../../src/shared/schemas.js';
import { api } from './api.ts';
import { Account } from './pages/Account.tsx';
import { Audit } from './pages/Audit.tsx';
import { Breakfast } from './pages/Breakfast.tsx';
import { Report } from './pages/Report.tsx';
import { DataProvider } from './data.tsx';
import { ControlType } from './pages/ControlType.tsx';
import { Controls } from './pages/Controls.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { EInvoice } from './pages/EInvoice.tsx';
import { Guests } from './pages/Guests.tsx';
import { Invoices } from './pages/Invoices.tsx';
import { Companies } from './pages/Companies.tsx';
import { RegistrationPrint } from './hotel/RegistrationPrint.tsx';
import { Launcher } from './pages/Launcher.tsx';
import { Network } from './pages/Network.tsx';
import { Login } from './pages/Login.tsx';
import { Plan } from './pages/Plan.tsx';
import { QuickPrint } from './pages/QuickPrint.tsx';
import { Reservations } from './pages/Reservations.tsx';
import { Restaurant } from './pages/Restaurant.tsx';
import { DayReport } from './pages/DayReport.tsx';
import { Housekeeping } from './pages/Housekeeping.tsx';
import { NetAlert } from './NetAlert.tsx';
import { Inbox } from './pages/Inbox.tsx';
import { AsProgram } from './pages/AsProgram.tsx';
import { Setup } from './pages/Setup.tsx';
import { Team } from './pages/Team.tsx';
import { RoomsPrices } from './pages/RoomsPrices.tsx';
import { Settings } from './pages/Settings.tsx';
import { Users } from './pages/Users.tsx';
import { Search } from './Search.tsx';
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

/**
 * Navigation je Bereich. `group` setzt eine Zwischenüberschrift, `need` ist die nötige Freigabe (wenn sie vom Bereich abweicht),
 * `jump` ist ein Sprung in einen anderen Bereich (bestimmt nicht, in welchem Bereich man gerade ist), `tab` wählt einen Reiter der Zielseite.
 */
interface NavItem { to: string; label: string; short?: string; icon: string; admin?: boolean; more?: boolean; module: string; group?: string; need?: Module; jump?: boolean; tab?: string }
const NAV: NavItem[] = [
  { to: '/hotel', label: 'Übersicht', icon: '◧', module: 'hotel', group: 'Heute' },
  { to: '/plan', label: 'Belegungsplan', short: 'Plan', icon: '▦', module: 'hotel', group: 'Heute' },
  { to: '/reservierungen', label: 'Reservierungen', short: 'Buchungen', icon: '☷', module: 'hotel', group: 'Heute' },
  { to: '/fruehstueck', label: 'Frühstück', icon: '☕', module: 'hotel', group: 'Haus' },
  { to: '/reinigung', label: 'Reinigung', icon: '✧', module: 'hotel', group: 'Haus' },
  { to: '/gaeste', label: 'Gäste', icon: '☺', module: 'hotel', group: 'Kunden' },
  { to: '/firmen', label: 'Firmen', icon: '⌘', module: 'hotel', more: true, group: 'Kunden' },
  { to: '/rechnungen', label: 'Rechnungen', short: 'Rechn.', icon: '€', module: 'hotel', group: 'Abrechnung', jump: true },
  { to: '/tagesabschluss', label: 'Tagesabschluss', short: 'Abschluss', icon: '∑', module: 'hotel', more: true, group: 'Abrechnung' },
  { to: '/auswertung', label: 'Auswertung', icon: '◔', module: 'hotel', more: true, group: 'Abrechnung' },
  { to: '/zimmer', label: 'Zimmer & Preise', short: 'Zimmer', icon: '⌂', admin: true, more: true, module: 'hotel', group: 'Einrichtung' },
  { to: '/restaurant', label: 'Tischreservierungen', short: 'Tische', icon: '◍', module: 'restaurant' },
  // Rechnungen: alles, was mit Rechnungen zu tun hat, an einem Ort – jede Zeile verlangt ihre eigene Freigabe
  { to: '/rechnungen', label: 'Hotelrechnungen', short: 'Hotel', icon: '€', module: 'rechnungen', need: 'hotel', group: 'Hotel' },
  { to: '/tagesabschluss', label: 'Tagesabschluss', short: 'Abschluss', icon: '∑', module: 'rechnungen', need: 'hotel', group: 'Hotel', jump: true },
  { to: '/erechnung', label: 'E-Rechnung erstellen', short: 'E-Rechn.', icon: '✉', module: 'rechnungen', need: 'erechnung', group: 'E-Rechnung' },
  { to: '/erechnung', tab: 'archiv', label: 'E-Rechnungs-Archiv', short: 'Archiv', icon: '▤', module: 'rechnungen', need: 'erechnung', group: 'E-Rechnung' },
  { to: '/einstellungen', tab: 'steuern', label: 'Steuern & Nummern', short: 'Steuern', icon: '％', module: 'rechnungen', admin: true, more: true, group: 'Einrichtung', jump: true },
  { to: '/schnelldruck', label: 'Schnelldruck', short: 'Druck', icon: '⎙', module: 'schnelldruck' },
  { to: '/kontrollen', label: 'Kontrollen', icon: '✓', module: 'kontrollen' },
  { to: '/internet', label: 'Internet', short: 'Netz', icon: '⌁', module: 'internet' },
  { to: '/team', label: 'Übergabebuch', short: 'Team', icon: '✎', module: 'team' },
  { to: '/reinigung', label: 'Reinigung (Hotel)', short: 'Reinig.', icon: '✧', module: 'team', need: 'hotel', jump: true },
  { to: '/email', label: 'Posteingang', short: 'E-Mail', icon: '✉', module: 'email' },
  { to: '/einstellungen', tab: 'email', label: 'Einrichtung', short: 'Einricht.', icon: '⚙', module: 'email', admin: true, jump: true, group: 'Einrichtung' },
  { to: '/einstellungen', label: 'Einstellungen', short: 'Einstell.', icon: '⚙', admin: true, module: 'verwaltung', group: 'Verwaltung' },
  { to: '/benutzer', label: 'Benutzer', icon: '◉', admin: true, module: 'verwaltung', group: 'Verwaltung' },
  { to: '/protokoll', label: 'Protokoll', icon: '☰', admin: true, module: 'verwaltung', group: 'Verwaltung' },
  { to: '/erste-schritte', label: 'Erste Schritte', short: 'Start', icon: '✔', admin: true, module: 'verwaltung', group: 'Hilfe' },
  { to: '/als-programm', label: 'Als Programm öffnen', short: 'Programm', icon: '▣', module: 'verwaltung', group: 'Hilfe' },
];
const MODULE_TITLE: Record<string, string> = { hotel: 'Hotel', restaurant: 'Restaurant', schnelldruck: 'Schnelldruck', kontrollen: 'Kontrollen', erechnung: 'E-Rechnung', internet: 'Internet', email: 'E-Mail', team: 'Team', verwaltung: 'Verwaltung', rechnungen: 'Rechnungen' };

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

/** Meldet ab, wenn so lange nichts getippt, geklickt oder bewegt wurde, wie unter Einstellungen → Sicherheit festgelegt ist. */
function useIdleLogout(logout: () => Promise<void>) {
  const [minutes, setMinutes] = useState(0);
  const out = useRef(logout);
  out.current = logout;
  useEffect(() => {
    const load = () => void api<{ idleMinutes: number }>('GET', '/settings/security').then((r) => setMinutes(r.idleMinutes)).catch(() => {});
    load();
    window.addEventListener('pms-sicherheit', load);
    return () => window.removeEventListener('pms-sicherheit', load);
  }, []);
  useEffect(() => {
    if (!minutes) return;
    let last = Date.now();
    const touch = () => { last = Date.now(); };
    const events = ['pointerdown', 'keydown', 'pointermove', 'wheel', 'touchstart'] as const;
    events.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const t = setInterval(() => { if (Date.now() - last >= minutes * 60_000) { last = Date.now(); void out.current(); } }, 15_000);
    return () => { clearInterval(t); events.forEach((e) => window.removeEventListener(e, touch)); };
  }, [minutes]);
}

function Shell({ user }: { user: UserDto }) {
  const isAdmin = user.role === 'admin';
  const { pathname, search } = useLocation();
  const go = useNavigate();
  const here = (n: NavItem) => pathname === n.to || pathname.startsWith(n.to + '/');
  // Der Bereich (Hotel, Rechnungen, Verwaltung …) ergibt sich aus der Adresse; Sprünge in andere Bereiche zählen dabei nicht.
  const module = NAV.find((n) => !n.jump && here(n))?.module;
  const nav = NAV.filter((n) => n.module === module && (!n.admin || isAdmin) && (!n.need || hasModule(user, n.need)));
  const ansicht = new URLSearchParams(search).get('ansicht');
  /** Aktiv ist ein Punkt, wenn Adresse und – bei Punkten derselben Seite – der Reiter passen. */
  const active = (n: NavItem) => {
    if (n.jump || !here(n) || (n.to === '/hotel' && pathname !== '/hotel')) return false;
    if (n.tab) return ansicht === n.tab;
    return !nav.some((o) => o !== n && o.to === n.to && o.tab && o.tab === ansicht);
  };
  // Aus einem anderen Bereich hierher gesprungen (z. B. Hotel → Rechnungen): Rückweg anbieten
  const home = module === 'rechnungen' && hasModule(user, 'hotel') ? { to: '/hotel', label: 'Hotel' } : null;
  const logout = useLogout();
  const hotel = hasModule(user, 'hotel');
  const kontrollen = hasModule(user, 'kontrollen');
  const erechnung = hasModule(user, 'erechnung');
  const internet = hasModule(user, 'internet');
  const email = hasModule(user, 'email');
  useIdleLogout(logout);
  if (pathname === '/') return <DataProvider><NetAlert /><Launcher /></DataProvider>;
  if (hotel && pathname.startsWith('/meldeschein/')) return <Routes><Route path="/meldeschein/:id" element={<RegistrationPrint />} /></Routes>;
  return (
    <DataProvider>
    <NetAlert />
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="mark">S</span><span>Schützenhaus<small>{module ? MODULE_TITLE[module] : 'PMS'}</small></span>
          <span className="histnav noprint"><button type="button" className="iconbtn" onClick={() => go(-1)} aria-label="Zurück" title="Zurück">‹</button><button type="button" className="iconbtn" onClick={() => go(1)} aria-label="Vor" title="Vor">›</button></span></div>
        <nav aria-label="Hauptnavigation">
          <NavLink to="/" end className="menu"><span className="ico" aria-hidden>☰</span><span className="full">Menü</span><span className="short">Menü</span></NavLink>
          <Search variant="nav" />
          {home && <Link to={home.to} className="backlink"><span className="ico" aria-hidden>←</span><span className="full">Zurück zu {home.label}</span><span className="short">{home.label}</span></Link>}
          {nav.map((n, i) => (
            <Fragment key={`${n.to}?${n.tab ?? ''}`}>
              {n.group && n.group !== nav[i - 1]?.group && <span className="navgroup" aria-hidden>{n.group}</span>}
              <Link to={n.tab ? `${n.to}?ansicht=${n.tab}` : n.to} aria-current={active(n) ? 'page' : undefined} className={[active(n) ? 'active' : '', n.more ? 'more' : '', n.jump ? 'jump' : ''].filter(Boolean).join(' ') || undefined}>
                <span className="ico" aria-hidden>{n.icon}</span><span className="full">{n.label}</span><span className="short">{n.short ?? n.label}</span>{n.jump && <span className="jumpmark" aria-hidden>›</span>}
              </Link>
            </Fragment>
          ))}
          {<NavLink to="/konto" className="konto"><span className="ico" aria-hidden>◐</span><span className="full">Mein Konto</span><span className="short">Konto</span></NavLink>}
        </nav>
        <div className="whoami"><b>{user.name}</b><span>{ROLE_LABEL[user.role]}</span><button type="button" className="linkbtn" onClick={() => void logout()}>Abmelden</button></div>
      </aside>
      <main className="content">
        <Routes>
          {hotel && <Route path="/hotel" element={<Dashboard />} />}
          {erechnung && <Route path="/erechnung" element={<EInvoice />} />}
          {kontrollen && <Route path="/kontrollen" element={<Controls />} />}
          {kontrollen && <Route path="/kontrollen/:id" element={<ControlType />} />}
          {hotel && <Route path="/plan" element={<Plan />} />}
          {hotel && <Route path="/reservierungen" element={<Reservations />} />}
          {hotel && <Route path="/fruehstueck" element={<Breakfast />} />}
          {hotel && <Route path="/reinigung" element={<Housekeeping />} />}
          {hotel && <Route path="/tagesabschluss" element={<DayReport />} />}
          <Route path="/team" element={<Team />} />
          {hotel && <Route path="/gaeste" element={<Guests />} />}
          {hotel && <Route path="/rechnungen" element={<Invoices />} />}
          {hotel && <Route path="/firmen" element={<Companies />} />}
          {hotel && <Route path="/auswertung" element={<Report />} />}
          {isAdmin && <Route path="/zimmer" element={<RoomsPrices />} />}
          <Route path="/konto" element={<Account />} />
          <Route path="/als-programm" element={<AsProgram />} />
          {isAdmin && <Route path="/erste-schritte" element={<Setup />} />}
          {isAdmin && <Route path="/benutzer" element={<Users />} />}
          {hasModule(user, 'restaurant') && <Route path="/restaurant" element={<Restaurant />} />}
          {hasModule(user, 'schnelldruck') && <Route path="/schnelldruck" element={<QuickPrint />} />}
          {internet && <Route path="/internet" element={<Network />} />}
          {email && <Route path="/email" element={<Inbox />} />}
          {isAdmin && <Route path="/protokoll" element={<Audit />} />}
          {isAdmin && <Route path="/einstellungen" element={<Settings />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
    </DataProvider>
  );
}
