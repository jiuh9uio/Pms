// Datensicherung: npm run backup
// Schreibt eine vollständige Sicherung der Datenbank nach ./backups (oder BACKUP_DIR) und löscht alte Stände.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

if (existsSync('.env')) process.loadEnvFile('.env');
const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL fehlt');
const dir = process.env.BACKUP_DIR || 'backups';
const keep = Number(process.env.BACKUP_KEEP) || 30;
mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const file = join(dir, `pms-${stamp}.dump`);
execFileSync('pg_dump', ['--format=custom', '--no-owner', `--dbname=${url}`, `--file=${file}`], { stdio: 'inherit' });
// Sicherung prüfen: Inhaltsverzeichnis muss lesbar sein
execFileSync('pg_restore', ['--list', file], { stdio: 'ignore' });
console.log(`Sicherung geschrieben: ${file} (${Math.round(statSync(file).size / 1024)} kB)`);

const old = readdirSync(dir).filter((f) => /^pms-\d{8}-\d{6}\.dump$/.test(f)).sort().slice(0, -keep);
for (const f of old) unlinkSync(join(dir, f));
if (old.length) console.log(`${old.length} alte Sicherung(en) entfernt (es bleiben die letzten ${keep}).`);
