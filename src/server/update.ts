import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, chmodSync, createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
  /** Fortschritt eines laufenden Updates (läuft im Hintergrund weiter, auch wenn die Seite geschlossen wird) */
  progress: { step: 'download' | 'verify' | 'unpack' | 'backup' | 'restart'; received: number; total: number | null; attempt: number } | null;
  /** Fehler des letzten Update-Versuchs (z. B. Download abgebrochen) */
  installError: string | null;
}
interface Ctx {
  home: string; version: string; pgMajor: string;
  backup: () => void;
  shutdown: () => Promise<void>;
}
interface Release { version: string; zipUrl: string; shaUrl: string | null; notes: string }

let ctx: Ctx | null = null;
let release: Release | null = null;
let status: UpdateStatus = { supported: false, current: 'Entwicklungsstand', latest: null, available: false, checkedAt: null, error: null, notes: '', installing: false, progress: null, installError: null };

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

/** Technische Fehlermeldungen (oft englisch) in verständliches Deutsch übersetzen. */
export function updateErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/abort|timeout|timed out/i.test(msg)) return 'Die Verbindung war zu langsam oder ist abgebrochen. Bitte erneut versuchen – der Download setzt dort fort, wo er aufgehört hat.';
  if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNRESET|ECONNREFUSED|socket|network/i.test(msg)) return 'Keine Verbindung zum Update-Server (Internet erreichbar?). Bitte später erneut versuchen.';
  return msg;
}

/**
 * Großes Paket herunterladen: direkt in eine Datei, ohne feste Gesamtzeit (langsame Leitungen brauchen für ~80 MB mehrere Minuten).
 * Abgebrochen wird nur, wenn 90 Sekunden lang keine Daten kommen. Bricht die Verbindung ab, wird bis zu fünfmal neu angesetzt –
 * wenn der Server es erlaubt, ab der Stelle, an der es aufgehört hat (Range).
 */
