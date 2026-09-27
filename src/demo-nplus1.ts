import assert from 'node:assert/strict';
import { LessThanOrEqual } from 'typeorm';
import { dataSource } from './data-source.js';
import { Order } from './entities/order.entity.js';
import { OrderItem } from './entities/order-item.entity.js';
import { Product } from './entities/product.entity.js';
import { QueryCountLogger } from './database/query-count-logger.js';

const logger = new QueryCountLogger();
dataSource.setOptions({ logging: ['query'], logger });
await dataSource.initialize();
try {
  const summaries: { n: number; before: number; after: number }[] = [];
  for (const n of [5, 10]) {
    // A predicate on seeded IDs avoids TypeORM's separate pagination-ID query with take+JOIN.
    logger.reset();
    const naive = await dataSource.getRepository(Order).find({
      where: { id: LessThanOrEqual(String(n)) },
      order: { id: 'ASC' },
    });
    assert.equal(naive.length, n, 'Run npm run seed before the demo');
    for (const order of naive) {
      order.items = await dataSource
        .getRepository(OrderItem)
        .find({ where: { orderId: order.id } });
      for (const item of order.items) {
        item.product = await dataSource
          .getRepository(Product)
          .findOneByOrFail({ id: item.productId });
      }
    }
    const before = logger.count;
    logger.reset();
    const joined = await dataSource
      .getRepository(Order)
      .createQueryBuilder('order')
      .leftJoinAndSelect('order.items', 'item')
      .leftJoinAndSelect('item.product', 'product')
      .where('order.id <= :maxId', { maxId: String(n) })
      .orderBy('order.id', 'ASC')
      .getMany();
    const after = logger.count;
    const normalized = (orders: Order[]) =>
      orders.map((order) => ({
        ...order,
        items: [...order.items].sort((a, b) =>
          Number(BigInt(a.productId) - BigInt(b.productId)),
        ),
      }));
    assert.deepEqual(normalized(joined), normalized(naive));
    assert.ok(before >= n);
    assert.equal(after, 1);
    summaries.push({ n, before, after });
  }
  for (const { n, before, after } of summaries) {
    console.log(
      `N=${n}: before=${before}, after=${after} (orders -> items -> product)`,
    );
  }
  assert.equal(summaries[0].after, summaries[1].after);
} finally {
  await dataSource.destroy();
}
