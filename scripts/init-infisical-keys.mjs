import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir(new URL('../secrets/infisical/', import.meta.url), { recursive: true, mode: 0o700 });
const password = randomBytes(32).toString('hex');
try {
  await writeFile(new URL('../secrets/infisical/server.env', import.meta.url), [
    `ENCRYPTION_KEY=${randomBytes(16).toString('hex')}`,
    `AUTH_SECRET=${randomBytes(32).toString('base64')}`,
    'POSTGRES_USER=infisical',
    'POSTGRES_DB=infisical',
    `POSTGRES_PASSWORD=${password}`,
    `DB_CONNECTION_URI=postgresql://infisical:${password}@postgres:5432/infisical`,
    '',
  ].join('\n'), { flag: 'wx', mode: 0o600 });
  console.log('Created ignored Infisical server keys (secrets/infisical/server.env).');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Existing Infisical keys preserved.');
}
