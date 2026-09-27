import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { User } from './user.entity.js';
import { OrderItem } from './order-item.entity.js';

export type OrderStatus = 'pending' | 'paid' | 'shipped' | 'cancelled';

@Entity('orders')
@Check(
  'chk_orders_status',
  "status IN ('pending', 'paid', 'shipped', 'cancelled')",
)
@Index('idx_orders_user_created', { synchronize: false })
@Index('idx_orders_pending_created', { synchronize: false })
export class Order {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: string;

  @ManyToOne(() => User, (user) => user.orders, {
    nullable: false,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'user_id' })
  user: Relation<User>;

  @Column({ type: 'text', default: 'pending' })
  status: OrderStatus;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @OneToMany(() => OrderItem, (item) => item.order)
  items: Relation<OrderItem[]>;
}
