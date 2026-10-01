import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { Pool } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { poolOptions } from './pool-options.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);

  constructor(private readonly config: ConfigService<Env, true>) {
    this.pool = new Pool(
      poolOptions({
        CONFIG_SOURCE: config.get('CONFIG_SOURCE', { infer: true }),
        PORT: config.get('PORT', { infer: true }),
        DB_URL: config.get('DB_URL', { infer: true }),
        DATABASE_URL: config.get('DATABASE_URL', { infer: true }),
        DB_HOST: config.get('DB_HOST', { infer: true }),
        DB_PORT: config.get('DB_PORT', { infer: true }),
        DB_USER: config.get('DB_USER', { infer: true }),
        DB_NAME: config.get('DB_NAME', { infer: true }),
        DB_PASSWORD_FILE: config.get('DB_PASSWORD_FILE', { infer: true }),
        INFISICAL_API_URL: config.get('INFISICAL_API_URL', { infer: true }),
        INFISICAL_PROJECT_ID: config.get('INFISICAL_PROJECT_ID', {
          infer: true,
        }),
        INFISICAL_ENVIRONMENT: config.get('INFISICAL_ENVIRONMENT', {
          infer: true,
        }),
        INFISICAL_TOKEN_FILE: config.get('INFISICAL_TOKEN_FILE', {
          infer: true,
        }),
      }),
    );

    this.pool.on('error', (error) => {
      this.logger.error(error.message);
    });
  }

  query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
    return this.pool.query<T>(sql, values);
  }

  async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async checkConnection() {
    await this.pool.query('SELECT 1');
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
