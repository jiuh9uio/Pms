// Gibt den Abschnitt einer Version aus CHANGELOG.md aus (Text der Veröffentlichung, erscheint im Programm unter „Programm-Update“).
import { readFileSync } from 'node:fs';

const version = process.argv[2];
const lines = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8').split(/\r?\n/);
const start = lines.findIndex((l) => l.startsWith('## ') && l.slice(3).trim().split(/\s/)[0] === version);
if (start < 0) { console.log(`Version ${version}`); process.exit(0); }
const rest = lines.slice(start + 1);
const end = rest.findIndex((l) => l.startsWith('## '));
console.log((end < 0 ? rest : rest.slice(0, end)).join('\n').trim());
