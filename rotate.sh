#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

# Node handles dotenv parsing, SQL quoting, and secret-file writes.
node --input-type=module <<'NODE'
import { randomBytes } from 'node:crypto';
import { readFile, open } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const configRequire = createRequire(require.resolve('@nestjs/config'));
const { parse } = configRequire('dotenv');
const env = parse(await readFile('.env'));
const user = env.DB_USER?.trim();
const passwordFile = env.DB_PASSWORD_FILE?.trim();
if (!user || !passwordFile) {
  throw new Error('DB_USER and DB_PASSWORD_FILE are required');
}

const identifier = (value) => '"' + value.replaceAll('"', '""') + '"';
const literal = (value) => "'" + value.replaceAll("'", "''") + "'";
function sql(statement) {
  const result = spawnSync('docker', [
    'compose', '-f', 'docker-compose.yml', 'exec', '-T', 'db',
    'sh', '-c',
    'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"',
  ], {
    input: 'SET standard_conforming_strings = on;\n' + statement + '\n',
    encoding: 'utf8',
  });
  // Do not print SQL errors: they can contain the password-bearing statement.
  if (result.error || result.status !== 0) {
    throw new Error('Postgres command failed; check that db is running and its administrative user is valid');
  }
}

const password = randomBytes(32).toString('hex');
// Open before ALTER ROLE so a missing/unwritable file fails without changing DB.
const file = await open(passwordFile, 'r+');
let changed = false;
let saved = false;
try {
  await file.chmod(0o600);
  sql(`ALTER ROLE ${identifier(user)} WITH PASSWORD ${literal(password)};`);
  changed = true;

  // Preserve the inode: Compose may already have this file bind-mounted.
  await file.writeFile(password + '\n', 'utf8');
  await file.truncate(Buffer.byteLength(password + '\n'));
  await file.sync();
  saved = true;

  sql(`SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
       WHERE usename = ${literal(user)}
         AND datname = current_database()
         AND backend_type = 'client backend'
         AND pid <> pg_backend_pid();`);
  console.log('Password rotated, secret file updated, old DB connections closed.');
} catch (error) {
  if (changed && !saved) {
    console.error('DB password changed but secret write failed. Repair file access and rerun rotation using the administrative connection.');
  } else if (saved) {
    console.error('Password and file updated, but closing old connections failed.');
  }
  throw error;
} finally {
  await file.close();
}
NODE
