import type { ErrorRequestHandler } from 'express';
import { STATUS_CODES } from 'node:http';

export interface Problem {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
}

export function resolveErrorStatus(candidate: unknown): number {
  return typeof candidate === 'number' &&
    Number.isInteger(candidate) &&
    candidate >= 400 &&
    candidate <= 599
    ? candidate
    : 500;
}

export function createProblem(error: unknown, instance: string): Problem {
  const record = typeof error === 'object' && error !== null ? error : {};
  const status = resolveErrorStatus(
    'status' in record ? record.status : undefined,
  );
  const detail =
    'message' in record && typeof record.message === 'string'
      ? record.message
      : 'An unexpected error occurred';
  return {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Unknown Error',
    status,
    detail,
    instance,
  };
}

export const problemHandler: ErrorRequestHandler = (
  error: unknown,
  req,
  res,
  next,
) => {
  if (res.headersSent) return next(error);
  const problem = createProblem(error, req.originalUrl);
  res.status(problem.status).type('application/problem+json').json(problem);
};
