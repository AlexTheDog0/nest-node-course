import type { Channel, ConsumeMessage } from 'amqplib';
import type { OrderPlaced } from './event.js';
import { parseOrderPlaced } from './event.js';
import { declareTopology, PREFETCH, type Topology } from './topology.js';
export interface Counters {
  delivered: number;
  effect: number;
  acked: number;
  skipped: number;
  rejected: number;
}
export function counters(): Counters {
  return { delivered: 0, effect: 0, acked: 0, skipped: 0, rejected: 0 };
}
export async function consumeOrders(
  channel: Channel,
  names: Topology,
  effect: (event: OrderPlaced) => Promise<boolean>,
  stats: Counters,
  onError: (error: Error) => void,
  afterEffect?: (message: ConsumeMessage, applied: boolean) => boolean,
) {
  await declareTopology(channel, names);
  await channel.prefetch(PREFETCH);
  return channel.consume(
    names.queue,
    (message) => {
      if (!message) {
        onError(new Error('Consumer cancelled by broker'));
        return;
      }
      stats.delivered++;
      let event: OrderPlaced;
      try {
        event = parseOrderPlaced(message.content);
      } catch {
        stats.rejected++;
        channel.nack(message, false, false);
        return;
      }
      void (async () => {
        const applied = await effect(event);
        if (applied) stats.effect++;
        else stats.skipped++;
        if (afterEffect?.(message, applied)) return;
        channel.ack(message);
        stats.acked++;
      })().catch((error: Error) => onError(error));
    },
    { noAck: false },
  );
}
