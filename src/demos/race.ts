import assert from 'node:assert/strict';
import { dataSource } from '../data-source.js';
import { checkout, CheckoutError } from '../transactions/checkout.js';
import { createFixture } from './fixture.js';

await dataSource.initialize();
try {
  const fixture = await createFixture(dataSource, 10);
  try {
    const attempts = 50;
    const outcomes = await Promise.all(
      Array.from({ length: attempts }, async () => {
        try {
          await checkout(dataSource, { ...fixture, quantity: 1 });
          return 'success';
        } catch (error) {
          if (error instanceof CheckoutError && error.code === 'STOCK')
            return 'stock';
          return error;
        }
      }),
    );
    const successful = outcomes.filter((value) => value === 'success').length;
    const [state] = await dataSource.query(
      `SELECT
      (SELECT stock FROM products WHERE id=$2) stock,
      (SELECT count(*)::int FROM products WHERE stock<0) negative,
      (SELECT balance_cents FROM users WHERE id=$1) balance,
      (SELECT count(*)::int FROM orders WHERE user_id=$1) orders,
      (SELECT count(*)::int FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.user_id=$1) items,
      (SELECT count(*)::int FROM jobs j JOIN orders o ON o.id=j.order_id WHERE o.user_id=$1) jobs`,
      [fixture.userId, fixture.productId],
    );
    console.log(
      `Спроб: ${attempts}; успішних: ${successful}; фінальний stock: ${state.stock}; рядків із відʼємним stock: ${state.negative}`,
    );
    assert.equal(
      outcomes.filter((value) => value !== 'success' && value !== 'stock')
        .length,
      0,
      'Unexpected checkout error',
    );
    assert.equal(successful, 10);
    assert.deepEqual(state, {
      stock: 0,
      negative: 0,
      balance: '999000',
      orders: 10,
      items: 10,
      jobs: 10,
    });
  } finally {
    await fixture.cleanup();
  }
} finally {
  await dataSource.destroy();
}
