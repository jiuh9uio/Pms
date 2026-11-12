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
