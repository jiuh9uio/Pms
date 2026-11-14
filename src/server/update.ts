import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from './lib/errors.js';

/**
 * Programm-Update für die Windows-Version (pms.exe).
 *
 * Ablauf: neueste Veröffentlichung abfragen → ZIP herunterladen und Prüfsumme vergleichen → entpacken und prüfen →
 * Datensicherung → ein Hilfsskript wartet, bis das PMS beendet ist, legt eine Kopie der bisherigen Programmdateien ab,
 * kopiert die neuen darüber (ohne data/, backups/ und pms.env) und startet das PMS wieder.
 * Die Datenbank selbst wird beim nächsten Start durch die mitgelieferten Migrationen aktualisiert.
 */

/** Quelle der Veröffentlichungen. Nur zu Testzwecken über PMS_UPDATE_URL änderbar. */
const RELEASES_URL = 'https://api.github.com/repos/jiuh9uio/Pms/releases/latest';
const ASSET = 'SchuetzenhausPMS-Windows.zip';

export interface UpdateStatus {
  /** false, wenn das PMS nicht als gepackte Version läuft (dann wird über den Quelltext aktualisiert) */
  supported: boolean;
  current: string; latest: string | null; available: boolean; checkedAt: string | null; error: string | null;
  notes: string; installing: boolean;
}
interface Ctx {
  home: string; version: string; pgMajor: string;
  backup: () => void;
  shutdown: () => Promise<void>;
}
interface Release { version: string; zipUrl: string; shaUrl: string | null; notes: string }

let ctx: Ctx | null = null;
let release: Release | null = null;
let status: UpdateStatus = { supported: false, current: 'Entwicklungsstand', latest: null, available: false, checkedAt: null, error: null, notes: '', installing: false };

const parts = (v: string) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
export function isNewer(candidate: string, current: string) {
  const a = parts(candidate), b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
}

export function initUpdater(c: Ctx) {
  ctx = c;
  status = { ...status, supported: true, current: c.version };
  // entpackte Dateien eines abgeschlossenen Updates aufräumen (update/previous bleibt als Rückweg erhalten)
  try { rmSync(join(c.home, 'update', 'new'), { recursive: true, force: true }); } catch { /* unkritisch */ }
  // beim Start und danach zweimal täglich nachsehen; Fehler (z. B. kein Internet) bleiben folgenlos
  if (process.env.PMS_UPDATE_CHECK !== 'off') {
    setTimeout(() => void checkForUpdate().catch(() => {}), 20_000).unref();
    setInterval(() => void checkForUpdate().catch(() => {}), 12 * 3600_000).unref();
  }
}

export const getUpdateStatus = () => status;

export interface ChangelogEntry { version: string; text: string }
/** „Was ist neu“: Abschnitte aus CHANGELOG.md (im Paket unter app/, sonst im Projektordner), neueste zuerst. */
export function parseChangelog(md: string): ChangelogEntry[] {
  const out: ChangelogEntry[] = [];
  for (const part of md.split(/^## /m).slice(1)) {
    const nl = part.indexOf('\n');
    const version = (nl < 0 ? part : part.slice(0, nl)).trim();
    if (/^\d+(\.\d+)+$/.test(version)) out.push({ version, text: (nl < 0 ? '' : part.slice(nl + 1)).trim() });
  }
  return out;
}
export function getChangelog(): ChangelogEntry[] {
  for (const file of [ctx ? join(ctx.home, 'app', 'CHANGELOG.md') : '', join(process.cwd(), 'CHANGELOG.md')]) {
    try { if (file && existsSync(file)) return parseChangelog(readFileSync(file, 'utf8')).slice(0, 100); } catch { /* nächste Stelle */ }
  }
  return [];
}

async function get(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'pms-updater', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(60_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`Antwort ${res.status} von ${new URL(url).host}`);
  return res;
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!ctx) return status;
  try {
    const data = (await (await get(process.env.PMS_UPDATE_URL || RELEASES_URL)).json()) as { tag_name?: string; body?: string; assets?: { name: string; browser_download_url: string }[] };
    const zip = data.assets?.find((a) => a.name === ASSET);
    if (!data.tag_name || !zip) throw new Error('Die Veröffentlichung enthält kein Programmpaket');
    release = { version: data.tag_name.replace(/^v/, ''), zipUrl: zip.browser_download_url, shaUrl: data.assets?.find((a) => a.name === `${ASSET}.sha256`)?.browser_download_url ?? null, notes: (data.body ?? '').slice(0, 2000) };
    status = { ...status, latest: release.version, available: isNewer(release.version, ctx.version), checkedAt: new Date().toISOString(), error: null, notes: release.notes };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    status = { ...status, checkedAt: new Date().toISOString(), error: /fetch failed|ENOTFOUND|EAI_AGAIN|timeout|aborted/i.test(msg) ? 'Keine Verbindung zum Update-Server (Internet erreichbar?)' : msg };
  }
  return status;
}

