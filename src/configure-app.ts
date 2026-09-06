import type { NestExpressApplication } from '@nestjs/platform-express';
import * as OpenApiValidator from 'express-openapi-validator';
import { fileURLToPath } from 'node:url';
import { problemHandler } from './problem-handler.js';
import { ProblemFilter } from './problem.filter.js';

export function configureApp(app: NestExpressApplication): void {
  app.useBodyParser('json');
  app.use(
    OpenApiValidator.middleware({
      apiSpec: fileURLToPath(
        new URL('../openapi/openapi.yaml', import.meta.url),
      ),
      validateRequests: true,
      validateResponses: true,
    }),
  );
  app.use(problemHandler);
  app.useGlobalFilters(new ProblemFilter());
}
