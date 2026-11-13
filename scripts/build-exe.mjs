// Baut die Windows-Version: release/SchuetzenhausPMS/ mit pms.exe, Oberfläche, Datenbankschema und PostgreSQL-Programmen.
// Aufruf (nach "npm run build"):  node scripts/build-exe.mjs [Pfad-zu-PostgreSQL]
// Der PostgreSQL-Pfad ist der Installationsordner mit bin/, lib/ und share/. Ohne Angabe: Umgebungsvariable PGROOT.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';

const win = process.platform === 'win32';
const out = join('release', 'SchuetzenhausPMS');
const tmp = join('release', 'tmp');
const pgRoot = process.argv[2] ?? process.env.PGROOT;
if (!existsSync(join('dist', 'web', 'index.html'))) throw new Error('Bitte zuerst "npm run build" ausführen');
if (!pgRoot || !existsSync(join(pgRoot, 'bin'))) throw new Error('PostgreSQL-Ordner nicht gefunden (Argument oder PGROOT)');

rmSync('release', { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });
mkdirSync(join(out, 'app'), { recursive: true });

// 1) Server zu einer einzigen Datei bündeln
const bundle = join(tmp, 'pms.cjs');
await build({
  entryPoints: ['src/server/portable.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', outfile: bundle,
  define: { 'import.meta.url': '__pmsFileUrl' },
  banner: { js: "const __pmsFileUrl = require('node:url').pathToFileURL(__filename).href;" },
  logLevel: 'warning',
});

// 2) Mit der Node-Laufzeit zu einer ausführbaren Datei verbinden (Node "Single Executable Application")
const seaConfig = join(tmp, 'sea.json');
const blob = join(tmp, 'pms.blob');
writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });
const target = join(out, win ? 'pms.exe' : 'pms');
copyFileSync(process.execPath, target);
const postject = join('node_modules', 'postject', 'dist', 'cli.js');
execFileSync(process.execPath, [postject, target, 'NODE_SEA_BLOB', blob, '--sentinel-fuse', 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2', '--overwrite'], { stdio: 'inherit' });

// 3) Oberfläche, Datenbankschema, PostgreSQL
cpSync(join('dist', 'web'), join(out, 'app', 'web'), { recursive: true });
cpSync('migrations', join(out, 'app', 'migrations'), { recursive: true });
cpSync('assets', join(out, 'app', 'assets'), { recursive: true });
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const pgVersion = execFileSync(join(pgRoot, 'bin', win ? 'postgres.exe' : 'postgres'), ['--version']).toString();
const pgMajor = /(\d+)\./.exec(pgVersion)?.[1] ?? '';
writeFileSync(join(out, 'app', 'version.json'), JSON.stringify({ version: pkg.version, pgMajor, builtAt: new Date().toISOString() }));
console.log(`Version ${pkg.version}, PostgreSQL ${pgMajor}`);
for (const d of ['bin', 'lib', 'share']) cpSync(join(pgRoot, d), join(out, 'pgsql', d), { recursive: true, dereference: true });
for (const d of [['share', 'doc'], ['share', 'man'], ['share', 'locale']]) rmSync(join(out, 'pgsql', ...d), { recursive: true, force: true });

// 4) Hilfsdateien für Windows
const crlf = (s) => s.replace(/\n/g, '\r\n');
writeFileSync(join(out, 'Sicherung.bat'), crlf('@echo off\ncd /d "%~dp0"\npms.exe --backup\npause\n'));
writeFileSync(join(out, 'Autostart einrichten.bat'), crlf(
  '@echo off\nrem Startet das PMS bei jeder Anmeldung an Windows und sichert taeglich um 02:00 Uhr.\n' +
  'schtasks /Create /F /TN "PMS Start" /SC ONLOGON /TR "\\"%~dp0pms.exe\\" --no-browser"\n' +
  'schtasks /Create /F /TN "PMS Sicherung" /SC DAILY /ST 02:00 /TR "\\"%~dp0pms.exe\\" --backup"\npause\n'));
writeFileSync(join(out, 'pms.env'), crlf(
  '# Einstellungen fuer das Schuetzenhaus PMS (Zeilen mit # sind Kommentare)\n' +
  '# Port, unter dem das PMS im Browser erreichbar ist\nPORT=3000\n' +
  '# 0.0.0.0 = von allen Geraeten im Hausnetz erreichbar, 127.0.0.1 = nur von diesem Rechner\nHOST=0.0.0.0\n' +
  '# Jede Datensicherung zusaetzlich in diesen Ordner kopieren (USB-Festplatte, Netzlaufwerk); # am Zeilenanfang entfernen\n#BACKUP_COPY_DIR=E:\\PMS-Sicherung\n'));
writeFileSync(join(out, 'LIES MICH.txt'), crlf(`Schützenhaus PMS – Windows-Version

Starten:    pms.exe doppelt anklicken. Beim ersten Start wird die Datenbank eingerichtet (dauert einen Moment),
            dann öffnet sich der Browser. Das schwarze Fenster muss geöffnet bleiben, solange das PMS laufen soll.
            Fragt die Windows-Firewall nach, den Zugriff für "Private Netzwerke" erlauben, damit andere Geräte
            im Haus das PMS unter http://<Name-dieses-Rechners>:3000 erreichen.
Beenden:    Das schwarze Fenster schließen oder Strg+C drücken.
Sicherung:  Läuft das PMS, sichert es einmal täglich von selbst (Stand: Einstellungen → Datensicherung).
            Für eine Kopie auf USB-Festplatte oder Netzlaufwerk in pms.env BACKUP_COPY_DIR eintragen.
            Von Hand: "Sicherung.bat" doppelt anklicken. Die Sicherungen liegen im Ordner "backups" – diesen Ordner
            regelmäßig auf einen zweiten Datenträger (USB-Platte, NAS) kopieren.
Update:     Im PMS unter Verwaltung - Einstellungen - "Programm-Update". Das Programm sichert die Daten, lädt die neue
            Version herunter, tauscht die Programmdateien aus und startet neu. Die bisherigen Programmdateien liegen
            danach im Ordner "update\\previous", das Protokoll in "update\\update.log".
Autostart:  "Autostart einrichten.bat" ausführen: PMS startet bei jeder Windows-Anmeldung, Sicherung täglich 02:00 Uhr.
Zurückspielen einer Sicherung (ersetzt alle Daten!), in einer Eingabeaufforderung in diesem Ordner, PMS vorher beenden:
            pms.exe --restore backups\\pms-JJJJMMTT-HHMMSS.dump --ja

Alle Daten liegen im Ordner "data". Diesen Ordner nicht löschen. Darin liegt auch die Datei "secret.key" (Schlüssel für das
gespeicherte E-Mail-Passwort) – zusammen mit dem Ordner "backups" mitsichern. Für ein Update den neuen Programmordner
entpacken und die Ordner "data" und "backups" sowie die Datei "pms.env" aus dem alten Ordner hineinkopieren.

Der Zugriff im Hausnetz ist unverschlüsselt (HTTP). Den Port nicht ins Internet freigeben.
`));
rmSync(tmp, { recursive: true, force: true });
console.log(`Fertig: ${out}`);
