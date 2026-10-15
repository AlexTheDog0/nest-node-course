import { connect } from 'amqplib';
import { dataSource } from '../data-source.js';
import { brokerUrl } from './publisher.js';
import { consumeOrders, counters } from './consumer.js';
import { recordReceipt } from './effect.js';
import { topologyNames } from './topology.js';

await dataSource.initialize();
const connection = await connect(brokerUrl());
const channel = await connection.createChannel();
let stopping = false;
async function stop(code: number) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  // Closing the channel requeues any unacknowledged effects for the next worker.
  await connection.close().catch(() => {});
  await dataSource.destroy();
}
connection.on('error', () => {
  void stop(1);
});
channel.on('error', () => {
  void stop(1);
});
await consumeOrders(
  channel,
  topologyNames(),
  (event) => recordReceipt(dataSource, event),
  counters(),
  () => {
    console.error(
      'Order consumer failed; unacknowledged messages will be redelivered',
    );
    void stop(1);
  },
);
process.once('SIGINT', () => {
  void stop(0);
});
process.once('SIGTERM', () => {
  void stop(0);
});
console.log('Order receipt consumer ready');
