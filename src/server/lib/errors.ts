export class AppError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}
export const notFound = (what = 'Eintrag') => new AppError(404, 'not_found', `${what} nicht gefunden`);
export const forbidden = () => new AppError(403, 'forbidden', 'Dafür fehlt die Berechtigung');
export const conflict = (message: string, code = 'conflict') => new AppError(409, code, message);
export const stale = () =>
  new AppError(409, 'stale', 'Der Eintrag wurde zwischenzeitlich von jemand anderem geändert. Bitte neu laden und erneut versuchen.');

/** PostgreSQL-Fehlercode, auch wenn der Fehler vom ORM verpackt wurde. */
export function pgCode(err: unknown): string | undefined {
  for (let e = err as { code?: unknown; cause?: unknown } | undefined, i = 0; e && i < 5; e = e.cause as typeof e, i++)
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
  return undefined;
}

/** Meldungstext eines PostgreSQL-Fehlers (z. B. aus einem Schutz-Trigger), auch wenn er verpackt wurde. */
export function pgMessage(err: unknown): string | undefined {
  for (let e = err as { code?: unknown; message?: unknown; cause?: unknown } | undefined, i = 0; e && i < 5; e = e.cause as typeof e, i++)
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) && typeof e.message === 'string') return e.message;
  return undefined;
}
