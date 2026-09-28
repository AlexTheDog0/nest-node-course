import { setTimeout as delay } from 'node:timers/promises';
import type { DataSource } from 'typeorm';

export interface QueueTask {
  id: string;
  order_id: string;
}
interface WorkerOptions {
  workerCount: number;
  // Optional scope lets demos process only their own jobs.
  orderIds?: string[];
  // Only the returned database result is exactly-once; external effects need idempotency.
  process: (task: QueueTask) => Promise<string>;
}

export async function runWorkers(
  source: DataSource,
  options: WorkerOptions,
): Promise<Record<string, number>> {
  if (!Number.isInteger(options.workerCount) || options.workerCount < 1) {
    throw new RangeError('workerCount must be a positive integer');
  }
  const counts: Record<string, number> = {};
  const scope = options.orderIds ?? null;
  const results = await Promise.allSettled(
    Array.from({ length: options.workerCount }, async (_, index) => {
      const workerId = `worker-${index + 1}`;
      counts[workerId] = 0;
      while (true) {
        const handled = await source.transaction(async (manager) => {
          const [task]: QueueTask[] = await manager.query(
            `SELECT id, order_id FROM jobs
          WHERE status='pending' AND ($1::bigint[] IS NULL OR order_id=ANY($1::bigint[]))
          ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED`,
            [scope],
          );
          if (!task) return false;
          const result = await options.process(task);
          await manager.query(
            `UPDATE jobs SET status='done', processed=processed+1,
          worker_id=$2, result=$3 WHERE id=$1`,
            [task.id, workerId, result],
          );
          return true;
        });
        if (handled) {
          counts[workerId]++;
          continue;
        }
        // An unlocked snapshot still sees pending rows held by another worker.
        const [remaining]: { pending: boolean }[] = await source.query(
          `SELECT EXISTS(
        SELECT 1 FROM jobs WHERE status='pending'
        AND ($1::bigint[] IS NULL OR order_id=ANY($1::bigint[]))) AS pending`,
          [scope],
        );
        if (!remaining.pending) break;
        await delay(10);
      }
    }),
  );
  // Drain every worker before callers clean up fixtures or close the pool.
  for (const result of results)
    if (result.status === 'rejected') throw result.reason;
  return counts;
}
