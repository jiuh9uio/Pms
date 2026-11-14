import './zod-config.ts';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App.tsx';
import { GuestFormPage } from './pages/GuestFormPage.tsx';
import { BookingPage } from './pages/BookingPage.tsx';
import { RequestPage } from './pages/RequestPage.tsx';
import { ToastProvider } from './ui.tsx';
import { applyTheme, storedTheme } from './theme.ts';
import './styles.css';

applyTheme(storedTheme());
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname.startsWith('/gast/')
      ? <ToastProvider><GuestFormPage /></ToastProvider> /* Online-Meldeschein für Gäste – ohne Anmeldung, ohne Menü */
      : window.location.pathname.startsWith('/buchung/')
        ? <ToastProvider><BookingPage /></ToastProvider> /* Reservierung für den Gast – über seinen persönlichen Link */
      : window.location.pathname === '/anfrage'
        ? <ToastProvider><RequestPage /></ToastProvider> /* Zimmeranfrage für Gäste – ohne Anmeldung */
        : <BrowserRouter><App /></BrowserRouter>}
  </StrictMode>,
);
