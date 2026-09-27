import {
  Check,
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { OrderItem } from './order-item.entity.js';

@Entity('products')
@Check('chk_products_name', `btrim(name) <> ''`)
@Check('chk_products_price', 'price_cents > 0')
@Check('chk_products_stock', 'stock >= 0')
@Index('idx_products_search_vector', { synchronize: false })
export class Product {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', default: '' })
  description: string;

  @Column({ name: 'price_cents', type: 'integer' })
  priceCents: number;

  @Column({ type: 'integer', default: 0 })
  stock: number;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @Column({
    name: 'search_vector',
    type: 'tsvector',
    asExpression: "to_tsvector('simple', name || ' ' || description)",
    generatedType: 'STORED',
    nullable: true,
    insert: false,
    update: false,
    select: false,
  })
  searchVector: string | null;

  @OneToMany(() => OrderItem, (item) => item.product)
  orderItems: Relation<OrderItem[]>;
}
