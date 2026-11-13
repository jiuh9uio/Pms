/**
 * Startpunkt der Windows-Version (pms.exe): bringt die Datenbank mit.
 *
 * Ordneraufbau neben der pms.exe:
 *   app/web, app/migrations   Oberfläche und Datenbankschema
 *   pgsql/                    PostgreSQL-Programme (bin, lib, share)
 *   data/                     Datenbank und Datenbank-Passwort (entsteht beim ersten Start)
 *   backups/                  Datensicherungen
 *   pms.env                   optionale Einstellungen (PORT, HOST, COOKIE_SECURE)
 *
 * Aufrufe:  pms.exe                      PMS starten
 *           pms.exe --no-browser         starten, ohne den Browser zu öffnen (Autostart)
 *           pms.exe --backup             Datensicherung schreiben
 *           pms.exe --reset-password [Benutzername]   neues Zufallspasswort (Passwort vergessen)
 *           pms.exe --restore DATEI --ja Sicherung zurückspielen (PMS muss beendet sein)
 */
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import postgres from 'postgres';
import { buildApp } from './app.js';
import { startOutageMonitor } from './modules/network.js';
import { connect, runMigrations } from './db/client.js';
import { setAssetsDir } from './einvoice/pdf.js';
import { initBackup } from './backup.js';
import { emergencyReset } from './modules/users.js';
import { initUpdater } from './update.js';

const args = process.argv.slice(2);
const home = resolve(process.env.PMS_HOME ?? dirname(process.execPath));
const exe = (name: string) => join(home, 'pgsql', 'bin', process.platform === 'win32' ? `${name}.exe` : name);
const dataDir = join(home, 'data');
const pgData = join(dataDir, 'postgres');
const pwFile = join(dataDir, 'db-password.txt');
const backupDir = join(home, 'backups');

function fail(message: string): never {
  console.error('\nFEHLER: ' + message);
  // Fenster bei Doppelklick nicht sofort schließen
  if (process.platform === 'win32' && process.stdin.isTTY) {
    console.error('\nDieses Fenster schließt sich in 60 Sekunden.');
    execFileSync('cmd', ['/c', 'timeout /t 60 >nul'], { stdio: 'ignore' });
  }
  process.exit(1);
}

/**
 * Führt ein PostgreSQL-Programm aus. Die Ausgabe wird bewusst nicht per Pipe eingelesen, sondern in eine Datei
 * geschrieben: Unter Windows erbt der gestartete Datenbankserver sonst die Pipe, und "pg_ctl start" kehrt nie zurück.
 */
function run(name: string, a: string[]) {
  return new Promise<void>((ok, bad) => {
    const log = join(dataDir, 'tools.log');
    const fd = openSync(log, 'a');
    const child = spawn(exe(name), a, { stdio: ['ignore', fd, fd], windowsHide: true });
    child.on('error', (e) => { closeSync(fd); bad(e); });
    child.on('exit', (code) => {
      closeSync(fd);
      if (code === 0) ok();
      else bad(new Error(`${name} endete mit Fehler ${code}. Einzelheiten: ${log}`));
    });
  });
}

/** Startet die mitgelieferte Datenbank (beim ersten Mal wird sie eingerichtet) und liefert die Verbindungsadresse. */
async function startDatabase() {
  if (!existsSync(exe('postgres'))) fail(`Die Datenbank-Programme fehlen (${join(home, 'pgsql')}). Bitte den Ordner vollständig entpacken.`);
  const port = Number(process.env.PMS_DB_PORT) || 54329;
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(pwFile)) writeFileSync(pwFile, randomBytes(24).toString('hex'), { mode: 0o600 });
  const password = readFileSync(pwFile, 'utf8').trim();

  if (!existsSync(join(pgData, 'PG_VERSION'))) {
    console.log('Erster Start: Datenbank wird eingerichtet …');
    await run('initdb', ['-D', pgData, '-U', 'pms', '-A', 'scram-sha-256', `--pwfile=${pwFile}`, '-E', 'UTF8', '--locale=C']);
  }
  const ready = () => run('pg_isready', ['-h', '127.0.0.1', '-p', String(port)]).then(() => true, () => false);
  let started = false;
  if (!(await ready())) {
    await run('pg_ctl', ['start', '-D', pgData, '-w', '-t', '60', '-l', join(dataDir, 'postgres.log'), '-o', `-p ${port} -c listen_addresses=127.0.0.1`])
      .catch((e: Error) => fail(`Die Datenbank konnte nicht gestartet werden. Einzelheiten stehen in ${join(dataDir, 'postgres.log')}\n${e.message}`));
    started = true;
  }
  const base = `postgres://pms:${password}@127.0.0.1:${port}`;
  const admin = postgres(`${base}/postgres`, { max: 1, onnotice: () => {} });
  try {
    const exists = await admin`select 1 from pg_database where datname = 'pms'`;
    if (!exists.length) await admin`create database pms`;
  } finally {
    await admin.end();
  }
  return {
    url: `${base}/pms`, started,
    stop: async () => { if (started) await run('pg_ctl', ['stop', '-D', pgData, '-m', 'fast', '-w']).catch(() => {}); },
  };
}

