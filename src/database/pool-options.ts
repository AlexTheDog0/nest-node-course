import { readFile } from 'node:fs/promises';
import type { PoolConfig } from 'pg';
import type { Env } from '../config/env.schema.js';
import { readDatabaseUrl } from '../config/infisical.js';

export function poolOptions(config: Env): PoolConfig {
  if (config.CONFIG_SOURCE === 'environment') {
    return {
      connectionString: config.DATABASE_URL,
      connectionTimeoutMillis: 10000,
    };
  }
  if (config.CONFIG_SOURCE === 'infisical') {
    const initial = new URL(config.DB_URL!);
    return {
      host: initial.hostname,
      port: Number(initial.port || 5432),
      user: decodeURIComponent(initial.username),
      database: decodeURIComponent(initial.pathname.slice(1)),
      password: async () => {
        const current = new URL(
          await readDatabaseUrl({
            apiUrl: config.INFISICAL_API_URL!,
            projectId: config.INFISICAL_PROJECT_ID!,
            environment: config.INFISICAL_ENVIRONMENT!,
            tokenFile: config.INFISICAL_TOKEN_FILE!,
          }),
        );
        if (
          current.hostname !== initial.hostname ||
          current.port !== initial.port ||
          current.username !== initial.username ||
          current.pathname !== initial.pathname
        ) {
          throw new Error(
            'DB_URL target changed; restart the application to switch databases',
          );
        }
        return decodeURIComponent(current.password);
      },
      connectionTimeoutMillis: 10000,
    };
  }
  return {
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    database: config.DB_NAME,
    password: async () =>
      (await readFile(config.DB_PASSWORD_FILE!, 'utf8')).replace(/\r?\n$/, ''),
  };
}
