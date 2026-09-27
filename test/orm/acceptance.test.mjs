import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import pg from 'pg';

// Run only against the isolated, migrated homework database (npm run test:orm).
test('seed is repeatable, report uses historical prices, constraints protect history', async () => {
  const run = (script) => {
    const result = spawnSync('npm', ['run', script], {
      encoding: 'utf8',
      env: process.env,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return result.stdout;
  };
  run('seed');
  const db = new pg.Client(
    process.env.DB_URL
      ? { connectionString: process.env.DB_URL }
      : {
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT),
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
        },
  );
  await db.connect();
  try {
    const snapshot = async () =>
      (
        await db.query(`SELECT
      (SELECT count(*)::int FROM users) users,
      (SELECT count(*)::int FROM products) products,
      (SELECT count(*)::int FROM orders) orders,
      (SELECT count(*)::int FROM order_items) items`)
      ).rows[0];
    const before = await snapshot();
    assert.deepEqual(before, {
      users: 10,
      products: 10,
      orders: 10,
      items: 20,
    });
    run('seed');
    assert.deepEqual(await snapshot(), before);
    const demo = run('demo:nplus1');
    assert.match(demo, /N=5: before=16, after=1/);
    assert.match(demo, /N=10: before=31, after=1/);
    assert.match(run('report'), /revenue_cents/);
    const { dataSource } = await import('../../dist/data-source.js');
    const { productRevenue } =
      await import('../../dist/reports/product-revenue.js');
    await dataSource.initialize();
    try {
      const rows = await productRevenue(dataSource);
      assert.deepEqual(
        rows.find((row) => row.product_id === '1'),
        {
          product_id: '1',
          product_name: 'Product 01',
          units_sold: '3',
          revenue_cents: '3000',
        },
      );
    } finally {
      await dataSource.destroy();
    }
    await db.query('BEGIN');
    try {
      for (const sql of [
        'DELETE FROM users WHERE id=1',
        'DELETE FROM products WHERE id=1',
        'UPDATE products SET price_cents=0 WHERE id=1',
        'UPDATE order_items SET quantity=0 WHERE order_id=1',
        "UPDATE orders SET status='invalid' WHERE id=1",
      ]) {
        await db.query('SAVEPOINT bad_input');
        await assert.rejects(db.query(sql), (e) =>
          ['23503', '23514'].includes(e.code),
        );
        await db.query('ROLLBACK TO SAVEPOINT bad_input');
      }
      await db.query('DELETE FROM orders WHERE id=1');
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int n FROM order_items WHERE order_id=1',
          )
        ).rows[0].n,
        0,
      );
      const generated = await db.query(
        "INSERT INTO products(name, price_cents) VALUES ('Fresh product', 123) RETURNING id, search_vector",
      );
      assert.ok(BigInt(generated.rows[0].id) > 10n);
      assert.match(generated.rows[0].search_vector, /fresh/);
    } finally {
      await db.query('ROLLBACK');
    }
  } finally {
    await db.end();
  }
});
