import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { readDatabaseUrl } from '../dist/config/infisical.js';
import { validate } from '../dist/config/env.schema.js';
import { poolOptions } from '../dist/database/pool-options.js';
import { apiUrl, directory, readState } from './infisical-api.mjs';

const client = await readState('client.json');
assert(client, 'Run infisical:setup first');
const tokenFile = fileURLToPath(new URL('app-token', directory));
const token = (await readFile(tokenFile, 'utf8')).trim();
const children = [];
const outcomes = [];

async function health(port) {
  const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(10000) });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'ok');
  return result;
}

try {
  for (const [index, environment] of ['dev', 'prod'].entries()) {
    const connection = { ...client, environment, tokenFile };
    const dbUrl = await readDatabaseUrl(connection);
    const pool = new Pool(poolOptions(validate({
      PORT: 19991 + index, CONFIG_SOURCE: 'infisical', DB_URL: dbUrl,
      INFISICAL_API_URL: client.apiUrl, INFISICAL_PROJECT_ID: client.projectId,
      INFISICAL_ENVIRONMENT: environment, INFISICAL_TOKEN_FILE: tokenFile,
    })));
    try {
      const result = await pool.query('SELECT current_database() AS db, (SELECT count(*) FROM orders)::int AS orders, (SELECT count(*) FROM products)::int AS products');
      assert.equal(result.rows[0].db, 'marketplace');
      assert(result.rows[0].orders >= 100000 && result.rows[0].products >= 100000);
    } finally { await pool.end(); }

    const port = 19991 + index;
    const child = spawn(process.execPath, ['scripts/start-infisical.mjs', environment], {
      env: { ...process.env, PORT: String(port), DB_HOST: 'must-not-be-used.invalid' },
      stdio: 'ignore',
    });
    children.push(child);
    let before;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (child.exitCode !== null) throw new Error(`Application ${environment} exited before health check`);
      try { before = await health(port); break; } catch { await delay(250); }
    }
    assert(before, `${environment} health never became ready`);
    outcomes.push({ environment, port, before });

    const denied = await fetch(new URL('/api/v4/secrets/DB_URL', apiUrl), {
      method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: client.projectId, environment, secretPath: '/', secretValue: dbUrl }),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(denied.status, 403, 'Application identity must not be able to edit secrets');
  }
  const rotation = spawn(process.execPath, ['scripts/rotate-infisical.mjs'], { stdio: 'inherit' });
  const code = await new Promise((resolve, reject) => { rotation.on('exit', resolve); rotation.on('error', reject); });
  assert.equal(code, 0, 'Password rotation failed');
  for (const outcome of outcomes) {
    const after = await health(outcome.port);
    assert(after.uptime > outcome.before.uptime, 'Application restarted during rotation');
    outcome.after = after;
  }
  await mkdir('tmp', { recursive: true });
  await writeFile('tmp/infisical-verification.json', JSON.stringify(outcomes, null, 2) + '\n');
  console.log('PASS: dev/prod read DB_URL from Infisical; populated HW12 database reached; app write access denied; health survives rotation without restart.');
} finally {
  await Promise.all(children.map(child => new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill('SIGTERM');
  })));
}