const win = process.platform === 'win32';

/** Hilfsskript, das nach dem Beenden des PMS die Dateien austauscht und das PMS neu startet. */
function writeApplyScript(home: string, source: string) {
  const dir = join(home, 'update');
  if (win) {
    const file = join(dir, 'apply.bat');
    writeFileSync(file, [
      '@echo off',
      'setlocal',
      `set "HOME_DIR=${home}"`,
      `set "NEW_DIR=${source}"`,
      'set "LOG=%HOME_DIR%\\update\\update.log"',
      'echo [%date% %time%] Warte auf das Ende des PMS >> "%LOG%"',
      'set /a TRIES=0',
      ':wait',
      // pms.exe ist erst beschreibbar, wenn der Prozess beendet ist
      '2>nul ( >>"%HOME_DIR%\\pms.exe" (call ) ) && goto swap',
      'set /a TRIES+=1',
      'if %TRIES% GEQ 120 ( echo [%date% %time%] Abbruch: PMS wurde nicht beendet >> "%LOG%" & exit /b 1 )',
      'ping -n 2 127.0.0.1 >nul',
      'goto wait',
      ':swap',
      'echo [%date% %time%] Sichere bisherige Programmdateien nach update\\previous >> "%LOG%"',
      'robocopy "%HOME_DIR%" "%HOME_DIR%\\update\\previous" /MIR /XD data backups update logs /XF pms.env /NFL /NDL /NJH /NJS /NP /R:2 /W:1 >> "%LOG%"',
      'echo [%date% %time%] Kopiere neue Programmdateien >> "%LOG%"',
      'robocopy "%NEW_DIR%" "%HOME_DIR%" /E /XD data backups update logs /XF pms.env /NFL /NDL /NJH /NJS /NP /R:2 /W:1 >> "%LOG%"',
      'if errorlevel 8 (',
      '  echo [%date% %time%] FEHLER beim Kopieren - stelle vorherige Version wieder her >> "%LOG%"',
      '  robocopy "%HOME_DIR%\\update\\previous" "%HOME_DIR%" /E /NFL /NDL /NJH /NJS /NP /R:2 /W:1 >> "%LOG%"',
      ')',
      'echo [%date% %time%] Starte das PMS >> "%LOG%"',
      'start "Schuetzenhaus PMS" /D "%HOME_DIR%" "%HOME_DIR%\\pms.exe" --no-browser',
      'endlocal',
      '',
    ].join('\r\n'));
    return { cmd: 'cmd', args: ['/c', file] };
  }
  const file = join(dir, 'apply.sh');
  writeFileSync(file, `#!/bin/sh
LOG="${home}/update/update.log"
echo "$(date) Warte auf das Ende des PMS" >> "$LOG"
i=0
while kill -0 ${process.pid} 2>/dev/null; do i=$((i+1)); [ $i -gt 240 ] && { echo "Abbruch: PMS wurde nicht beendet" >> "$LOG"; exit 1; }; sleep 0.5; done
rm -rf "${home}/update/previous" && mkdir -p "${home}/update/previous"
for f in "${home}"/*; do case "$(basename "$f")" in data|backups|update|logs|pms.env) ;; *) cp -a "$f" "${home}/update/previous/" ;; esac; done
rm -f "${source}/pms.env"
if cp -a "${source}/." "${home}/" >> "$LOG" 2>&1; then echo "$(date) Neue Programmdateien kopiert" >> "$LOG"
else echo "$(date) FEHLER beim Kopieren - stelle vorherige Version wieder her" >> "$LOG"; cp -a "${home}/update/previous/." "${home}/"; fi
cd "${home}" && nohup ./pms --no-browser >> "${home}/update/restart.log" 2>&1 &
`);
    chmodSync(file, 0o755);
    return { cmd: '/bin/sh', args: [file] };
}

