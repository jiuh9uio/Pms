// Wiederherstellung: npm run restore -- backups/pms-JJJJMMTT-HHMMSS.dump
// ACHTUNG: ersetzt den gesamten Inhalt der Datenbank durch den Stand der Sicherung. PMS vorher beenden.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

if (existsSync('.env')) process.loadEnvFile('.env');
const url = process.env.DATABASE_URL;
const file = process.argv[2];
if (!url) throw new Error('DATABASE_URL fehlt');
if (!file || !existsSync(file)) throw new Error('Bitte die Sicherungsdatei angeben, z. B.: npm run restore -- backups/pms-20270101-020000.dump');
if (process.argv[3] !== '--ja') {
  console.error(`Dies ersetzt ALLE Daten der Datenbank durch ${file}.\nZum Bestätigen erneut mit --ja aufrufen:\n  npm run restore -- ${file} --ja`);
  process.exit(1);
}
execFileSync('pg_restore', ['--clean', '--if-exists', '--no-owner', '--single-transaction', `--dbname=${url}`, file], { stdio: 'inherit' });
console.log('Wiederherstellung abgeschlossen. PMS jetzt wieder starten.');
