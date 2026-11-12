import { fileURLToPath } from 'node:url';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Db = PostgresJsDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Verbindung oder laufende Transaktion */
export type Exec = Db | Tx;

export function connect(url: string, max = 10) {
  const sql = postgres(url, { max, onnotice: () => {} });
  const db: Db = drizzle(sql, { schema });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}

/** Spielt ausstehende Migrationen ein (beim Start des Servers). */
export async function runMigrations(db: Db, dir?: string) {
  await migrate(db, { migrationsFolder: dir ?? fileURLToPath(new URL('../../../migrations', import.meta.url)) });
}
