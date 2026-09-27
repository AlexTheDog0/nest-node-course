import { dataSource } from './data-source.js';

await dataSource.initialize();
try {
  // Fixed IDs reserve 1..10 for this development fixture. Do not run against production.
  // ALWAYS identity requires OVERRIDING SYSTEM VALUE, so inserts use parameterized SQL.
  await dataSource.transaction(async (manager) => {
    for (let id = 1; id <= 10; id++) {
      const label = String(id).padStart(2, '0');
      const createdAt = new Date(`2026-01-${label}T12:00:00Z`);
      await manager.query(
        `INSERT INTO users(id, email, name, created_at)
        OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING`,
        [id, `user${label}@example.test`, `User ${label}`, createdAt],
      );
      await manager.query(
        `INSERT INTO products(id, name, description, price_cents, stock, created_at)
        OVERRIDING SYSTEM VALUE VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO NOTHING`,
        [
          id,
          `Product ${label}`,
          `Marketplace demo product ${label}`,
          1000 + id * 100,
          100,
          createdAt,
        ],
      );
      await manager.query(
        `INSERT INTO orders(id, user_id, status, created_at)
        OVERRIDING SYSTEM VALUE VALUES ($1, $1, $2, $3)
        ON CONFLICT (id) DO NOTHING`,
        [
          id,
          ['paid', 'shipped', 'pending', 'cancelled'][(id - 1) % 4],
          createdAt,
        ],
      );
    }
    for (let id = 1; id <= 10; id++) {
      await manager.query(
        `INSERT INTO order_items(order_id, product_id, quantity, unit_price_cents)
        VALUES ($1, $1, 2, $3), ($1, $2, 1, $4)
        ON CONFLICT (order_id, product_id) DO NOTHING`,
        [id, (id % 10) + 1, 900 + id * 100, 900 + ((id % 10) + 1) * 100],
      );
    }
    // Explicit fixture IDs must not leave future generated IDs pointing at occupied rows.
    // Never move a sequence backwards when reseeding an existing development database.
    for (const table of ['users', 'products', 'orders']) {
      await manager.query(`SELECT setval(pg_get_serial_sequence('${table}', 'id'),
        GREATEST((SELECT max(id) FROM ${table}),
          (SELECT last_value FROM ${table}_id_seq)), true)`);
    }
  });
  console.log(
    'Seed ready: 10 users, 10 products, 10 orders, 20 order_items (repeatable).',
  );
} finally {
  await dataSource.destroy();
}
