import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { OrderStatus } from '../entities/order.entity.js';
import { OrderEventsService } from './order-events.service.js';

interface StoredOrder {
  id: string;
  user_id: string;
  status: OrderStatus;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly events: OrderEventsService,
  ) {}

  validateId(id: unknown): asserts id is string {
    if (
      typeof id !== 'string' ||
      !/^[1-9]\d*$/.test(id) ||
      id.length > 19 ||
      BigInt(id) > 9223372036854775807n
    ) {
      throw new BadRequestException('Invalid order ID');
    }
  }

  private assertOwner(
    order: StoredOrder | undefined,
    userId: string,
  ): asserts order is StoredOrder {
    if (!order) throw new NotFoundException('Order was not found');
    if (order.user_id !== userId)
      throw new ForbiddenException('Order belongs to another user');
  }

  async getOwned(id: string, userId: string) {
    this.validateId(id);
    const { rows } = await this.database.query<StoredOrder>(
      'SELECT id, user_id, status FROM orders WHERE id=$1',
      [id],
    );
    const order = rows[0];
    this.assertOwner(order, userId);
    return { id: order.id, status: order.status };
  }

  async changeStatus(id: string, userId: string, status: unknown) {
    this.validateId(id);
    if (
      !['pending', 'paid', 'shipped', 'cancelled'].includes(status as string)
    ) {
      throw new BadRequestException('Invalid order status');
    }
    const result = await this.database.transaction(async (client) => {
      const { rows } = await client.query<StoredOrder>(
        'SELECT id, user_id, status FROM orders WHERE id=$1 FOR UPDATE',
        [id],
      );
      const order = rows[0];
      this.assertOwner(order, userId);
      const changed = order.status !== status;
      if (changed)
        await client.query('UPDATE orders SET status=$2 WHERE id=$1', [
          id,
          status,
        ]);
      return { changed, status: status as OrderStatus };
    });
    // transaction resolves only after COMMIT; denied, failed and no-op changes emit nothing.
    const event = result.changed
      ? this.events.publish(id, result.status)
      : undefined;
    return { id, status: result.status, eventId: event?.id ?? null };
  }
}
