import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

test('signed tokens reject forgery, expiry and malformed credentials', async () => {
  const { signToken, verifyToken } =
    await import('../../dist/orders/order-token.js');
  const key = randomBytes(32);
  const token = signToken('42', key, 1000);
  assert.equal(verifyToken(token, key, 999).userId, '42');
  assert.throws(() => verifyToken(token, key, 1000));
  assert.throws(() => verifyToken(token, randomBytes(32), 999));
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(
    JSON.stringify({ userId: '43', expiresAt: 1000 }),
  ).toString('base64url');
  assert.throws(() => verifyToken(`${forged}.${signature}`, key, 999));
  for (const value of [
    undefined,
    '',
    '42',
    `${payload}.bad`,
    `${token}.extra`,
  ]) {
    assert.throws(() => verifyToken(value, key, 999));
  }
});

test('event history replays only newer events for the requested order, then streams live', async () => {
  const { OrderEventsService } =
    await import('../../dist/orders/order-events.service.js');
  const events = new OrderEventsService();
  for (const status of ['paid', 'shipped', 'paid', 'shipped'])
    events.publish('1', status);
  events.publish('2', 'paid');
  const received = [];
  const subscription = events
    .stream('1', 3)
    .subscribe((event) => received.push(event));
  events.publish('2', 'shipped');
  events.publish('1', 'cancelled');
  subscription.unsubscribe();
  events.publish('1', 'paid');
  assert.deepEqual(
    received.map((event) => event.id),
    [4, 7],
  );
  assert.deepEqual(
    received.map((event) => event.status),
    ['shipped', 'cancelled'],
  );
});

test('history is bounded and a fresh subscription receives live events only', async () => {
  const { OrderEventsService } =
    await import('../../dist/orders/order-events.service.js');
  const events = new OrderEventsService();
  for (let i = 0; i < 1100; i++) events.publish('1', 'paid');
  const replay = [];
  const old = events.stream('1', 0).subscribe((event) => replay.push(event.id));
  old.unsubscribe();
  assert.equal(replay.length, 1000);
  assert.equal(replay[0], 101);
  const live = [];
  const subscription = events
    .stream('1')
    .subscribe((event) => live.push(event.id));
  assert.deepEqual(live, []);
  events.publish('1', 'shipped');
  assert.deepEqual(live, [1101]);
  subscription.unsubscribe();
});

test('a publication triggered during replay is delivered once after the history in ID order', async () => {
  const { OrderEventsService } =
    await import('../../dist/orders/order-events.service.js');
  const events = new OrderEventsService();
  events.publish('1', 'paid');
  events.publish('1', 'shipped');
  const ids = [];
  const subscription = events.stream('1', 0).subscribe((event) => {
    ids.push(event.id);
    if (event.id === 1) events.publish('1', 'cancelled');
  });
  subscription.unsubscribe();
  assert.deepEqual(ids, [1, 2, 3]);
});

test('disconnect during ownership lookup does not open an SSE stream or write to the closed response', async () => {
  const { EventEmitter } = await import('node:events');
  const { OrdersController } =
    await import('../../dist/orders/orders.controller.js');
  const { OrdersService } = await import('../../dist/orders/orders.service.js');
  const { OrderEventsService } =
    await import('../../dist/orders/order-events.service.js');
  const { OrderAuthService } =
    await import('../../dist/orders/order-auth.service.js');
  const { ConfigService } = await import('@nestjs/config');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { signToken } = await import('../../dist/orders/order-token.js');
  const directory = await mkdtemp(join(tmpdir(), 'hw18-disconnect-'));
  const key = randomBytes(32);
  const keyPath = join(directory, 'key');
  await writeFile(keyPath, key);
  let release;
  const lookup = new Promise((resolve) => {
    release = resolve;
  });
  const events = new OrderEventsService();
  const orders = new OrdersService({ query: () => lookup }, events);
  const auth = new OrderAuthService(
    new ConfigService({ REALTIME_TOKEN_SECRET_FILE: keyPath }),
  );
  const controller = new OrdersController(orders, events, auth);
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    status() {
      assert.fail('Disconnected response must not start streaming');
    },
  });
  try {
    const request = controller.stream(
      '1',
      `Bearer ${signToken('1', key, Date.now() + 10000)}`,
      undefined,
      response,
    );
    response.destroyed = true;
    response.emit('close');
    release({ rows: [{ id: '1', user_id: '1', status: 'paid' }] });
    await request;
    events.publish('1', 'shipped');
  } finally {
    events.onModuleDestroy();
    await rm(directory, { recursive: true, force: true });
  }
});
