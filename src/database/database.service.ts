import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema.js';
import { Pool } from 'pg'
import { readFile } from 'node:fs/promises';

@Injectable()
export class DatabaseService {
  private readonly pool: Pool;
  private readonly logger = new Logger(DatabaseService.name);

  constructor(private readonly config: ConfigService<Env, true>) {
    this.pool = new Pool({
      host: this.config.get('DB_HOST', { infer: true }),
      port: this.config.get('DB_PORT', { infer: true }),
      user: this.config.get('DB_USER', { infer: true }),
      database: this.config.get('DB_NAME', { infer: true }),
      password: async () => {
        const passwordFile = this.config.get('DB_PASSWORD_FILE', {
          infer: true,
        });
        let pass = await readFile(passwordFile, 'utf8');
        if (pass.endsWith('\n')) pass = pass.slice(0, pass.length - 1);
        if (pass.endsWith('\r')) pass = pass.slice(0, pass.length - 1);
        return pass;
      },
    });

    this.pool.on('error', (error) => {
      this.logger.error(error.message);
    });
  }

  async checkConnection() {
    await this.pool.query('SELECT 1');
  }
}