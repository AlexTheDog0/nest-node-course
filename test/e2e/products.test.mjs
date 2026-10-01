import { beforeAll, afterAll, beforeEach, test, expect } from '@jest/globals';
import request from 'supertest';
import { startApplication } from '../integration/testkit/application.mjs';
let context, api;
beforeAll(async () => {
  context = await startApplication();
  api = request(context.app.getHttpServer());
});
beforeEach(async () => context.database.reset());
afterAll(async () => context?.close());
test('full AppModule creates a product, persists it, then reads it over HTTP', async () => {
  const input = { name: 'Notebook', price_cents: 15000, stock: 3 };
  const created = await api
    .post('/products')
    .set('Idempotency-Key', 'e2e-create')
    .send(input)
    .expect(201);
  const read = await api.get(`/products/${created.body.id}`).expect(200);
  expect(read.body).toEqual({ id: created.body.id, ...input });
  const [stored] = await context.database.source.query(
    'SELECT name, stock FROM products WHERE id=$1',
    [created.body.id],
  );
  expect(stored).toEqual({ name: 'Notebook', stock: 3 });
  await api.get('/health').expect(200);
});
test('missing product responds 404 Problem', async () => {
  const response = await api.get('/products/999999').expect(404);
  expect(response.body).toMatchObject({
    status: 404,
    detail: 'Product was not found',
  });
});
test('invalid product responds 400 and writes nothing', async () => {
  await api
    .post('/products')
    .set('Idempotency-Key', 'invalid')
    .send({ name: 'Invalid', price_cents: 100, stock: -1 })
    .expect(400);
  expect(
    await context.database.source.query(
      'SELECT count(*)::int AS count FROM products',
    ),
  ).toEqual([{ count: 0 }]);
});
test('concurrent idempotent requests persist one product; different body returns 422', async () => {
  const input = { name: 'Pen', price_cents: 100, stock: 5 };
  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      api
        .post('/products')
        .set('Idempotency-Key', 'same')
        .send(input)
        .expect(201),
    ),
  );
  for (const response of responses)
    expect(response.body).toEqual(responses[0].body);
  expect(
    await context.database.source.query(
      'SELECT count(*)::int AS count FROM products',
    ),
  ).toEqual([{ count: 1 }]);
  await api
    .post('/products')
    .set('Idempotency-Key', 'same')
    .send({ ...input, stock: 6 })
    .expect(422);
});

test('database-incompatible input is rejected as 400 rather than 500', async () => {
  const input = { name: 'Boundary', price_cents: 1, stock: 0 };
  for (const change of [
    { name: '' },
    { name: '   ' },
    { price_cents: 0 },
    { price_cents: 2147483648 },
    { stock: 2147483648 },
  ]) {
    await api
      .post('/products')
      .set('Idempotency-Key', 'invalid-boundary')
      .send({ ...input, ...change })
      .expect(400);
  }
  await api
    .post('/products')
    .set('Idempotency-Key', 'valid-minimum')
    .send(input)
    .expect(201);
  await api
    .post('/products')
    .set('Idempotency-Key', 'valid-maximum')
    .send({ ...input, price_cents: 2147483647, stock: 2147483647 })
    .expect(201);
});
