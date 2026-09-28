import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { dataSource } from '../data-source.js';
import { checkout } from '../transactions/checkout.js';
import { runWorkers } from '../transactions/workers.js';
import { createFixture } from './fixture.js';

await dataSource.initialize();
try {
  const count = 12;
  const duration = 100;
  const fixture = await createFixture(dataSource, count);
  try {
    const orderIds: string[] = [];
    for (let i = 0; i < count; i++)
      orderIds.push(await checkout(dataSource, { ...fixture, quantity: 1 }));
    const started = performance.now();
    const distribution = await runWorkers(dataSource, {
      workerCount: 3,
      orderIds,
      process: async (task) => {
        await delay(duration);
        return `Receipt for order ${task.order_id}`;
      },
    });
    const elapsed = performance.now() - started;
    const [state] = await dataSource.query(
      `SELECT count(*)::int total,
      count(*) FILTER (WHERE processed>1)::int duplicates,
      count(*) FILTER (WHERE processed=1 AND status='done' AND result IS NOT NULL)::int done
      FROM jobs WHERE order_id=ANY($1::bigint[])`,
      [orderIds],
    );
    console.log('Розподіл задач:', distribution);
    console.log(
      `оброблено двічі: ${state.duplicates}; оброблено: ${state.done}; час: ${elapsed.toFixed(1)} ms; послідовно: ≥ ${count * duration} ms`,
    );
    assert.deepEqual(state, { total: count, duplicates: 0, done: count });
    assert.equal(
      Object.values(distribution).reduce((a, b) => a + b, 0),
      count,
    );
    assert.ok(
      Object.values(distribution).filter((value) => value > 0).length >= 2,
    );
    assert.ok(
      elapsed < count * duration,
      'Workers must outperform sequential processing',
    );
  } finally {
    await fixture.cleanup();
  }
} finally {
  await dataSource.destroy();
}
