import assert from 'node:assert/strict';
import { dataSource } from '../data-source.js';
import { withTransactionRetry } from '../transactions/retry.js';
import { createFixture } from './fixture.js';

await dataSource.initialize();
try {
  const fixture = await createFixture(dataSource, 0, '100');
  try {
    let readers = 0;
    let release!: () => void;
    let retries = 0;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const results = await Promise.allSettled(
      Array.from({ length: 2 }, () =>
        withTransactionRetry(
          dataSource,
          async (manager, attempt) => {
            await manager.query(`SET LOCAL statement_timeout = '5s'`);
            const [user]: { balance_cents: string }[] = await manager.query(
              'SELECT balance_cents FROM users WHERE id=$1',
              [fixture.userId],
            );
            if (attempt === 1) {
              if (++readers === 2) release();
              let timer: ReturnType<typeof setTimeout> | undefined;
              try {
                await Promise.race([
                  barrier,
                  new Promise<never>((_, reject) => {
                    timer = setTimeout(
                      () => reject(new Error('Snapshot barrier timed out')),
                      5000,
                    );
                  }),
                ]);
              } finally {
                clearTimeout(timer);
              }
            }
            await manager.query(
              'UPDATE users SET balance_cents=$2 WHERE id=$1',
              [fixture.userId, (BigInt(user.balance_cents) + 1n).toString()],
            );
          },
          {
            onRetry: (info) => {
              retries++;
              console.log(
                `Retry ${info.attempt}: PostgreSQL ${info.code}, backoff ${info.delayMs} ms`,
              );
            },
          },
        ),
      ),
    );
    for (const result of results)
      if (result.status === 'rejected') throw result.reason;
    const [user] = await dataSource.query(
      'SELECT balance_cents FROM users WHERE id=$1',
      [fixture.userId],
    );
    console.log(
      `Повторів: ${retries}; фінальний баланс: ${user.balance_cents}; очікується: 100 + 1 + 1 = 102`,
    );
    assert.ok(retries >= 1, 'Must provoke a real serialization failure');
    assert.equal(user.balance_cents, '102');
  } finally {
    await fixture.cleanup();
  }
} finally {
  await dataSource.destroy();
}
