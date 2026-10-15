import type { DataSource } from 'typeorm';
import type { OrderPlaced } from './event.js';
// The persisted receipt IS the business effect, not a separate processed marker.
export async function recordReceipt(
  source: DataSource,
  event: OrderPlaced,
): Promise<boolean> {
  const rows: unknown[] = await source.query(
    `INSERT INTO order_receipts(event_id, order_id, payload) VALUES ($1, $2, $3::jsonb)
     ON CONFLICT DO NOTHING RETURNING event_id`,
    [event.eventId, event.data.orderId, JSON.stringify(event)],
  );
  return rows.length === 1;
}
