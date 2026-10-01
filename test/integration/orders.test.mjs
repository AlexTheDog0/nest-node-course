import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  test,
  expect,
} from '@jest/globals';
import { User } from '../../dist/entities/user.entity.js';
import { Product } from '../../dist/entities/product.entity.js';
import { Order } from '../../dist/entities/order.entity.js';
import { OrderItem } from '../../dist/entities/order-item.entity.js';
import { checkout, CheckoutError } from '../../dist/transactions/checkout.js';
import { productRevenue } from '../../dist/reports/product-revenue.js';
import { startDatabase } from './testkit/database.mjs';
import { aUser, aProduct, anOrder } from './testkit/builders.mjs';
let db, orders;
beforeAll(async () => {
  db = await startDatabase();
  orders = db.source.getRepository(Order);
});
beforeEach(async () => db.reset());
afterAll(async () => db?.close());
describe('Order repository / PostgreSQL', () => {
  test('joins an order to the persisted buyer', async () => {
    const buyer = await db.source.getRepository(User).save(aUser());
    const order = await orders.save(anOrder(buyer.id));
    const loaded = await orders.findOneOrFail({
      where: { id: order.id },
      relations: { user: true },
    });
    expect(loaded.user.email).toBe(buyer.email);
  });
  test('missing buyer violates foreign key constraint 23503', async () => {
    await expect(orders.insert(anOrder('999999'))).rejects.toMatchObject({
      driverError: { code: '23503' },
    });
  });
  test('SQL aggregation uses historical prices and excludes cancelled orders', async () => {
    const buyer = await db.source.getRepository(User).save(aUser());
    const product = await db.source
      .getRepository(Product)
      .save(aProduct({ priceCents: 9999 }));
    for (const status of ['paid', 'cancelled']) {
      const order = await orders.save(anOrder(buyer.id, { status }));
      await db.source
        .getRepository(OrderItem)
        .insert({
          orderId: order.id,
          productId: product.id,
          quantity: 2,
          unitPriceCents: 700,
        });
    }
    expect(await productRevenue(db.source)).toEqual([
      {
        product_id: product.id,
        product_name: product.name,
        units_sold: '2',
        revenue_cents: '1400',
      },
    ]);
  });
});

test('checkout rollback restores stock when funds are insufficient', async () => {
  const buyer = await db.source
    .getRepository(User)
    .save(aUser({ balanceCents: '0' }));
  const product = await db.source
    .getRepository(Product)
    .save(aProduct({ stock: 1 }));
  await expect(
    checkout(db.source, {
      userId: buyer.id,
      productId: product.id,
      quantity: 1,
    }),
  ).rejects.toMatchObject({ code: 'BALANCE' });
  expect(
    (await db.source.getRepository(Product).findOneByOrFail({ id: product.id }))
      .stock,
  ).toBe(1);
  expect(await orders.count()).toBe(0);
  expect(
    await db.source.query('SELECT count(*)::int AS count FROM jobs'),
  ).toEqual([{ count: 0 }]);
});
test('50 concurrent checkout calls commit exactly 10 orders and jobs', async () => {
  const buyer = await db.source.getRepository(User).save(aUser());
  const product = await db.source
    .getRepository(Product)
    .save(aProduct({ stock: 10 }));
  const results = await Promise.allSettled(
    Array.from({ length: 50 }, () =>
      checkout(db.source, {
        userId: buyer.id,
        productId: product.id,
        quantity: 1,
      }),
    ),
  );
  expect(
    results.filter((result) => result.status === 'fulfilled'),
  ).toHaveLength(10);
  for (const result of results.filter(
    (result) => result.status === 'rejected',
  )) {
    expect(result.reason).toBeInstanceOf(CheckoutError);
    expect(result.reason.code).toBe('STOCK');
  }
  expect(
    (await db.source.getRepository(Product).findOneByOrFail({ id: product.id }))
      .stock,
  ).toBe(0);
  expect(
    (await db.source.getRepository(User).findOneByOrFail({ id: buyer.id }))
      .balanceCents,
  ).toBe('88000');
  expect(await orders.count()).toBe(10);
  expect(
    await db.source.query('SELECT count(*)::int AS count FROM jobs'),
  ).toEqual([{ count: 10 }]);
});
