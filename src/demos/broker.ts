import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { connect } from 'amqplib';
import { dataSource } from '../data-source.js';
import { checkout } from '../transactions/checkout.js';
import { createFixture } from './fixture.js';
import { brokerUrl, RabbitPublisher } from '../messaging/publisher.js';
import { consumeOrders, counters } from '../messaging/consumer.js';
import { recordReceipt } from '../messaging/effect.js';
import {
  declareTopology,
  PREFETCH,
  topologyNames,
} from '../messaging/topology.js';

const mode = process.argv[2];
if (!['publish', 'dlq', 'duplicate'].includes(mode))
  throw new Error('Expected publish, dlq or duplicate');
const deadline = Date.now() + 30000;
let failure: Error | undefined;
async function until(check: () => Promise<boolean> | boolean) {
  while (!(await check())) {
    if (failure) throw failure;
    if (Date.now() > deadline) throw new Error('Demo timed out');
    await delay(20);
  }
  if (failure) throw failure;
}
function invariant(ok: boolean, description: string) {
  if (!ok) throw new Error(description);
}
const connection = await connect(brokerUrl(), { timeout: 10000 });
connection.on('error', (error) => {
  failure = error;
});
const admin = await connection.createConfirmChannel();
admin.on('error', (error) => {
  failure = error;
});
// Fresh private resources each run: no purging a shared application's queue.
const namespace = `shop.demo.${mode}.${randomUUID()}`;
const names = topologyNames(namespace, `${namespace}.events`);
const stats = counters();
let fixture: Awaited<ReturnType<typeof createFixture>> | undefined;
try {
  await dataSource.initialize();
  await dataSource.runMigrations();
  fixture = await createFixture(dataSource, 5);
  await declareTopology(admin, names);
  const consumer = await connection.createChannel();
  consumer.on('error', (error) => {
    failure = error;
  });
  const { consumerTag } = await consumeOrders(
    consumer,
    names,
    (event) => recordReceipt(dataSource, event),
    stats,
    (error) => {
      failure = error;
    },
    mode === 'duplicate'
      ? (message, applied) => {
          if (applied) {
            consumer.nack(message, false, true);
            return true;
          }
          return false;
        }
      : undefined,
  );
  const publisher = new RabbitPublisher(brokerUrl(), names.exchange);
  const count = mode === 'publish' ? 5 : mode === 'duplicate' ? 1 : 0;
  for (let i = 0; i < count; i++)
    await checkout(dataSource, { ...fixture, quantity: 1 }, publisher);
  if (mode === 'dlq') {
    admin.publish(
      names.exchange,
      'order.placed',
      Buffer.from('{"invalid":true}'),
      {
        persistent: true,
        mandatory: true,
      },
    );
    await admin.waitForConfirms();
  }
  await until(() =>
    mode === 'dlq' ? stats.rejected === 1 : stats.acked === count,
  );
  // cancel-ok orders after the preceding acknowledgements on this channel.
  await consumer.cancel(consumerTag);
  await consumer.close();
  let work = await admin.checkQueue(names.queue);
  let dlq = await admin.checkQueue(names.dlq);
  if (mode === 'dlq') {
    await until(async () => {
      dlq = await admin.checkQueue(names.dlq);
      return dlq.messageCount === 1;
    });
  }
  work = await admin.checkQueue(names.queue);
  const [row]: { count: number }[] = await dataSource.query(
    `SELECT count(*)::int AS count FROM order_receipts r JOIN orders o ON o.id=r.order_id WHERE o.user_id=$1`,
    [fixture.userId],
  );
  invariant(
    row.count === stats.effect,
    'Durable receipt count differs from effect counter',
  );
  invariant(work.messageCount === 0, 'Work queue not empty');
  if (mode === 'publish') {
    invariant(
      stats.effect === 5 &&
        stats.acked === 5 &&
        stats.delivered === 5 &&
        dlq.messageCount === 0,
      'Publish invariant',
    );
    console.log(
      `published=5\ndelivered=${stats.delivered}\neffect=${row.count}\nacked=${stats.acked}\ndlq=${dlq.messageCount}\nprefetch=${PREFETCH}`,
    );
  } else if (mode === 'duplicate') {
    invariant(
      stats.delivered >= 2 &&
        row.count === 1 &&
        stats.skipped >= 1 &&
        dlq.messageCount === 0,
      'Duplicate invariant',
    );
    console.log(
      `deliveries=${stats.delivered}\neffect=${row.count}\nskipped=${stats.skipped}`,
    );
  } else {
    // Requeue this inspection so the reported DLQ depth remains one.
    const message = await admin.get(names.dlq, { noAck: false });
    invariant(!!message, 'Missing dead letter');
    if (!message) throw new Error('Missing dead letter');
    const reason =
      message.properties.headers?.['x-first-death-reason'] ??
      message.properties.headers?.['x-death']?.[0]?.reason;
    admin.nack(message, false, true);
    invariant(
      ['rejected', 'expired', 'maxlen', 'delivery_limit'].includes(
        String(reason),
      ),
      'Missing x-death reason',
    );
    invariant(
      dlq.messageCount === 1 && row.count === 0 && stats.rejected === 1,
      'DLQ invariant',
    );
    console.log(
      `rejected=${stats.rejected}\nwork=${work.messageCount}\ndlq=${dlq.messageCount}\ndlq-reason=${reason}\neffect=${row.count}`,
    );
  }
} finally {
  try {
    await admin.deleteQueue(names.queue);
    await admin.deleteQueue(names.dlq);
    await admin.deleteExchange(names.dlx);
    await admin.deleteExchange(names.exchange);
  } finally {
    await connection.close();
    if (fixture) await fixture.cleanup();
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}
