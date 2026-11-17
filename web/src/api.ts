import type { ApiError } from '../../src/shared/schemas.js';

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

/** Zeitpunkt der letzten Eingabe (Tippen, Klicken, Scrollen) – der Server verlängert die Anmeldung nur bei echter Aktivität */
let lastInput = 0;
if (typeof window !== 'undefined')
  for (const e of ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const) window.addEventListener(e, () => { lastInput = Date.now(); }, { passive: true, capture: true });
const inputAge = () => (lastInput ? String(Date.now() - lastInput) : 'none');

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/v1' + path, {
      method, credentials: 'same-origin',
      headers: body === undefined ? { 'X-Input-Age': inputAge() } : { 'Content-Type': 'application/json', 'X-Input-Age': inputAge() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiFailure(0, 'network', 'Keine Verbindung zum Server');
  }
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const e = (data as ApiError | null)?.error;
    if (res.status === 401 && e?.code === 'unauthenticated') window.dispatchEvent(new Event('pms:signed-out'));
    throw new ApiFailure(res.status, e?.code ?? 'error', e?.message ?? `Fehler ${res.status}`, e?.fields);
  }
  return data as T;
}
