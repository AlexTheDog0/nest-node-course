import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { ProductsModule } from '../dist/products/products.module.js';
import { ProductsService } from '../dist/products/products.service.js';
import { configureApp } from '../dist/configure-app.js';

let app, api, service;
const input = { name: 'Notebook', price_cents: 15000, stock: 3 };
before(async () => {
  app = await NestFactory.create(ProductsModule, { logger: false });
  configureApp(app);
  await app.init();
  api = request(app.getHttpServer());
  service = app.get(ProductsService);
});
after(async () => {
  await app?.close();
});
function problem(response, status) {
  assert.equal(response.status, status);
  assert.match(response.headers['content-type'], /^application\/problem\+json/);
  for (const field of ['type', 'title', 'status', 'detail', 'instance'])
    assert(field in response.body);
  assert.equal(response.body.status, status);
}
const create = (body, key) =>
  api.post('/products').set('Idempotency-Key', key).send(body);

test('missing key is rejected by OpenAPI', async () => {
  const r = await api.post('/products').send(input);
  problem(r, 400);
  assert.match(r.body.detail, /idempotency-key/);
});
test('invalid body and additional fields are rejected before creation', async () => {
  for (const body of [
    { ...input, stock: -1 },
    { ...input, id: 500 },
    { ...input, price_cents: 1.5 },
  ]) {
    problem(await create(body, 'invalid'), 400);
  }
  assert.equal(service.findPage(100, 0).items.length, 1);
});
test('valid creation, replay with reordered properties, conflict, and concurrent retries', async () => {
  const first = await create(input, 'create-1');
  assert.equal(first.status, 201);
  assert.equal(first.body.id, 2);
  const replay = await create(
    { stock: 3, name: 'Notebook', price_cents: 15000 },
    'create-1',
  );
  assert.equal(replay.status, 201);
  assert.equal(replay.headers['idempotency-replay'], 'true');
  assert.deepEqual(replay.body, first.body);
  problem(await create({ ...input, stock: 4 }, 'create-1'), 422);
  const results = await Promise.all([
    create(input, 'parallel'),
    create(input, 'parallel'),
  ]);
  assert(results.every((r) => r.status === 201));
  assert.deepEqual(results[0].body, results[1].body);
  assert.equal(service.findPage(100, 0).items.length, 3);
});
test('cursor pages have no repeats, terminate with null, and allow an empty final result', async () => {
  let cursor,
    ids = [];
  for (let i = 0; i < 4; i++) {
    let query = '/products?limit=1';
    if (cursor) query += '&cursor=' + encodeURIComponent(cursor);
    const r = await api.get(query);
    assert.equal(r.status, 200);
    assert.equal(r.body.items.length, 1);
    ids.push(r.body.items[0].id);
    cursor = r.body.next_cursor;
    if (cursor === null) break;
  }
  assert.deepEqual(ids, [1, 2, 3]);
  assert.equal(cursor, null);
  const last = Buffer.from('3').toString('base64url');
  const empty = await api.get('/products?cursor=' + last);
  assert.deepEqual(empty.body, { items: [], next_cursor: null });
});
test('invalid pagination and noncanonical cursor tokens produce Problem', async () => {
  for (const query of [
    'limit=0',
    'limit=101',
    'limit=abc',
    'cursor=aGVsbG8',
    'cursor=MQ!',
    'cursor=',
    'cursor=MA',
  ]) {
    problem(await api.get('/products?' + query), 400);
  }
});
test('single product and missing product', async () => {
  assert.equal((await api.get('/products/1')).status, 200);
  problem(await api.get('/products/999'), 404);
  problem(await api.get('/products/abc'), 400);
});
test('malformed JSON produces Problem', async () => {
  problem(
    await api
      .post('/products')
      .set('Content-Type', 'application/json')
      .send('{'),
    400,
  );
});
test('response drift is caught at runtime and original service restored', async () => {
  const original = service.findById;
  try {
    service.findById = () => ({ id: 1, name: 'Broken', stock: 1 });
    const r = await api.get('/products/1');
    problem(r, 500);
    assert.match(r.body.detail, /price_cents/);
  } finally {
    service.findById = original;
  }
  assert.equal((await api.get('/products/1')).status, 200);
});
