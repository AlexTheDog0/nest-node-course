import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { createProblem } from './problem-handler.js';

@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    if (res.headersSent) {
      res.end();
      return;
    }
    const error =
      exception instanceof HttpException
        ? { status: exception.getStatus(), message: exception.message }
        : exception;
    const problem = createProblem(error, req.originalUrl);
    res.status(problem.status).type('application/problem+json').json(problem);
  }
}
