import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { readdir } from 'node:fs/promises';

export async function startDatabase() {
  const container = await new PostgreSqlContainer('postgres:16-alpine').start();
  let source;
  try {
    process.env.DATABASE_URL = container.getConnectionUri();
    process.env.CONFIG_SOURCE = 'environment';
    process.env.PORT = '9999';
    const { dataSource } = await import('../../../dist/data-source.js');
    // Import in this Jest environment; TypeORM's eval-based glob loader can retain
    // the previous test file's VM context after Jest has disposed it.
    const directory = new URL('../../../dist/migrations/', import.meta.url);
    const files = (await readdir(directory))
      .filter((file) => file.endsWith('.js'))
      .sort();
    const migrations = (
      await Promise.all(
        files.map((file) => import(new URL(file, directory).href)),
      )
    ).flatMap((module) => Object.values(module));
    source = new DataSource({
      ...dataSource.options,
      migrations,
      url: container.getConnectionUri(),
    });
    await source.initialize();
    await source.runMigrations();
    return {
      source,
      async reset() {
        await source.query(
          'TRUNCATE product_creations, jobs, order_items, orders, products, users RESTART IDENTITY CASCADE',
        );
      },
      async close() {
        try {
          await source.destroy();
        } finally {
          await container.stop();
        }
      },
    };
  } catch (error) {
    try {
      if (source?.isInitialized) await source.destroy();
    } finally {
      await container.stop();
    }
    throw error;
  }
}
