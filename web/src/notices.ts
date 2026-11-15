import { useEffect, useState } from 'react';
import { DEFAULT_NOTICES, type Notices } from '../../src/shared/schemas.js';
import { api } from './api.ts';

/** Mitteilungen des Hauses (Einstellungen → Mitteilungen). Bis sie geladen sind, gilt: nichts aufdrängen. */
let cache: Notices | null = null;
const EVENT = 'pms-mitteilungen';
export const noticesChanged = (v: Notices) => { cache = v; window.dispatchEvent(new Event(EVENT)); };

export function useNotices(): Notices | null {
  const [v, setV] = useState<Notices | null>(cache);
  useEffect(() => {
    let stop = false;
    const sync = () => setV(cache);
    window.addEventListener(EVENT, sync);
    api<Notices>('GET', '/settings/notices').then((r) => { cache = { ...DEFAULT_NOTICES, ...r }; if (!stop) setV(cache); }).catch(() => { if (!stop && !cache) setV(DEFAULT_NOTICES); });
    return () => { stop = true; window.removeEventListener(EVENT, sync); };
  }, []);
  return v;
}
