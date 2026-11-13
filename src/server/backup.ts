import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from './lib/errors.js';

/**
 * Datensicherung der Windows-Version (pms.exe): täglich automatisch, auf Knopfdruck und vor jedem Programm-Update.
 * Optional wird jede Sicherung zusätzlich in einen zweiten Ordner kopiert (BACKUP_COPY_DIR, z. B. USB-Laufwerk oder NAS).
 */
export interface BackupStatus {
  /** false, wenn das PMS nicht als gepackte Version läuft (dann sichern die Skripte unter scripts/) */
  supported: boolean; auto: boolean;
  last: { file: string; at: string; sizeKb: number } | null;
  count: number; dir: string; copyDir: string; copyError: string | null; error: string | null; running: boolean;
}
interface Ctx { dir: string; run: () => string }

const PATTERN = /^pms-\d{8}-\d{6}\.dump$/;
const MAX_AGE_H = 20;
let ctx: Ctx | null = null;
let running = false;
let error: string | null = null;
let copyError: string | null = null;

const copyDir = () => (process.env.BACKUP_COPY_DIR ?? '').trim();
const autoOn = () => process.env.BACKUP_AUTO !== 'off';

function newest(dir: string) {
  if (!existsSync(dir)) return { last: null, count: 0 };
  const files = readdirSync(dir).filter((f) => PATTERN.test(f)).sort();
  const name = files.at(-1);
  if (!name) return { last: null, count: 0 };
  const st = statSync(join(dir, name));
  return { last: { file: name, at: st.mtime.toISOString(), sizeKb: Math.round(st.size / 1024) }, count: files.length };
}

export function getBackupStatus(): BackupStatus {
  if (!ctx) return { supported: false, auto: false, last: null, count: 0, dir: '', copyDir: '', copyError: null, error: null, running: false };
  return { supported: true, auto: autoOn(), ...newest(ctx.dir), dir: ctx.dir, copyDir: copyDir(), copyError, error, running };
}

export function runBackup(): BackupStatus {
  if (!ctx) throw new AppError(409, 'backup_unsupported', 'Die eingebaute Sicherung gibt es nur in der Windows-Version (pms.exe)');
  if (running) throw new AppError(409, 'backup_running', 'Die Sicherung läuft bereits');
  running = true;
  try {
    const file = ctx.run();
    error = null;
    const target = copyDir();
    if (target) {
      try {
        mkdirSync(target, { recursive: true });
        copyFileSync(file, join(target, file.split(/[\\/]/).pop()!));
        copyError = null;
      } catch (e) {
        copyError = `Kopie nach ${target} fehlgeschlagen: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    throw new AppError(500, 'backup_failed', `Sicherung fehlgeschlagen: ${error}`);
  } finally { running = false; }
  return getBackupStatus();
}

export function initBackup(c: Ctx) {
  ctx = c;
  if (!autoOn()) return;
  // stündlich prüfen: ist die jüngste Sicherung älter als 20 Stunden, wird neu gesichert
  const tick = () => {
    const { last } = newest(c.dir);
    if (last && Date.now() - new Date(last.at).getTime() < MAX_AGE_H * 3600_000) return;
    try { runBackup(); console.log('Automatische Datensicherung geschrieben'); } catch (e) { console.error(e instanceof Error ? e.message : e); }
  };
  setTimeout(tick, 3 * 60_000).unref();
  setInterval(tick, 3600_000).unref();
}
