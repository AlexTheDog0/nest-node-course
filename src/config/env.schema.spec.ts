import { describe, expect, it } from 'vitest';
import { schema, validate } from './env.schema.js';

const infisical = {
  PORT: '9999', CONFIG_SOURCE: 'infisical',
  DB_URL: 'postgresql://app:fake@127.0.0.1:5433/marketplace',
  INFISICAL_API_URL: 'http://localhost:8088',
  INFISICAL_PROJECT_ID: 'project', INFISICAL_ENVIRONMENT: 'dev',
  INFISICAL_TOKEN_FILE: 'secrets/infisical/app-token',
};

describe('configuration sources', () => {
  it('accepts Infisical configuration without legacy DB fields', () => {
    expect(schema.safeParse(infisical).success).toBe(true);
  });
  it('requires DB_URL in Infisical mode even with legacy fields present', () => {
    expect(schema.safeParse({ ...infisical, DB_URL: undefined,
      DB_HOST: 'localhost', DB_USER: 'admin', DB_NAME: 'marketplace',
      DB_PASSWORD_FILE: 'secrets/db_password' }).success).toBe(false);
  });
  it('rejects a non-PostgreSQL URL without echoing credentials', () => {
    expect(() => validate({ ...infisical, DB_URL: 'https://app:do-not-log@host/db' }))
      .toThrow(/DB_URL/);
    try { validate({ ...infisical, DB_URL: 'https://app:do-not-log@host/db' }); }
    catch (error) { expect(String(error)).not.toContain('do-not-log'); }
  });
  it('preserves the file-based configuration and port default', () => {
    expect(validate({ PORT: '9999', DB_HOST: 'localhost', DB_USER: 'admin',
      DB_NAME: 'marketplace', DB_PASSWORD_FILE: 'secrets/db_password' }).DB_PORT).toBe(5432);
  });
});
