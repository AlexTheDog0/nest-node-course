import type { Channel } from 'amqplib';
export const EXCHANGE = 'shop.events';
export const PREFETCH = 10;
export function topologyNames(
  queue = 'shop.order-receipts',
  exchange = EXCHANGE,
) {
  return { exchange, queue, dlx: `${queue}.dlx`, dlq: `${queue}.dlq` };
}
export type Topology = ReturnType<typeof topologyNames>;
// Only bootstrap/consumers declare subscribers; publishers know only the exchange.
export async function declareTopology(channel: Channel, names: Topology) {
  await channel.assertExchange(names.exchange, 'topic', { durable: true });
  await channel.assertExchange(names.dlx, 'fanout', { durable: true });
  await channel.assertQueue(names.dlq, {
    durable: true,
    arguments: { 'x-queue-type': 'quorum' },
  });
  await channel.bindQueue(names.dlq, names.dlx, '');
  await channel.assertQueue(names.queue, {
    durable: true,
    arguments: {
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': names.dlx,
    },
  });
  await channel.bindQueue(names.queue, names.exchange, 'order.placed');
}
