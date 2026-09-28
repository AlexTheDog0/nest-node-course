import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataSource as db } from '../../dist/data-source.js';
import { withTransactionRetry } from '../../dist/transactions/retry.js';

test('retry bounds whole transactions and accepts only 40001/40P01', async () => {
  await db.initialize();
  try {
    for (const code of ['40001', '40P01', '23514', undefined]) {
      let calls = 0;
      const logs = [];
      const error = Object.assign(new Error('failure'), { code });
      await assert.rejects(
        withTransactionRetry(
          db,
          async () => {
            calls++;
            throw error;
          },
          {
            maxAttempts: 3,
            baseDelayMs: 1,
            onRetry: (info) => logs.push(info),
          },
        ),
        (e) => e === error,
      );
      assert.equal(calls, ['40001', '40P01'].includes(code) ? 3 : 1);
      assert.equal(logs.length, calls - 1);
    }
    let calls = 0;
    const value = await withTransactionRetry(
      db,
      async (manager) => {
        calls++;
        await manager.query('SELECT 1');
        if (calls === 1)
          throw Object.assign(new Error('retry'), {
            driverError: { code: '40001' },
          });
        return 42;
      },
      { baseDelayMs: 1, onRetry: () => {} },
    );
    assert.equal(value, 42);
    assert.equal(calls, 2);
  } finally {
    await db.destroy();
  }
});
