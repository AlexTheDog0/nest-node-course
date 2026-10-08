import { HttpException, type OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { Server, type Socket } from 'socket.io';
import type { Subscription } from 'rxjs';
import { OrderAuthService } from './order-auth.service.js';
import { OrderEventsService } from './order-events.service.js';
import { OrdersService } from './orders.service.js';

@WebSocketGateway()
export class OrdersGateway implements OnGatewayInit, OnModuleDestroy {
  @WebSocketServer() private server: Server;
  private subscription?: Subscription;

  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrderEventsService,
    private readonly auth: OrderAuthService,
  ) {}

  afterInit(): void {
    this.subscription = this.events.events$.subscribe((event) => {
      this.server.to(`orders:${event.orderId}`).emit('order.status', event);
    });
  }

  @SubscribeMessage('join')
  async join(@ConnectedSocket() socket: Socket, @MessageBody() body: unknown) {
    try {
      const identity = this.auth.authenticate(socket.handshake.auth.token);
      const orderId =
        typeof body === 'object' && body !== null && 'orderId' in body
          ? body.orderId
          : undefined;
      this.orders.validateId(orderId);
      await this.orders.getOwned(orderId, identity.userId);
      if (!socket.connected || identity.expiresAt <= Date.now())
        return { ok: false, status: 401 };
      await socket.join(`orders:${orderId}`);
      if (!socket.data.expiryTimer) {
        const timer = setTimeout(
          () => socket.disconnect(true),
          Math.min(identity.expiresAt - Date.now(), 2147483647),
        );
        socket.data.expiryTimer = timer;
        socket.once('disconnect', () => clearTimeout(timer));
      }
      return { ok: true, room: `orders:${orderId}` };
    } catch (error) {
      return {
        ok: false,
        status: error instanceof HttpException ? error.getStatus() : 500,
      };
    }
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
  }
}