export async function downloadFile(url: string, file: string, onProgress: (received: number, total: number | null, attempt: number) => void, o: { idleMs?: number; attempts?: number } = {}) {
  const idleMs = o.idleMs ?? 90_000, attempts = o.attempts ?? 5;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const have = existsSync(file) ? statSync(file).size : 0;
    const ctl = new AbortController();
    let out: ReturnType<typeof createWriteStream> | null = null;
    let idle = setTimeout(() => ctl.abort(new Error('timeout')), idleMs);
    const kick = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(new Error('timeout')), idleMs); };
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'pms-updater', ...(have ? { Range: `bytes=${have}-` } : {}) }, signal: ctl.signal, redirect: 'follow' });
      if (res.status === 416 && have) { clearTimeout(idle); return; } // schon vollständig
      if (!res.ok) throw new Error(`Antwort ${res.status} von ${new URL(url).host}`);
      const resumed = res.status === 206 && have > 0;
      const len = Number(res.headers.get('content-length')) || null;
      const total = len === null ? null : resumed ? have + len : len;
      let received = resumed ? have : 0;
      const w = createWriteStream(file, { flags: resumed ? 'a' : 'w' });
      out = w;
      const done = new Promise<void>((resolve, reject) => { w.on('finish', () => resolve()); w.on('error', reject); });
      onProgress(received, total, attempt);
      const reader = res.body!.getReader();
      for (;;) {
        const { done: end, value } = await reader.read();
        if (end) break;
        kick();
        received += value.length;
        if (!w.write(value)) await new Promise((r) => w.once('drain', r));
        onProgress(received, total, attempt);
      }
      w.end();
      await done;
      out = null;
      clearTimeout(idle);
      if (total !== null && received < total) throw new Error('timeout');
      return;
    } catch (e) {
      clearTimeout(idle);
      // Datei schließen (Windows sperrt offene Dateien), damit der nächste Versuch weiterschreiben kann
      if (out) { const o2 = out; await new Promise<void>((r) => { o2.once('close', () => r()); o2.end(); setTimeout(r, 2000); }); out = null; }
      lastError = e;
      if (/Antwort 4\d\d/.test(e instanceof Error ? e.message : '') && !/Antwort 416/.test(String(e))) break; // nicht gefunden o. ä.: Wiederholen hilft nicht
      if (attempt < attempts) await new Promise((r) => setTimeout(r, Math.min(30_000, 2000 * attempt)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

const sha256File = (file: string) => new Promise<string>((resolve, reject) => {
  const h = createHash('sha256');
  createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
});

async function get(url: string) {
  const res = await fetch(url, { headers: { 'User-Agent': 'pms-updater', Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(60_000), redirect: 'follow' });
  if (!res.ok) throw new Error(`Antwort ${res.status} von ${new URL(url).host}`);
  return res;
}

/**
 * Ersatzweg, wenn die GitHub-Schnittstelle die Abfrage ablehnt (403/429: Begrenzung für Abfragen ohne Anmeldung, 60 je Stunde und
 * Internetanschluss – teilen sich mehrere Geräte einen Anschluss, ist sie schnell erreicht): Die normale Seite „neueste Version“
 * leitet auf die Versionsnummer weiter; daraus ergeben sich die Download-Adressen. Diese Seiten sind nicht so begrenzt.
 */
async function latestViaRedirect(): Promise<{ tag_name: string; body: string; assets: { name: string; browser_download_url: string }[] }> {
  const base = RELEASES_URL.replace('https://api.github.com/repos/', 'https://github.com/').replace(/\/latest$/, '');
  const res = await fetch(`${base}/latest`, { headers: { 'User-Agent': 'pms-updater' }, signal: AbortSignal.timeout(30_000), redirect: 'manual' });
  const tag = /\/releases\/tag\/([^/?#]+)$/.exec(res.headers.get('location') ?? '')?.[1];
  await res.arrayBuffer().catch(() => {});
  if (!tag || !/^v?\d+\.\d+\.\d+$/.test(decodeURIComponent(tag))) throw new Error(`Antwort ${res.status} von github.com`);
  const dl = (name: string) => ({ name, browser_download_url: `${base}/download/${tag}/${name}` });
  return { tag_name: decodeURIComponent(tag), body: '', assets: [dl(ASSET), dl(`${ASSET}.sha256`)] };
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!ctx) return status;
  try {
    let data: { tag_name?: string; body?: string; assets?: { name: string; browser_download_url: string }[] };
    try { data = (await (await get(process.env.PMS_UPDATE_URL || RELEASES_URL)).json()) as typeof data; }
    catch (e) {
      // Schnittstelle begrenzt oder gesperrt: über die normale GitHub-Seite weiter (nicht im Testbetrieb mit eigener Adresse)
      if (process.env.PMS_UPDATE_URL || !/Antwort (403|429)/.test(e instanceof Error ? e.message : '')) throw e;
      data = await latestViaRedirect();
    }
    const zip = data.assets?.find((a) => a.name === ASSET);
    if (!data.tag_name || !zip) throw new Error('Die Veröffentlichung enthält kein Programmpaket');
    release = { version: data.tag_name.replace(/^v/, ''), zipUrl: zip.browser_download_url, shaUrl: data.assets?.find((a) => a.name === `${ASSET}.sha256`)?.browser_download_url ?? null, notes: (data.body ?? '').slice(0, 2000) };
    status = { ...status, latest: release.version, available: isNewer(release.version, ctx.version), checkedAt: new Date().toISOString(), error: null, notes: release.notes };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    status = { ...status, checkedAt: new Date().toISOString(), error: /fetch failed|ENOTFOUND|EAI_AGAIN|timeout|aborted/i.test(msg) ? 'Keine Verbindung zum Update-Server (Internet erreichbar?)'
      : /Antwort (403|429)/.test(msg) ? `GitHub hat die Abfrage vorübergehend begrenzt (${msg}). Bitte in einer Stunde erneut versuchen.` : msg };
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

/**
 * Update anstoßen: prüft, ob eine neuere Version da ist, und startet Download, Prüfung, Sicherung und Neustart im Hintergrund.
 * Antwortet sofort; den Fortschritt zeigt getUpdateStatus().progress, einen Fehler installError.
 */
export async function installUpdate(): Promise<{ version: string }> {
  if (!ctx) throw new AppError(409, 'update_unsupported', 'Das automatische Update gibt es nur in der Windows-Version (pms.exe)');
  if (status.installing) throw new AppError(409, 'update_running', 'Das Update läuft bereits');
  await checkForUpdate();
  if (status.error) throw new AppError(502, 'update_check', `Update-Prüfung fehlgeschlagen: ${status.error}`);
  if (!release || !status.available) throw new AppError(409, 'update_none', 'Es ist keine neuere Version verfügbar');
  const rel = release;
  status = { ...status, installing: true, installError: null, progress: { step: 'download', received: 0, total: null, attempt: 1 } };
  void runInstall(ctx, rel).catch(() => { /* Fehler steht in status.installError */ });
  return { version: rel.version };
}

async function runInstall(c: Ctx, rel: Release) {
  const { home } = c;
  const dir = join(home, 'update');
  const log = (m: string) => appendFileSync(join(dir, 'update.log'), `${new Date().toISOString()} ${m}\n`);
  const step = (p: Partial<NonNullable<UpdateStatus['progress']>>) => { status = { ...status, progress: { ...(status.progress ?? { step: 'download', received: 0, total: null, attempt: 1 }), ...p } }; };
  try {
    mkdirSync(dir, { recursive: true });
    log(`Update von ${c.version} auf ${rel.version}`);
    // Teil-Download einer anderen Version verwerfen, sonst dort weitermachen
    const zipFile = join(dir, 'download.zip'), marker = join(dir, 'download.version');
    if (!existsSync(marker) || readFileSync(marker, 'utf8') !== rel.version) { rmSync(zipFile, { force: true }); writeFileSync(marker, rel.version); }
    let lastLog = 0;
    await downloadFile(rel.zipUrl, zipFile, (received, total, attempt) => {
      step({ step: 'download', received, total, attempt });
      if (attempt > 1 && Date.now() - lastLog > 10_000) { lastLog = Date.now(); log(`Download, Versuch ${attempt}: ${Math.round(received / 1e6)} MB`); }
    });
    step({ step: 'verify' });
    const sha = await sha256File(zipFile);
    if (!rel.shaUrl) throw new Error('Zur Veröffentlichung fehlt die Prüfsumme – Update abgebrochen');
    const expected = (await (await get(rel.shaUrl)).text()).trim().split(/\s+/)[0]!.toLowerCase();
    if (expected !== sha) { rmSync(zipFile, { force: true }); throw new Error('Die Prüfsumme der heruntergeladenen Datei stimmt nicht – Update abgebrochen. Bitte erneut versuchen.'); }
    step({ step: 'unpack' });
    const target = join(dir, 'new');
    rmSync(target, { recursive: true, force: true });
    if (win) execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${zipFile.replace(/'/g, "''")}' -DestinationPath '${target.replace(/'/g, "''")}' -Force`], { windowsHide: true, stdio: 'ignore' });
    else execFileSync('unzip', ['-q', zipFile, '-d', target], { stdio: 'ignore' });
    rmSync(zipFile, { force: true }); rmSync(marker, { force: true });

    // Paket prüfen: enthält Programm und Versionsangabe, passt zur Datenbank
    const exeName = win ? 'pms.exe' : 'pms';
    const source = [target, join(target, 'SchuetzenhausPMS')].find((d) => existsSync(join(d, exeName)) && existsSync(join(d, 'app', 'version.json')));
    if (!source) throw new Error('Das heruntergeladene Paket ist unvollständig');
    const info = JSON.parse(readFileSync(join(source, 'app', 'version.json'), 'utf8')) as { version: string; pgMajor: string };
    if (info.version !== rel.version) throw new Error(`Das Paket enthält Version ${info.version} statt ${rel.version}`);
    if (info.pgMajor !== c.pgMajor)
      throw new Error(`Die neue Version bringt eine andere Datenbank-Hauptversion mit (${info.pgMajor} statt ${c.pgMajor}). Dieses Update muss von Hand eingespielt werden – siehe README.`);

    step({ step: 'backup' });
    c.backup();
    log('Datensicherung geschrieben');
    step({ step: 'restart' });
    const script = writeApplyScript(home, source);
    spawn(script.cmd, script.args, { detached: true, stdio: 'ignore', windowsHide: true, cwd: home }).unref();
    log('Hilfsskript gestartet, PMS wird beendet');
    setTimeout(() => void c.shutdown(), 1500);
  } catch (e) {
    const msg = updateErrorText(e);
    status = { ...status, installing: false, progress: null, installError: msg };
    try { log(`FEHLER: ${e instanceof Error ? e.message : String(e)}`); } catch { /* Ordner nicht beschreibbar */ }
  }
}
