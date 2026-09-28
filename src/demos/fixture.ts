import { randomUUID } from 'node:crypto';
import type { DataSource } from 'typeorm';

// Each invocation owns its rows; never reset shared stock or delete historical seed data.
export async function createFixture(
  source: DataSource,
  stock: number,
  balance = '1000000',
) {
  const fixture = await source.transaction(async (manager) => {
    const [user]: { id: string }[] = await manager.query(
      `INSERT INTO users(email, name, balance_cents) VALUES ($1, 'HW14 demo', $2) RETURNING id`,
      [`hw14-${randomUUID()}@example.test`, balance],
    );
    const [product]: { id: string }[] = await manager.query(
      `INSERT INTO products(name, price_cents, stock) VALUES ('HW14 demo', 100, $1) RETURNING id`,
      [stock],
    );
    return { userId: user.id, productId: product.id };
  });
  return {
    ...fixture,
    cleanup: () =>
      source.transaction(async (manager) => {
        await manager.query('DELETE FROM orders WHERE user_id=$1', [
          fixture.userId,
        ]);
        await manager.query('DELETE FROM products WHERE id=$1', [
          fixture.productId,
        ]);
        await manager.query('DELETE FROM users WHERE id=$1', [fixture.userId]);
      }),
  };
}
