import { existsSync } from 'node:fs';
import { buildApp } from './app.js';
import { startBreakfastScheduler } from './modules/breakfast.js';
import { startInboxScheduler } from './modules/inbox.js';
import { startPrearrivalScheduler } from './modules/prearrival.js';
import { startRecurringScheduler } from './modules/team.js';
import { startOutageMonitor } from './modules/network.js';
import { loadConfig } from './config.js';
import { connect, runMigrations } from './db/client.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const { db, close } = connect(config.databaseUrl);
await runMigrations(db);

const app = await buildApp({ db, cookieSecure: config.cookieSecure, webDir: config.webDir, logger: true });
await app.listen({ host: config.host, port: config.port });
startOutageMonitor(db);
startBreakfastScheduler(db);
startInboxScheduler(db);
startPrearrivalScheduler(db);
startRecurringScheduler(db);
console.log(`Schützenhaus PMS läuft auf http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await close();
    process.exit(0);
  });
}
