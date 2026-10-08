import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module.js';
import { OrderAuthService } from './order-auth.service.js';
import { OrderEventsService } from './order-events.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersGateway } from './orders.gateway.js';
import { OrdersService } from './orders.service.js';

@Module({
  imports: [DatabaseModule, ConfigModule],
  controllers: [OrdersController],
  providers: [
    OrderAuthService,
    OrderEventsService,
    OrdersService,
    OrdersGateway,
  ],
})
export class OrdersModule {}
