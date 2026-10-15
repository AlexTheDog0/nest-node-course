import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { dataSource } from '../../dist/data-source.js';
import { createFixture } from '../../dist/demos/fixture.js';
import { checkout } from '../../dist/transactions/checkout.js';
import { orderPlaced } from '../../dist/messaging/event.js';
import { recordReceipt } from '../../dist/messaging/effect.js';

test('checkout publishes after commit, rollback emits nothing, receipts survive a new connection pool', async () => {
  await dataSource.initialize();
  await dataSource.runMigrations();
  const fixture = await createFixture(dataSource, 1);
  const input = { ...fixture, quantity: 1 };
  let published;
  const publisher = { async publish(event) {
    const [order] = await dataSource.query('SELECT id FROM orders WHERE id=$1', [event.data.orderId]);
    assert.equal(order.id, event.data.orderId);
    published = event;
  } };
  try {
    const id = await checkout(dataSource, input, publisher);
    assert.equal(published.eventId, `order.placed:${id}`);
    assert.equal(await recordReceipt(dataSource, published), true);
    const fresh = new DataSource({ ...dataSource.options, migrations: [] });
    await fresh.initialize();
    try {
      assert.equal(await recordReceipt(fresh, published), false);
      assert.equal(await recordReceipt(fresh, { ...orderPlaced(id, input), eventId: 'another-id' }), false);
    } finally { await fresh.destroy(); }
    const first = published;
    await assert.rejects(checkout(dataSource, input, publisher), /Insufficient stock/);
    assert.equal(published, first);
    const [row] = await dataSource.query('SELECT count(*)::int AS count FROM order_receipts WHERE order_id=$1', [id]);
    assert.equal(row.count, 1);
  } finally {
    await fixture.cleanup();
    await dataSource.destroy();
  }
});
