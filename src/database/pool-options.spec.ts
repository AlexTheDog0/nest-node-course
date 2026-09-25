import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validate } from '../config/env.schema.js';
import { poolOptions } from './pool-options.js';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'pool-options-')); });
afterEach(async () => { vi.unstubAllGlobals(); await rm(directory, { recursive: true }); });

describe('password providers', () => {
  it('rereads a rotated password file for each connection', async () => {
    const file = join(directory, 'password');
    await writeFile(file, 'first\r\n');
    const options = poolOptions(validate({ PORT: 9999, DB_HOST: 'localhost',
      DB_USER: 'app', DB_NAME: 'marketplace', DB_PASSWORD_FILE: file }));
    const password = options.password as () => Promise<string>;
    expect(await password()).toBe('first');
    await writeFile(file, 'second\n');
    expect(await password()).toBe('second');
  });

  async function infisicalOptions() {
    const token = join(directory, 'token');
    await writeFile(token, 'private-token\n');
    return poolOptions(validate({ PORT: 9999, CONFIG_SOURCE: 'infisical',
      DB_URL: 'postgresql://app:initial@127.0.0.1:5433/marketplace',
      INFISICAL_API_URL: 'http://localhost:8088', INFISICAL_PROJECT_ID: 'test-project',
      INFISICAL_ENVIRONMENT: 'prod', INFISICAL_TOKEN_FILE: token }));
  }

  it('uses rotated Infisical credentials instead of a password cached at startup', async () => {
    let secret = 'postgresql://app:first@127.0.0.1:5433/marketplace';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ secret: { secretValue: secret } })));
    const options = await infisicalOptions();
    expect(options).toMatchObject({ host: '127.0.0.1', port: 5433, user: 'app', database: 'marketplace' });
    const password = options.password as () => Promise<string>;
    expect(await password()).toBe('first');
    secret = 'postgresql://app:rotated%40password@127.0.0.1:5433/marketplace';
    expect(await password()).toBe('rotated@password');
  });

  it('fails closed on rejected access without exposing the response or cached password', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private-token', { status: 403 })));
    const options = await infisicalOptions();
    await expect((options.password as () => Promise<string>)()).rejects.toThrow('HTTP 403');
  });

  it('does not silently switch targets after an Infisical DB_URL edit', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ secret: {
      secretValue: 'postgresql://app:password@other-host:5433/marketplace',
    } })));
    const options = await infisicalOptions();
    await expect((options.password as () => Promise<string>)()).rejects.toThrow('target changed');
  });

  it('redacts malformed Infisical response bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private-token')));
    const options = await infisicalOptions();
    await expect((options.password as () => Promise<string>)()).rejects.toThrow('Invalid Infisical response');
  });
});
