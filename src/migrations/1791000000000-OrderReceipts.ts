import type { MigrationInterface, QueryRunner } from 'typeorm';
export class OrderReceipts1791000000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE order_receipts (
      event_id text PRIMARY KEY,
      order_id bigint NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
      payload jsonb NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now()
    )`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE order_receipts');
  }
}
