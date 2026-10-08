import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';
import type { OrderStatus } from '../entities/order.entity.js';

export interface OrderStatusEvent {
  readonly id: number;
  readonly orderId: string;
  readonly status: OrderStatus;
}

@Injectable()
export class OrderEventsService implements OnModuleDestroy {
  private readonly subject = new Subject<OrderStatusEvent>();
  private readonly history: OrderStatusEvent[] = [];
  private nextId = 1;
  readonly events$ = this.subject.asObservable();

  publish(orderId: string, status: OrderStatus): OrderStatusEvent {
    const event = Object.freeze({ id: this.nextId++, orderId, status });
    this.history.push(event);
    if (this.history.length > 1000) this.history.shift();
    this.subject.next(event);
    return event;
  }

  stream(orderId: string, lastId?: number): Observable<OrderStatusEvent> {
    return new Observable((subscriber) => {
      // Capture a watermark and attach the live listener before replaying. A
      // subscriber may trigger a publish synchronously while handling replay.
      const watermark = this.nextId - 1;
      const pending: OrderStatusEvent[] = [];
      let replaying = true;
      const live = this.subject.subscribe({
        next: (event) => {
          if (event.orderId !== orderId || event.id <= (lastId ?? -1)) return;
          if (replaying) pending.push(event);
          else subscriber.next(event);
        },
        complete: () => subscriber.complete(),
      });
      if (lastId !== undefined) {
        for (const event of this.history.slice()) {
          if (
            event.orderId === orderId &&
            event.id > lastId &&
            event.id <= watermark
          ) {
            subscriber.next(event);
          }
        }
      }
      // Keep queueing while draining to preserve order for reentrant publishers.
      while (pending.length && !subscriber.closed)
        subscriber.next(pending.shift()!);
      replaying = false;
      return () => live.unsubscribe();
    });
  }

  onModuleDestroy(): void {
    this.subject.complete();
  }
}
