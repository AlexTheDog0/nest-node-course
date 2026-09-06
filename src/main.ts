import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule, ObserveInstrument } from './app.module.js';
import { configureApp } from './configure-app.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  instrument: ObserveInstrument,
});
configureApp(app);
await app.listen(process.env.PORT ?? 3000);
