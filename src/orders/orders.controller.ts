import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { OrderAuthService } from './order-auth.service.js';
import { OrderEventsService } from './order-events.service.js';
import { OrdersService } from './orders.service.js';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly events: OrderEventsService,
    private readonly auth: OrderAuthService,
  ) {}

  @Get(':id')
  get(
    @Param('id') id: string,
    @Headers('authorization') authorization?: string,
  ) {
    return this.orders.getOwned(id, this.auth.fromHeader(authorization).userId);
  }

  @Patch(':id/status')
  changeStatus(
    @Param('id') id: string,
    @Body() body: { status?: unknown },
    @Headers('authorization') authorization?: string,
  ) {
    return this.orders.changeStatus(
      id,
      this.auth.fromHeader(authorization).userId,
      body?.status,
    );
  }

  @Get(':id/events')
  async stream(
    @Param('id') id: string,
    @Headers('authorization') authorization: string | undefined,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Res() response: Response,
  ) {
    const identity = this.auth.fromHeader(authorization);
    await this.orders.getOwned(id, identity.userId);
    // The peer may have closed while the database lookup was pending. No async
    // work follows this check before lifecycle listeners are installed.
    if (response.destroyed || response.writableEnded) return;
    let lastId: number | undefined;
    if (lastEventId !== undefined) {
      if (
        !/^\d+$/.test(lastEventId) ||
        !Number.isSafeInteger(Number(lastEventId))
      ) {
        throw new BadRequestException(
          'Last-Event-ID must be a non-negative safe integer',
        );
      }
      lastId = Number(lastEventId);
    }
    response.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    response.flushHeaders();
    response.write('retry: 1000\n\n');
    const subscription = this.events.stream(id, lastId).subscribe((event) => {
      if (response.destroyed || response.writableEnded) return;
      // End slow connections instead of accumulating an unbounded output queue.
      if (
        !response.write(
          `id: ${event.id}\nevent: order.status\ndata: ${JSON.stringify(event)}\n\n`,
        )
      )
        response.end();
    });
    const heartbeat = setInterval(() => {
      if (!response.write(': keep-alive\n\n')) response.end();
    }, 15000);
    const expiry = setTimeout(
      () => response.end(),
      Math.min(identity.expiresAt - Date.now(), 2147483647),
    );
    const cleanup = () => {
      subscription.unsubscribe();
      clearInterval(heartbeat);
      clearTimeout(expiry);
    };
    response.once('close', cleanup);
    response.once('finish', cleanup);
  }
}
