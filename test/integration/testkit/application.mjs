import { Test } from '@nestjs/testing';
import { configureApp } from '../../../dist/configure-app.js';
import { startDatabase } from './database.mjs';

export async function startApplication() {
  const database = await startDatabase();
  let app;
  let module;
  try {
    // AppModule evaluates ConfigModule.forRoot only after testcontainer env exists.
    const { AppModule } = await import('../../../dist/app.module.js');
    module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication({ logger: false });
    configureApp(app);
    await app.init();
    return {
      app,
      database,
      async close() {
        try {
          await app.close();
        } finally {
          await database.close();
        }
      },
    };
  } catch (error) {
    try {
      if (app) await app.close();
      else await module?.close();
    } finally {
      await database.close();
    }
    throw error;
  }
}
