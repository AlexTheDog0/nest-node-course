import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Order } from './order.entity.js';
import { Product } from './product.entity.js';

@Entity('order_items')
@Check('chk_order_items_quantity', 'quantity > 0')
@Check('chk_order_items_price', 'unit_price_cents > 0')
export class OrderItem {
  @PrimaryColumn({ name: 'order_id', type: 'bigint' })
  orderId: string;

  @PrimaryColumn({ name: 'product_id', type: 'bigint' })
  productId: string;

  @ManyToOne(() => Order, (order) => order.items, {
    nullable: false,
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'order_id' })
  order: Relation<Order>;

  @ManyToOne(() => Product, (product) => product.orderItems, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'product_id' })
  product: Relation<Product>;

  @Column({ type: 'integer' })
  quantity: number;

  @Column({ name: 'unit_price_cents', type: 'integer' })
  unitPriceCents: number;
}
