import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { Relation } from 'typeorm';
import { Order } from './order.entity.js';

@Entity('jobs')
@Index('idx_jobs_pending', { synchronize: false })
@Check(
  'chk_jobs_state',
  `(status = 'pending' AND processed = 0 AND worker_id IS NULL AND result IS NULL) OR (status = 'done' AND processed = 1 AND worker_id IS NOT NULL AND result IS NOT NULL)`,
)
export class Job {
  @PrimaryGeneratedColumn('identity', {
    type: 'bigint',
    generatedIdentity: 'ALWAYS',
  })
  id: string;

  @Column({ name: 'order_id', type: 'bigint', unique: true })
  orderId: string;

  @ManyToOne(() => Order, { nullable: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id' })
  order: Relation<Order>;

  @Column({ type: 'text', default: 'pending' })
  status: 'pending' | 'done';

  @Column({ type: 'integer', default: 0 })
  processed: number;

  @Column({ name: 'worker_id', type: 'text', nullable: true })
  workerId: string | null;

  @Column({ type: 'text', nullable: true })
  result: string | null;
}