export async function installUpdate(): Promise<{ version: string }> {
  if (!ctx) throw new AppError(409, 'update_unsupported', 'Das automatische Update gibt es nur in der Windows-Version (pms.exe)');
  if (status.installing) throw new AppError(409, 'update_running', 'Das Update läuft bereits');
  await checkForUpdate();
  if (status.error) throw new AppError(502, 'update_check', `Update-Prüfung fehlgeschlagen: ${status.error}`);
  if (!release || !status.available) throw new AppError(409, 'update_none', 'Es ist keine neuere Version verfügbar');
  const { home } = ctx;
  const dir = join(home, 'update');
  const log = (m: string) => appendFileSync(join(dir, 'update.log'), `${new Date().toISOString()} ${m}\n`);
  status = { ...status, installing: true };
  try {
    mkdirSync(dir, { recursive: true });
    log(`Update von ${ctx.version} auf ${release.version}`);
    const zip = Buffer.from(await (await get(release.zipUrl)).arrayBuffer());
    const sha = createHash('sha256').update(zip).digest('hex');
    if (release.shaUrl) {
      const expected = (await (await get(release.shaUrl)).text()).trim().split(/\s+/)[0]!.toLowerCase();
      if (expected !== sha) throw new Error('Die Prüfsumme der heruntergeladenen Datei stimmt nicht – Update abgebrochen');
    } else throw new Error('Zur Veröffentlichung fehlt die Prüfsumme – Update abgebrochen');
    const zipFile = join(dir, 'download.zip');
    writeFileSync(zipFile, zip);
    const target = join(dir, 'new');
    rmSync(target, { recursive: true, force: true });
    if (win) execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zipFile.replace(/'/g, "''")}' -DestinationPath '${target.replace(/'/g, "''")}' -Force`], { windowsHide: true, stdio: 'ignore' });
    else execFileSync('unzip', ['-q', zipFile, '-d', target], { stdio: 'ignore' });
    rmSync(zipFile, { force: true });

    // Paket prüfen: enthält Programm und Versionsangabe, passt zur Datenbank
    const exeName = win ? 'pms.exe' : 'pms';
    const source = [target, join(target, 'SchuetzenhausPMS')].find((d) => existsSync(join(d, exeName)) && existsSync(join(d, 'app', 'version.json')));
    if (!source) throw new Error('Das heruntergeladene Paket ist unvollständig');
    const info = JSON.parse(readFileSync(join(source, 'app', 'version.json'), 'utf8')) as { version: string; pgMajor: string };
    if (info.version !== release.version) throw new Error(`Das Paket enthält Version ${info.version} statt ${release.version}`);
    if (info.pgMajor !== ctx.pgMajor)
      throw new Error(`Die neue Version bringt eine andere Datenbank-Hauptversion mit (${info.pgMajor} statt ${ctx.pgMajor}). Dieses Update muss von Hand eingespielt werden – siehe README.`);

    ctx.backup();
    log('Datensicherung geschrieben');
    const script = writeApplyScript(home, source);
    spawn(script.cmd, script.args, { detached: true, stdio: 'ignore', windowsHide: true, cwd: home }).unref();
    log('Hilfsskript gestartet, PMS wird beendet');
    setTimeout(() => void ctx!.shutdown(), 1500);
    return { version: release.version };
  } catch (e) {
    status = { ...status, installing: false };
    const msg = e instanceof Error ? e.message : String(e);
    try { log(`FEHLER: ${msg}`); } catch { /* Ordner nicht beschreibbar */ }
    throw e instanceof AppError ? e : new AppError(502, 'update_failed', msg);
  }
}
