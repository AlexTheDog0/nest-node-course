import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { signToken } from '../dist/orders/order-token.js';

// Explicit database credentials prevent an accidental write to an unrelated DB.
const connectionString = process.env.DATABASE_URL ?? process.env.DB_URL;
if (!connectionString)
  throw new Error('Set DATABASE_URL or DB_URL for the local homework database');
const keyFile =
  process.env.REALTIME_TOKEN_SECRET_FILE ?? 'secrets/realtime-token-key';
const fixtureFile =
  process.env.REALTIME_DEMO_FILE ?? 'secrets/realtime-demo.json';
await mkdir(dirname(keyFile), { recursive: true, mode: 0o700 });
await mkdir(dirname(fixtureFile), { recursive: true, mode: 0o700 });
try {
  await writeFile(keyFile, randomBytes(32), { flag: 'wx', mode: 0o600 });
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
const key = await readFile(keyFile);
if (key.length < 32)
  throw new Error('Signing key must contain at least 32 bytes');
const pool = new Pool({ connectionString });
let client;
try {
  client = await pool.connect();
  await client.query('BEGIN');
  const fixture = {};
  for (const label of ['A', 'B']) {
    const {
      rows: [user],
    } = await client.query(
      'INSERT INTO users(email,name) VALUES ($1,$2) RETURNING id',
      [`realtime-${randomUUID()}@example.test`, `Realtime ${label}`],
    );
    const {
      rows: [order],
    } = await client.query(
      'INSERT INTO orders(user_id) VALUES ($1) RETURNING id',
      [user.id],
    );
    fixture[`order${label}`] = order.id;
    fixture[`token${label}`] = signToken(
      user.id,
      key,
      Date.now() + 24 * 60 * 60 * 1000,
    );
  }
  await client.query('COMMIT');
  await writeFile(fixtureFile, JSON.stringify(fixture, null, 2) + '\n', {
    mode: 0o600,
  });
  console.log(
    `Realtime fixtures ready: A=${fixture.orderA}, B=${fixture.orderB}; credentials saved to ${fixtureFile} (24h).`,
  );
} catch (error) {
  if (client) await client.query('ROLLBACK');
  throw error;
} finally {
  client?.release();
  await pool.end();
}
