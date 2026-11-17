import { useEffect, useState } from 'react';
import type { LogoUsage } from '../../src/shared/schemas.js';
import { api } from './api.ts';

/** Logo-Angaben einmal je Seitenaufruf laden (vorhanden? wo zeigen?) */
type Info = LogoUsage & { present: boolean };
let cache: Promise<Info> | null = null;
export const forgetLogoInfo = () => { cache = null; };
export function useLogoInfo(): Info | null {
  const [info, setInfo] = useState<Info | null>(null);
  useEffect(() => {
    cache ??= api<Info>('GET', '/settings/logo-info').catch(() => ({ present: false, printouts: false, guestPages: false, emails: false }));
    let live = true;
    void cache.then((i) => { if (live) setInfo(i); });
    return () => { live = false; };
  }, []);
  return info;
}

/** Logo auf Ausdrucken (Meldeschein, Tagesabschluss, Listen …) – nur wenn vorhanden und eingeschaltet */
export function PrintLogo({ className = 'printlogo' }: { className?: string }) {
  const i = useLogoInfo();
  if (!i?.present || !i.printouts) return null;
  return <img className={className} src="/api/v1/settings/logo" alt="" />;
}

/** Logo auf den Seiten für Gäste (ohne Anmeldung) – verschwindet still, wenn keins vorhanden oder ausgeschaltet ist */
export function GuestLogo() {
  const [ok, setOk] = useState(true);
  if (!ok) return null;
  return <img className="guestlogo" src="/api/v1/public/logo" alt="" onError={() => setOk(false)} />;
}
