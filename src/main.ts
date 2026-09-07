import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';
import { ConfigService } from '@nestjs/config';
import type { Env } from './config/env.schema.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule);
configureApp(app);
const config = app.get(ConfigService<Env, true>);
await app.listen(config.get('PORT',{infer: true}));
