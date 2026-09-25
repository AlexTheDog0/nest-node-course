BEGIN;

CREATE INDEX idx_orders_user_created
    ON orders (user_id, created_at DESC) INCLUDE (id, status);

CREATE INDEX idx_orders_pending_created
    ON orders (created_at, id) INCLUDE (user_id) WHERE status = 'pending';

CREATE INDEX idx_users_lower_email ON users (lower(email));

CREATE INDEX idx_products_search_vector ON products USING GIN (search_vector);

COMMIT;
