import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { dataSource as db } from '../../dist/data-source.js';
import { checkout } from '../../dist/transactions/checkout.js';
import { runWorkers } from '../../dist/transactions/workers.js';
import { createFixture } from '../../dist/demos/fixture.js';

test('failed processing rolls back and locked pending jobs are revisited', async () => {
  await db.initialize();
  const fixture = await createFixture(db, 1);
  const runner = db.createQueryRunner();
  try {
    const orderId = await checkout(db, { ...fixture, quantity: 1 });
    const scope = { orderIds: [orderId], workerCount: 1 };
    await assert.rejects(
      runWorkers(db, {
        ...scope,
        process: async () => {
          throw new Error('worker crashed');
        },
      }),
      /worker crashed/,
    );
    const read = async () =>
      (
        await db.query(
          'SELECT processed, status, result FROM jobs WHERE order_id=$1',
          [orderId],
        )
      )[0];
    assert.deepEqual(await read(), {
      processed: 0,
      status: 'pending',
      result: null,
    });
    await runner.connect();
    await runner.startTransaction();
    await runner.query('SELECT id FROM jobs WHERE order_id=$1 FOR UPDATE', [
      orderId,
    ]);
    const work = runWorkers(db, {
      ...scope,
      workerCount: 2,
      process: async () => 'receipt',
    });
    try {
      await delay(75);
    } finally {
      await runner.rollbackTransaction();
    }
    await work;
    assert.deepEqual(await read(), {
      processed: 1,
      status: 'done',
      result: 'receipt',
    });
  } finally {
    await runner.release();
    await fixture.cleanup();
    await db.destroy();
  }
});
