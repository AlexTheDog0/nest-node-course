import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataSource as db } from '../../dist/data-source.js';
import { checkout } from '../../dist/transactions/checkout.js';
import { createFixture } from '../../dist/demos/fixture.js';

test('checkout commits all effects and rolls back stock, debit, order and job on failure', async () => {
  await db.initialize();
  const fixture = await createFixture(db, 2, '150');
  const input = {
    userId: fixture.userId,
    productId: fixture.productId,
    quantity: 1,
  };
  const state = async () =>
    (
      await db.query(
        `SELECT
    (SELECT stock FROM products WHERE id=$2) stock,
    (SELECT balance_cents FROM users WHERE id=$1) balance,
    (SELECT count(*)::int FROM orders WHERE user_id=$1) orders,
    (SELECT count(*)::int FROM jobs j JOIN orders o ON o.id=j.order_id WHERE o.user_id=$1) jobs`,
        [fixture.userId, fixture.productId],
      )
    )[0];
  try {
    await checkout(db, input);
    assert.deepEqual(await state(), {
      stock: 1,
      balance: '50',
      orders: 1,
      jobs: 1,
    });
    await assert.rejects(checkout(db, input), /Insufficient balance/);
    assert.deepEqual(await state(), {
      stock: 1,
      balance: '50',
      orders: 1,
      jobs: 1,
    });
    await assert.rejects(
      checkout(db, { ...input, quantity: 2 }),
      /Insufficient stock/,
    );
    for (const quantity of [0, -1, 1.5, NaN, 2147483648]) {
      await assert.rejects(checkout(db, { ...input, quantity }), /quantity/);
    }
    await db.query('UPDATE users SET balance_cents=1000 WHERE id=$1', [
      fixture.userId,
    ]);
    // Force the final INSERT to fail without modifying shared schema or other rows.
    await db
      .transaction(async (manager) => {
        await manager.query(
          `CREATE TEMP TABLE jobs (order_id bigint CHECK (false)) ON COMMIT DROP`,
        );
        await assert.rejects(
          checkout({ transaction: (fn) => fn(manager) }, input),
          /check constraint/,
        );
        // The failed statement aborts this outer transaction; rollback is explicit below.
        throw new Error('rollback injected failure');
      })
      .catch((e) => assert.match(e.message, /rollback injected failure/));
    assert.deepEqual(await state(), {
      stock: 1,
      balance: '1000',
      orders: 1,
      jobs: 1,
    });
  } finally {
    await fixture.cleanup();
    await db.destroy();
  }
});

test('different products cannot overspend one buyer balance; bigint money stays exact', async () => {
  await db.initialize();
  const first = await createFixture(db, 1, '150');
  const second = await createFixture(db, 1);
  try {
    const outcomes = await Promise.allSettled(
      [first.productId, second.productId].map((productId) =>
        checkout(db, { userId: first.userId, productId, quantity: 1 }),
      ),
    );
    assert.equal(
      outcomes.filter((result) => result.status === 'fulfilled').length,
      1,
    );
    const rejected = outcomes.find((result) => result.status === 'rejected');
    assert.equal(rejected.reason.code, 'BALANCE');
    const [state] = await db.query(
      `SELECT
      (SELECT balance_cents FROM users WHERE id=$1) balance,
      (SELECT sum(stock)::int FROM products WHERE id=ANY($2::bigint[])) stock`,
      [first.userId, [first.productId, second.productId]],
    );
    assert.deepEqual(state, { balance: '50', stock: 1 });
    await db.query(
      'UPDATE users SET balance_cents=9007199254740993 WHERE id=$1',
      [first.userId],
    );
    const [remaining] = await db.query(
      'SELECT id FROM products WHERE id=ANY($1::bigint[]) AND stock=1',
      [[first.productId, second.productId]],
    );
    await checkout(db, {
      userId: first.userId,
      productId: remaining.id,
      quantity: 1,
    });
    const [buyer] = await db.query(
      'SELECT balance_cents FROM users WHERE id=$1',
      [first.userId],
    );
    assert.equal(buyer.balance_cents, '9007199254740893');
    await db.query(
      'UPDATE users SET balance_cents=20000000000000000 WHERE id=$1',
      [first.userId],
    );
    await db.query(
      'UPDATE products SET stock=4194305, price_cents=2147483647 WHERE id=$1',
      [first.productId],
    );
    await checkout(db, {
      userId: first.userId,
      productId: first.productId,
      quantity: 4194305,
    });
    const [large] = await db.query(
      'SELECT balance_cents FROM users WHERE id=$1',
      [first.userId],
    );
    assert.equal(large.balance_cents, '10992798601969665');
  } finally {
    await first.cleanup();
    await second.cleanup();
    await db.destroy();
  }
});
