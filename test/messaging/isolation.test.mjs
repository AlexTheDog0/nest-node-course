import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { connect } from 'amqplib';
import { brokerUrl } from '../../dist/messaging/publisher.js';
import { declareTopology, topologyNames } from '../../dist/messaging/topology.js';

test('publish demo leaves application subscribers untouched', async () => {
  const connection = await connect(brokerUrl());
  const channel = await connection.createChannel();
  const names = topologyNames(`shop.test.observer.${randomUUID()}`);
  try {
    await declareTopology(channel, names);
    const { stdout } = await promisify(execFile)(process.execPath, ['dist/demos/broker.js', 'publish'], { timeout: 45000 });
    assert.match(stdout, /^effect=5$/m);
    const queue = await channel.checkQueue(names.queue);
    assert.equal(queue.messageCount, 0, 'Demo events leaked into an application subscription');
  } finally {
    await channel.deleteQueue(names.queue);
    await channel.deleteQueue(names.dlq);
    await channel.deleteExchange(names.dlx);
    await connection.close();
  }
});
