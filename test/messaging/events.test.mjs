import { test } from 'node:test';
import assert from 'node:assert/strict';

test('order contract is stable across retries and rejects poison payloads', async () => {
  const { orderPlaced, parseOrderPlaced } = await import('../../dist/messaging/event.js');
  const event = orderPlaced('42', { userId: '1', productId: '2', quantity: 3 });
  assert.equal(event.eventId, orderPlaced('42', event.data).eventId);
  assert.deepEqual(parseOrderPlaced(Buffer.from(JSON.stringify(event))), event);
  for (const value of [{}, { ...event, type: 'other' }, { ...event, data: { ...event.data, quantity: -1 } }]) {
    assert.throws(() => parseOrderPlaced(Buffer.from(JSON.stringify(value))));
  }
});
