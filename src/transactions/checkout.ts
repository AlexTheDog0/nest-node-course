import type { DataSource } from 'typeorm';

export class CheckoutError extends Error {
  constructor(public readonly code: 'STOCK' | 'BALANCE') {
    super(code === 'STOCK' ? 'Insufficient stock' : 'Insufficient balance');
  }
}

export interface CheckoutInput {
  userId: string;
  productId: string;
  quantity: number;
}

export async function checkout(
  source: DataSource,
  input: CheckoutInput,
): Promise<string> {
  const { userId, productId, quantity } = input;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647) {
    throw new RangeError('quantity must be a positive PostgreSQL integer');
  }
  return source.transaction(async (manager) => {
    // A CTE normalizes TypeORM's driver-specific UPDATE result into SELECT rows.
    const products: { price_cents: number }[] = await manager.query(
      `WITH updated AS (
        UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2
        RETURNING price_cents
      ) SELECT * FROM updated`,
      [productId, quantity],
    );
    if (!products.length) throw new CheckoutError('STOCK');
    const total = (
      BigInt(products[0].price_cents) * BigInt(quantity)
    ).toString();
    const buyers: { id: string }[] = await manager.query(
      `WITH updated AS (
        UPDATE users SET balance_cents = balance_cents - $2::bigint
        WHERE id = $1 AND balance_cents >= $2::bigint RETURNING id
      ) SELECT * FROM updated`,
      [userId, total],
    );
    if (!buyers.length) throw new CheckoutError('BALANCE');
    const [order]: { id: string }[] = await manager.query(
      `INSERT INTO orders(user_id, status) VALUES ($1, 'paid') RETURNING id`,
      [userId],
    );
    await manager.query(
      `INSERT INTO order_items(order_id, product_id, quantity, unit_price_cents)
      VALUES ($1, $2, $3, $4)`,
      [order.id, productId, quantity, products[0].price_cents],
    );
    await manager.query('INSERT INTO jobs(order_id) VALUES ($1)', [order.id]);
    return order.id;
  });
}
