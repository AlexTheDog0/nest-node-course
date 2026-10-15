import { connect } from 'amqplib';
import type { ChannelModel } from 'amqplib';
import type { OrderPlaced } from './event.js';
import { EXCHANGE } from './topology.js';

export interface EventPublisher {
  publish(event: OrderPlaced): Promise<void>;
}
export function brokerUrl(): string {
  const value = process.env.BROKER_URL;
  if (!value || !['amqp:', 'amqps:'].includes(new URL(value).protocol))
    throw new Error('BROKER_URL must be an AMQP URL');
  return value;
}
export class RabbitPublisher implements EventPublisher {
  constructor(
    private readonly url: string,
    private readonly exchange = EXCHANGE,
  ) {}
  async publish(event: OrderPlaced): Promise<void> {
    let connection: ChannelModel | undefined;
    try {
      connection = await connect(this.url, { timeout: 10000 });
      const channel = await connection.createConfirmChannel();
      let returned = false;
      channel.on('return', () => {
        returned = true;
      });
      channel.on('error', () => {});
      channel.publish(
        this.exchange,
        event.type,
        Buffer.from(JSON.stringify(event)),
        {
          persistent: true,
          mandatory: true,
          messageId: event.eventId,
          contentType: 'application/json',
        },
      );
      await channel.waitForConfirms();
      if (returned) throw new Error('Unroutable order.placed event');
    } finally {
      await connection?.close();
    }
  }
}
