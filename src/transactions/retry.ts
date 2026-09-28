import { setTimeout as delay } from 'node:timers/promises';
import type { DataSource, EntityManager } from 'typeorm';

interface RetryInfo {
  code: string;
  attempt: number;
  delayMs: number;
}
interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  isolation?: 'READ COMMITTED' | 'REPEATABLE READ' | 'SERIALIZABLE';
  onRetry?: (info: RetryInfo) => void;
}

function postgresCode(error: unknown): unknown {
  if (!error || typeof error !== 'object') return undefined;
  if ('code' in error) return error.code;
  if ('driverError' in error) return postgresCode(error.driverError);
  return undefined;
}

export async function withTransactionRetry<T>(
  source: DataSource,
  operation: (manager: EntityManager, attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const {
    maxAttempts = 5,
    baseDelayMs = 20,
    isolation = 'REPEATABLE READ',
    onRetry = (info) =>
      console.log(
        `Retry ${info.attempt}: PostgreSQL ${info.code}, backoff ${info.delayMs} ms`,
      ),
  } = options;
  if (
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 20 ||
    !Number.isFinite(baseDelayMs) ||
    baseDelayMs < 0 ||
    baseDelayMs > 1000
  ) {
    throw new RangeError('Invalid retry limits');
  }
  for (let attempt = 1; ; attempt++) {
    try {
      return await source.transaction(isolation, (manager) =>
        operation(manager, attempt),
      );
    } catch (error) {
      const code = postgresCode(error);
      if ((code !== '40001' && code !== '40P01') || attempt >= maxAttempts)
        throw error;
      const delayMs =
        Math.min(1000, baseDelayMs * 2 ** (attempt - 1)) +
        Math.floor(Math.random() * baseDelayMs);
      onRetry({ code, attempt, delayMs });
      await delay(delayMs);
    }
  }
}
