import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { startApplication } from '../integration/testkit/application.mjs';
import { signToken } from '../../dist/orders/order-token.js';

const execute = promisify(execFile);
let context, directory, base, tokenA, tokenB, orderA, orderB, io;
const sockets = [];
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'hw18-'));
  const key = randomBytes(32);
  process.env.REALTIME_TOKEN_SECRET_FILE = join(directory, 'key');
  await writeFile(process.env.REALTIME_TOKEN_SECRET_FILE, key, { mode: 0o600 });
  context = await startApplication();
  await context.app.listen(0, '127.0.0.1');
  base = await context.app.getUrl();
  const source = context.database.source;
  await source.query(
    "INSERT INTO users(id,email,name) OVERRIDING SYSTEM VALUE VALUES (1,'a@hw18.test','A'),(2,'b@hw18.test','B')",
  );
  const orders = await source.query(
    'INSERT INTO orders(user_id) VALUES (1),(2) RETURNING id',
  );
  [orderA, orderB] = orders.map((order) => order.id);
  tokenA = signToken('1', key, Date.now() + 60000);
  tokenB = signToken('2', key, Date.now() + 60000);
  ({ io } = await import('socket.io-client'));
});
after(async () => {
  sockets.forEach((socket) => socket.disconnect());
  await context?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function change(status, token = tokenA, id = orderA) {
  return fetch(`${base}/orders/${id}/status`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status }),
    signal: AbortSignal.timeout(3000),
  });
}
async function connect(token) {
  const socket = io(base, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    timeout: 2000,
  });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}
async function readEvents(response, count) {
  const reader = response.body.getReader();
  let text = '';
  try {
    while ((text.match(/^id:/gm) ?? []).length < count) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false, 'SSE ended before expected events');
      text += new TextDecoder().decode(chunk.value);
    }
    return text;
  } finally {
    await reader.cancel();
  }
}

test('HTTP denies missing/forged tokens and foreign ownership; validates inputs', async () => {
  for (const suffix of ['', '/events']) {
    assert.equal(
      (await fetch(`${base}/orders/${orderA}${suffix}`)).status,
      401,
    );
    assert.equal(
      (
        await fetch(`${base}/orders/${orderA}${suffix}`, {
          headers: { Authorization: `Bearer ${tokenB}` },
        })
      ).status,
      403,
    );
  }
  assert.equal((await change('paid', 'forged')).status, 401);
  assert.equal((await change('paid', tokenB)).status, 403);
  assert.equal((await change('invalid')).status, 400);
  assert.equal((await change('paid', tokenA, '0')).status, 400);
  assert.equal((await change('paid', tokenA, '999999')).status, 404);
});

test('WS rejects anonymous and foreign joins; emits committed status only to joined rooms', async () => {
  const anonymous = await connect(undefined);
  assert.equal(
    (await anonymous.timeout(2000).emitWithAck('join', { orderId: orderA })).ok,
    false,
  );
  const a = await connect(tokenA),
    b = await connect(tokenB);
  assert.equal(
    (await b.timeout(2000).emitWithAck('join', { orderId: orderA })).ok,
    false,
  );
  assert.equal(
    (await a.timeout(2000).emitWithAck('join', { orderId: orderA })).ok,
    true,
  );
  assert.equal(
    (await b.timeout(2000).emitWithAck('join', { orderId: orderB })).ok,
    true,
  );
  const receivedA = [],
    receivedB = [];
  a.on('order.status', (event) => receivedA.push(event));
  b.on('order.status', (event) => receivedB.push(event));
  assert.equal((await change('paid')).status, 200);
  await delay(150);
  assert.equal(receivedA.length, 1);
  assert.equal(receivedA[0].status, 'paid');
  assert.equal(receivedA[0].orderId, orderA);
  assert.equal(receivedB.length, 0);
  const [stored] = await context.database.source.query(
    'SELECT status FROM orders WHERE id=$1',
    [orderA],
  );
  assert.equal(stored.status, 'paid');
  assert.equal((await change('paid')).status, 200);
  assert.equal((await change('shipped', tokenB)).status, 403);
  await delay(150);
  assert.equal(receivedA.length, 1, 'no event for no-op or denied update');
});

test('SSE sends typed JSON events, replays IDs > 3 without duplicates, and streams subsequent changes', async () => {
  for (const status of ['shipped', 'paid', 'shipped'])
    assert.equal((await change(status)).status, 200);
  const headers = { Authorization: `Bearer ${tokenA}`, 'Last-Event-ID': '3' };
  const response = await fetch(`${base}/orders/${orderA}/events`, {
    headers,
    signal: AbortSignal.timeout(3000),
  });
  assert.match(response.headers.get('content-type'), /^text\/event-stream/);
  const body = readEvents(response, 2);
  assert.equal((await change('cancelled')).status, 200);
  const text = await body;
  assert.deepEqual(
    [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1])),
    [4, 5],
  );
  assert.match(text, /^event: order\.status$/m);
  assert.match(text, /"status":"cancelled"/);
  assert.equal(
    (
      await fetch(`${base}/orders/${orderA}/events`, {
        headers: { ...headers, 'Last-Event-ID': '-1' },
      })
    ).status,
    400,
  );
});

test('a PostgreSQL failure rolls back the status and emits no WS event', async () => {
  const source = context.database.source;
  const socket = await connect(tokenA);
  assert.equal(
    (await socket.timeout(2000).emitWithAck('join', { orderId: orderA })).ok,
    true,
  );
  const events = [];
  socket.on('order.status', (event) => events.push(event));
  await source.query(`CREATE FUNCTION hw18_fail_status() RETURNS trigger LANGUAGE plpgsql AS
    $$ BEGIN IF NEW.status = 'pending' THEN RAISE EXCEPTION 'test write failure'; END IF; RETURN NEW; END $$`);
  await source.query(
    'CREATE TRIGGER hw18_fail BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION hw18_fail_status()',
  );
  try {
    assert.equal((await change('pending')).status, 500);
    await delay(150);
    assert.equal(events.length, 0);
    const [order] = await source.query(
      'SELECT status FROM orders WHERE id=$1',
      [orderA],
    );
    assert.equal(order.status, 'cancelled');
  } finally {
    await source.query('DROP TRIGGER hw18_fail ON orders');
    await source.query('DROP FUNCTION hw18_fail_status()');
    socket.disconnect();
  }
});

test('headless demo measures both rooms with the same script and exits successfully', async () => {
  const fixture = join(directory, 'demo.json');
  await writeFile(fixture, JSON.stringify({ orderA, orderB, tokenA, tokenB }), {
    mode: 0o600,
  });
  const env = {
    ...process.env,
    REALTIME_URL: base,
    REALTIME_DEMO_FILE: fixture,
  };
  for (const [args, expected] of [
    [[], '0'],
    [['--same-room'], '1'],
  ]) {
    const { stdout } = await execute(
      process.execPath,
      ['scripts/realtime-demo.mjs', ...args],
      { env, timeout: 10000 },
    );
    assert.match(stdout, /^A_RECEIVED=1$/m);
    assert.match(stdout, new RegExp(`^B_RECEIVED=${expected}$`, 'm'));
  }
});
