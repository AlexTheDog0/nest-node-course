import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import type { CreateProductInput, Product, ProductsPage } from './product.js';

type ProductRow = Omit<Product, 'id'> & { id: string };
function toProduct(row: ProductRow): Product {
  const id = Number(row.id);
  if (!Number.isSafeInteger(id))
    throw new RangeError('Product ID exceeds the numeric API contract');
  return { ...row, id };
}

@Injectable()
export class ProductsService {
  constructor(private readonly database: DatabaseService) {}

  async findById(id: number): Promise<Product | undefined> {
    const { rows } = await this.database.query<ProductRow>(
      'SELECT id, name, price_cents, stock FROM products WHERE id=$1',
      [id],
    );
    return rows[0] ? toProduct(rows[0]) : undefined;
  }

  async create(
    input: CreateProductInput,
    key: string,
  ): Promise<{ product: Product; replay: boolean }> {
    const fingerprint = JSON.stringify([
      input.name,
      input.price_cents,
      input.stock,
    ]);
    return this.database.transaction(async (client) => {
      // A conflicting INSERT waits for the first transaction to commit; the next
      // statement sees its response under READ COMMITTED, including across instances.
      const inserted = await client.query(
        `INSERT INTO product_creations(key, fingerprint)
        VALUES ($1, $2) ON CONFLICT (key) DO NOTHING RETURNING key`,
        [key, fingerprint],
      );
      if (!inserted.rowCount) {
        const {
          rows: [previous],
        } = await client.query<{ fingerprint: string; response: Product }>(
          'SELECT fingerprint, response FROM product_creations WHERE key=$1',
          [key],
        );
        if (previous.fingerprint !== fingerprint) {
          throw new UnprocessableEntityException(
            'Idempotency-Key was already used with a different body',
          );
        }
        return { product: previous.response, replay: true };
      }
      const {
        rows: [row],
      } = await client.query<ProductRow>(
        `INSERT INTO products(name, price_cents, stock)
        VALUES ($1, $2, $3) RETURNING id, name, price_cents, stock`,
        [input.name, input.price_cents, input.stock],
      );
      const product = toProduct(row);
      await client.query(
        'UPDATE product_creations SET response=$2::jsonb WHERE key=$1',
        [key, JSON.stringify(product)],
      );
      return { product, replay: false };
    });
  }

  async findPage(limit: number, afterId: number): Promise<ProductsPage> {
    const { rows } = await this.database.query<ProductRow>(
      `SELECT id, name, price_cents, stock
      FROM products WHERE id>$1 ORDER BY id LIMIT $2`,
      [afterId, limit + 1],
    );
    const items = rows.slice(0, limit).map(toProduct);
    const last = items.at(-1);
    return {
      items,
      next_cursor:
        rows.length > limit && last
          ? Buffer.from(String(last.id), 'utf8').toString('base64url')
          : null,
    };
  }
}
