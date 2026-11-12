import { existsSync } from 'node:fs';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { connect, runMigrations } from './db/client.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const { db, close } = connect(config.databaseUrl);
await runMigrations(db);

const app = await buildApp({ db, cookieSecure: config.cookieSecure, webDir: config.webDir, logger: true });
await app.listen({ host: config.host, port: config.port });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await close();
    process.exit(0);
  });
}
