import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ProductsModule } from './products/products.module.js';
import { ConfigModule } from '@nestjs/config'
import { validate } from './config/env.schema.js';
import { DatabaseModule } from './database/database.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      validate,
    }),
    ProductsModule,
    DatabaseModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
