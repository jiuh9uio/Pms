import type { ApiError } from '../../src/shared/schemas.js';

export class ApiFailure extends Error {
  constructor(public status: number, public code: string, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

export async function api<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch('/api/v1' + path, {
      method, credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
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
