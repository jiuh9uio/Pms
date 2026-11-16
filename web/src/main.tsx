import './zod-config.ts';
import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { GuestSite } from './pages/GuestSite.tsx';
// Die interne Oberfläche und die übrigen Gästeseiten werden erst geladen, wenn sie gebraucht werden –
// Besucher der Gästeseite laden so nicht den Programmcode der Verwaltung mit.
const App = lazy(() => import('./App.tsx').then((m) => ({ default: m.App })));
const GuestFormPage = lazy(() => import('./pages/GuestFormPage.tsx').then((m) => ({ default: m.GuestFormPage })));
const BookingPage = lazy(() => import('./pages/BookingPage.tsx').then((m) => ({ default: m.BookingPage })));
const OfferPublicPage = lazy(() => import('./pages/OfferPublicPage.tsx').then((m) => ({ default: m.OfferPublicPage })));
const RequestPage = lazy(() => import('./pages/RequestPage.tsx').then((m) => ({ default: m.RequestPage })));
import { ToastProvider } from './ui.tsx';
import { applyMotion, applyTheme, storedMotion, storedTheme } from './theme.ts';
import './styles.css';

// Öffentliche Seiten für Gäste lesen nichts aus dem Speicher des Browsers (§ 25 TDDDG: kein Zugriff ohne Notwendigkeit);
// Farbschema und Animationen gelten nur in der Verwaltung.
const PUBLIC = /^\/(willkommen|anfrage|gast\/|buchung\/|angebot\/)/.test(window.location.pathname);
if (!PUBLIC) {
  applyTheme(storedTheme());
  applyMotion(storedMotion());
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
    {window.location.pathname.startsWith('/gast/')
      ? <ToastProvider><GuestFormPage /></ToastProvider> /* Online-Meldeschein für Gäste – ohne Anmeldung, ohne Menü */
      : window.location.pathname.startsWith('/buchung/')
        ? <ToastProvider><BookingPage /></ToastProvider> /* Reservierung für den Gast – über seinen persönlichen Link */
      : window.location.pathname.startsWith('/angebot/')
        ? <ToastProvider><OfferPublicPage /></ToastProvider> /* Angebot für den Kunden – über den Link in der E-Mail */
      : window.location.pathname === '/willkommen'
        ? <ToastProvider><GuestSite /></ToastProvider> /* Gästeseite – öffentlich */
      : window.location.pathname === '/anfrage'
        ? <ToastProvider><RequestPage /></ToastProvider> /* Zimmeranfrage für Gäste – ohne Anmeldung */
        : <BrowserRouter><App /></BrowserRouter>}
    </Suspense>
  </StrictMode>,
);