function backup(url: string) {
  mkdirSync(backupDir, { recursive: true });
  const keep = Number(process.env.BACKUP_KEEP) || 30;
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = join(backupDir, `pms-${stamp}.dump`);
  execFileSync(exe('pg_dump'), ['--format=custom', '--no-owner', `--dbname=${url}`, `--file=${file}`], { stdio: 'inherit', windowsHide: true });
  execFileSync(exe('pg_restore'), ['--list', file], { stdio: 'ignore', windowsHide: true }); // Sicherung muss lesbar sein
  console.log(`Sicherung geschrieben: ${file} (${Math.round(statSync(file).size / 1024)} kB)`);
  const old = readdirSync(backupDir).filter((f) => /^pms-\d{8}-\d{6}\.dump$/.test(f)).sort().slice(0, -keep);
  for (const f of old) unlinkSync(join(backupDir, f));
  return file;
}

async function main() {
  if (existsSync(join(home, 'pms.env'))) process.loadEnvFile(join(home, 'pms.env'));
  process.env.PMS_DATA_DIR = dataDir; // Schlüsseldatei für das E-Mail-Passwort
  setAssetsDir(join(home, 'app', 'assets', 'einvoice'));
  const pg = await startDatabase();

  if (args.includes('--backup')) {
    try { backup(pg.url); } finally { await pg.stop(); }
    return;
  }
  if (args.includes('--reset-password')) {
    // Notfall: Passwort vergessen. Wer an diesem Rechner sitzt, darf ein neues Passwort erzeugen.
    const name = args[args.indexOf('--reset-password') + 1];
    const { db, close } = connect(pg.url);
    try {
      await runMigrations(db, join(home, 'app', 'migrations'));
      const r = await emergencyReset(db, name && !name.startsWith('--') ? name : null);
      if (r.ok) console.log(`\nNeues Passwort für „${r.name}“\n\n  Benutzername: ${r.username}\n  Passwort:     ${r.password}\n\nBitte gleich anmelden und unter „Mein Konto“ ein eigenes Passwort vergeben.`);
      else console.log(`\nBitte den Benutzernamen angeben. Vorhandene Benutzer:\n  ${r.usernames.join('\n  ') || '(noch keiner – das PMS ist noch nicht eingerichtet)'}`);
    } finally { await close(); await pg.stop(); }
    return;
  }
  if (args.includes('--restore')) {
    const file = args[args.indexOf('--restore') + 1];
    try {
      if (!file || !existsSync(file)) fail('Bitte die Sicherungsdatei angeben: pms.exe --restore backups\\pms-JJJJMMTT-HHMMSS.dump --ja');
      if (!pg.started) fail('Das PMS läuft noch. Bitte zuerst das PMS-Fenster schließen und dann erneut versuchen.');
      if (!args.includes('--ja')) fail(`Dies ersetzt ALLE Daten durch den Stand aus ${file}. Zum Bestätigen --ja anhängen.`);
      execFileSync(exe('pg_restore'), ['--clean', '--if-exists', '--no-owner', '--single-transaction', `--dbname=${pg.url}`, file], { stdio: 'inherit', windowsHide: true });
      console.log('Wiederherstellung abgeschlossen. Das PMS kann wieder gestartet werden.');
    } finally { await pg.stop(); }
    return;
  }

  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '0.0.0.0';
  const { db, close } = connect(pg.url);
  await runMigrations(db, join(home, 'app', 'migrations'));
  const app = await buildApp({ db, cookieSecure: process.env.COOKIE_SECURE === 'true', webDir: join(home, 'app', 'web'), logger: true });
  try {
    await app.listen({ host, port });
  } catch (e) {
    await close();
    await pg.stop();
    fail((e as { code?: string }).code === 'EADDRINUSE'
      ? `Port ${port} ist bereits belegt – läuft das PMS schon? Sonst in der Datei pms.env einen anderen PORT eintragen.`
      : String(e));
  }
  const url = `http://localhost:${port}`;
  console.log(`\nSchützenhaus PMS läuft: ${url}`);
  console.log('Dieses Fenster geöffnet lassen. Zum Beenden das Fenster schließen oder Strg+C drücken.\n');
  if (!args.includes('--no-browser') && process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    console.log('PMS wird beendet …');
    await app.close().catch(() => {});
    await close().catch(() => {});
    await pg.stop();
    process.exit(0);
  };
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) process.on(s, () => void shutdown());

  initBackup({ dir: backupDir, run: () => backup(pg.url) });
  startOutageMonitor(db);

  // Programm-Update: Version des Pakets und der mitgelieferten Datenbank
  const versionFile = join(home, 'app', 'version.json');
  if (existsSync(versionFile)) {
    const info = JSON.parse(readFileSync(versionFile, 'utf8')) as { version: string; pgMajor: string };
    console.log(`Version ${info.version}`);
    initUpdater({ home, version: info.version, pgMajor: info.pgMajor, backup: () => { backup(pg.url); }, shutdown });
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
