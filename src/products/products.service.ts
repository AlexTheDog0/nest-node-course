import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import type { CreateProductInput, Product, ProductsPage } from './product.js';

@Injectable()
export class ProductsService {
  private readonly products: Product[] = [
    { name: 'Nike AirJorand', price_cents: 12300, stock: 12, id: 1 },
  ];
  private readonly creations = new Map<
    string,
    { fingerprint: string; product: Product }
  >();

  findById(id: number): Product | undefined {
    const product = this.products.find((item) => item.id === id);
    return product ? { ...product } : undefined;
  }

  create(
    input: CreateProductInput,
    key: string,
  ): { product: Product; replay: boolean } {
    const fingerprint = JSON.stringify([
      input.name,
      input.price_cents,
      input.stock,
    ]);
    const previous = this.creations.get(key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) {
        throw new UnprocessableEntityException(
          'Idempotency-Key was already used with a different body',
        );
      }
      return { product: { ...previous.product }, replay: true };
    }
    const id =
      this.products.reduce((max, product) => Math.max(max, product.id), 0) + 1;
    const product: Product = {
      id,
      name: input.name,
      price_cents: input.price_cents,
      stock: input.stock,
    };
    this.products.push(product);
    this.creations.set(key, { fingerprint, product: { ...product } });
    return { product: { ...product }, replay: false };
  }

  findPage(limit: number, afterId: number): ProductsPage {
    const candidates = this.products
      .filter((product) => product.id > afterId)
      .sort((a, b) => a.id - b.id);
    const pageCandidates = candidates.slice(0, limit + 1);
    const items = pageCandidates
      .slice(0, limit)
      .map((product) => ({ ...product }));
    const last = items.at(-1);
    const next_cursor =
      pageCandidates.length > limit && last
        ? Buffer.from(String(last.id), 'utf8').toString('base64url')
        : null;
    return { items, next_cursor };
  }
}
