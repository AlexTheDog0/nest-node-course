import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialMarketplace1790499954883 implements MigrationInterface {
  name = 'InitialMarketplace1790499954883';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "typeorm_metadata"("database", "schema", "table", "type", "name", "value") VALUES (current_database(), $1, $2, $3, $4, $5)`,
      [
        'public',
        'products',
        'GENERATED_COLUMN',
        'search_vector',
        "to_tsvector('simple', name || ' ' || description)",
      ],
    );
    await queryRunner.query(
      `CREATE TABLE "products" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "name" text NOT NULL, "description" text NOT NULL DEFAULT '', "price_cents" integer NOT NULL, "stock" integer NOT NULL DEFAULT '0', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', name || ' ' || description)) STORED, CONSTRAINT "chk_products_stock" CHECK (stock >= 0), CONSTRAINT "chk_products_price" CHECK (price_cents > 0), CONSTRAINT "chk_products_name" CHECK (btrim(name) <> ''), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "order_items" ("order_id" bigint NOT NULL, "product_id" bigint NOT NULL, "quantity" integer NOT NULL, "unit_price_cents" integer NOT NULL, CONSTRAINT "chk_order_items_price" CHECK (unit_price_cents > 0), CONSTRAINT "chk_order_items_quantity" CHECK (quantity > 0), CONSTRAINT "PK_6335813ef19bc35b8d866cc6565" PRIMARY KEY ("order_id", "product_id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "orders" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "user_id" bigint NOT NULL, "status" text NOT NULL DEFAULT 'pending', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "chk_orders_status" CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled')), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "users" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "email" text NOT NULL, "name" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "chk_users_name" CHECK (btrim(name) <> ''), CONSTRAINT "chk_users_email" CHECK (email = btrim(email) AND position('@' IN email) > 1), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" ADD CONSTRAINT "FK_9263386c35b6b242540f9493b00" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "orders" ADD CONSTRAINT "FK_a922b820eeef29ac1c6800e826a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_orders_user_created ON orders (user_id, created_at DESC) INCLUDE (id, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_orders_pending_created ON orders (created_at, id) INCLUDE (user_id) WHERE status = 'pending'`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_users_lower_email ON users (lower(email))`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_products_search_vector ON products USING GIN (search_vector)`,
    );
  }

  // PostgreSQL-specific covering/expression/GIN indexes from homework 12.
  // @Index({ synchronize: false }) keeps subsequent generation from removing them.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "orders" DROP CONSTRAINT "FK_a922b820eeef29ac1c6800e826a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP CONSTRAINT "FK_9263386c35b6b242540f9493b00"`,
    );
    await queryRunner.query(
      `ALTER TABLE "order_items" DROP CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"`,
    );
    await queryRunner.query(`DROP TABLE "users"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP TABLE "order_items"`);
    await queryRunner.query(`DROP TABLE "products"`);
    await queryRunner.query(
      `DELETE FROM "typeorm_metadata" WHERE "type" = $1 AND "name" = $2 AND "database" = current_database() AND "schema" = $3 AND "table" = $4`,
      ['GENERATED_COLUMN', 'search_vector', 'public', 'products'],
    );
  }
}
