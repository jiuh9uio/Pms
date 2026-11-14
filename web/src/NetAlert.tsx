import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { NetAlertDto } from '../../src/shared/schemas.js';
import { api } from './api.ts';
import { Button, Dialog, useToast } from './ui.tsx';

const KEY = 'pms.netzhinweis';
/** Hinweis „Internet ist weg“ in diesem Browser ein- oder ausgeschaltet (Standard: ein). */
export const netAlertOn = () => { try { return localStorage.getItem(KEY) !== 'aus'; } catch { return true; } };
export const setNetAlertOn = (on: boolean) => { try { localStorage.setItem(KEY, on ? 'an' : 'aus'); } catch { /* ohne Speicher gilt die Wahl bis zum Neuladen */ } window.dispatchEvent(new Event('pms-netzhinweis')); };
/** Ausfall, dessen Hinweisfenster in diesem Browser schon gezeigt wurde – damit es beim Neuladen oder in einem zweiten Fenster nicht noch einmal erscheint */
const SEEN = 'pms.netzhinweis.gesehen';
const seenGet = () => { try { return localStorage.getItem(SEEN); } catch { return null; } };
const seenSet = (v: string | null) => { try { if (v) localStorage.setItem(SEEN, v); else localStorage.removeItem(SEEN); } catch { /* ohne Speicher */ } };
const clock = (iso: string) => new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
/** Meldung des Betriebssystems (unten rechts) – nur wenn der Benutzer sie in diesem Browser erlaubt hat. */
function systemNote(title: string, body: string) {
  try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body, tag: 'pms-internet' }); } catch { /* nicht verfügbar */ }
}

/**
 * Fragt jede halbe Minute beim Programm nach, ob das Internet weg ist (das Programm selbst läuft im Haus und bleibt erreichbar).
 * Beginnt ein Ausfall, erscheint einmal ein Hinweisfenster; solange er dauert, bleibt oben ein roter Balken stehen.
 */
export function NetAlert() {
  const toast = useToast();
  const [on, setOn] = useState(netAlertOn);
  const [a, setA] = useState<NetAlertDto | null>(null);
  const [popup, setPopup] = useState(false);
  const seen = useRef<string | null>(seenGet());
  useEffect(() => {
    const sync = () => setOn(netAlertOn());
    window.addEventListener('pms-netzhinweis', sync);
    return () => window.removeEventListener('pms-netzhinweis', sync);
  }, []);
  useEffect(() => {
    if (!on) { setA(null); setPopup(false); return; }
    let stop = false;
    const check = async () => {
      try {
        const r = await api<NetAlertDto>('GET', '/network/alert');
        if (stop) return;
        if (r.offline && r.since && seen.current !== r.since) {
          seen.current = r.since; seenSet(r.since); setPopup(true);
          systemNote('Internet ausgefallen', `Seit ${clock(r.since)} Uhr besteht keine Internetverbindung.`);
        }
        if (!r.offline && seen.current) { seen.current = null; seenSet(null); setPopup(false); toast('Das Internet ist wieder da'); systemNote('Internet wieder da', 'Die Internetverbindung funktioniert wieder.'); }
        setA(r);
      } catch { /* Programm gerade nicht erreichbar – beim nächsten Mal wieder */ }
    };
    void check();
    const t = setInterval(() => void check(), 30_000);
    return () => { stop = true; clearInterval(t); };
  }, [on, toast]);
  if (!a?.offline || !a.since) return null;
  const steps = a.steps.length > 0 && <ul>{a.steps.map((s, i) => <li key={i}>{s}</li>)}</ul>;
  return (
    <>
      <div className="netbanner" role="alert"><b>Kein Internet</b> seit {clock(a.since)} Uhr.{a.steps.length > 0 && ` ${a.steps.at(-1)}.`} <Link to="/internet">Zur Internet-Seite</Link></div>
      {popup && (
        <Dialog title="Das Internet ist ausgefallen" onClose={() => setPopup(false)} footer={<Button variant="primary" onClick={() => setPopup(false)}>Verstanden</Button>}>
          <p>Seit <b>{clock(a.since)} Uhr</b> erreicht dieser Rechner das Internet nicht mehr.</p>
          <p>Das Programm selbst läuft weiter – Reservierungen, Rechnungen und Drucken funktionieren. Nicht möglich sind solange E-Mails, Kartenzahlungen über das Internet und das Programm-Update.</p>
          {steps ? <><p>Bisher automatisch unternommen:</p>{steps}</> : <p className="muted">Unter Internet → Internetverbindung lässt sich die FRITZ!Box von hier aus zurücksetzen.</p>}
        </Dialog>
      )}
    </>
  );
}
