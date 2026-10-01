import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ProductCreations1790800000000 implements MigrationInterface {
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE product_creations (
      key text PRIMARY KEY,
      fingerprint text NOT NULL,
      response jsonb
    )`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE product_creations');
  }
}
