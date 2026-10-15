import { z } from 'zod';
import type { CheckoutInput } from '../transactions/checkout.js';

const id = z.string().regex(/^[1-9]\d*$/);
const contract = z.object({
  eventId: z.string().min(1),
  type: z.literal('order.placed'),
  occurredAt: z.iso.datetime(),
  data: z.object({
    orderId: id,
    userId: id,
    productId: id,
    quantity: z.number().int().positive().max(2147483647),
  }),
});
export type OrderPlaced = z.infer<typeof contract>;
export function orderPlaced(
  orderId: string,
  input: CheckoutInput,
): OrderPlaced {
  return contract.parse({
    eventId: `order.placed:${orderId}`,
    type: 'order.placed',
    occurredAt: new Date().toISOString(),
    data: {
      orderId,
      userId: input.userId,
      productId: input.productId,
      quantity: input.quantity,
    },
  });
}
export function parseOrderPlaced(content: Buffer): OrderPlaced {
  return contract.parse(JSON.parse(content.toString('utf8')));
}
