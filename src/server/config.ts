export interface Config { databaseUrl: string; host: string; port: number; cookieSecure: boolean; webDir: string | null }

export function loadConfig(env = process.env): Config {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL fehlt (siehe .env.example)');
  return {
    databaseUrl,
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT) || 3000,
    cookieSecure: env.COOKIE_SECURE === 'true',
    webDir: env.WEB_DIR ?? null,
  };
}
