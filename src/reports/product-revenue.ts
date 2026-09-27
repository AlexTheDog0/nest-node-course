import type { DataSource } from 'typeorm';
import { OrderItem } from '../entities/order-item.entity.js';

export interface ProductRevenue {
  product_id: string;
  product_name: string;
  units_sold: string;
  revenue_cents: string;
}

export async function productRevenue(
  source: DataSource,
): Promise<ProductRevenue[]> {
  return source
    .getRepository(OrderItem)
    .createQueryBuilder('item')
    .innerJoin('item.order', 'order')
    .innerJoin('item.product', 'product')
    .select('product.id', 'product_id')
    .addSelect('product.name', 'product_name')
    .addSelect('SUM(item.quantity)', 'units_sold')
    .addSelect(
      'SUM(item.quantity::bigint * item.unit_price_cents)',
      'revenue_cents',
    )
    .where('order.status IN (:...statuses)', { statuses: ['paid', 'shipped'] })
    .groupBy('product.id')
    .addGroupBy('product.name')
    .orderBy('revenue_cents', 'DESC')
    .addOrderBy('product.id', 'ASC')
    .getRawMany<ProductRevenue>();
}
