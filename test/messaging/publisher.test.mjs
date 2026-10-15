import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { connect } from 'amqplib';
import { RabbitPublisher, brokerUrl } from '../../dist/messaging/publisher.js';
import { EXCHANGE } from '../../dist/messaging/topology.js';

test('publisher rejects a confirmed but unroutable message', async () => {
  const connection = await connect(brokerUrl());
  try {
    const bootstrap = await connection.createChannel();
    await bootstrap.assertExchange(EXCHANGE, 'topic', { durable: true });
    // Runtime input forces a routing key with no subscribers, without altering shared bindings.
    await assert.rejects(new RabbitPublisher(brokerUrl()).publish({
      eventId: randomUUID(), type: `unroutable.${randomUUID()}`, occurredAt: new Date().toISOString(), data: {},
    }), /Unroutable/);
  } finally { await connection.close(); }
});
