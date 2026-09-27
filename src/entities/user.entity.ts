import {
  Check,
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Order } from './order.entity.js';

@Entity('users')
@Check('chk_users_email', `email = btrim(email) AND position('@' IN email) > 1`)
@Check('chk_users_name', `btrim(name) <> ''`)
@Index('idx_users_lower_email', { synchronize: false })
export class User {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string;

  @Column({ type: 'text', unique: true })
  email: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ name: 'created_at', type: 'timestamptz', default: () => 'now()' })
  createdAt: Date;

  @OneToMany(() => Order, (order) => order.user)
  orders: Relation<Order[]>;
}
