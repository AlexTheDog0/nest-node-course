-- Deterministic data and fixed dates make plans reproducible in future runs.
BEGIN;

INSERT INTO users (email, name, created_at)
SELECT 'customer' || n || '@example.test', 'Покупець ' || n,
       timestamptz '2024-01-01 00:00:00+00' + (n % 365) * interval '1 day'
FROM generate_series(1, 20000) AS g(n);

INSERT INTO products (name, description, price, stock, created_at)
SELECT
    CASE WHEN n % 100 = 0 THEN 'Шкіряні кросівки модель ' || n
         WHEN n % 100 = 1 THEN 'Бігові кросівки модель ' || n
         ELSE (ARRAY['Лляна сорочка', 'Тепла куртка', 'Міський рюкзак',
                     'Настільна лампа', 'Керамічна чашка'])[1 + n % 5] || ' модель ' || n END,
    CASE WHEN n % 100 IN (0, 1)
         THEN 'Зручне взуття для щоденних прогулянок. Міцна підошва та якісні матеріали.'
         ELSE 'Практичний товар для дому та щоденного використання. Українське виробництво, якісні матеріали.' END,
    (10000 + n % 290000)::numeric / 100, n % 200,
    timestamptz '2025-01-01 00:00:00+00' + (n % 365) * interval '1 day'
FROM generate_series(1, 100000) AS g(n);

INSERT INTO orders (user_id, status, created_at)
SELECT 1 + (n * 37 % 20000),
       CASE WHEN n % 100 < 2 THEN 'pending'
            WHEN n % 100 < 10 THEN 'cancelled'
            WHEN n % 100 < 30 THEN 'paid' ELSE 'shipped' END,
       timestamptz '2025-01-01 00:00:00+00' + (n % 365) * interval '1 day'
           + (n % 86400) * interval '1 second'
FROM generate_series(1, 200000) AS g(n);

-- Snapshot the sale price: subsequent catalogue price changes do not alter orders.
INSERT INTO order_items (order_id, product_id, quantity, unit_price)
SELECT o.id, p.id, 1 + o.id % 3, p.price
FROM orders o JOIN products p ON p.id = 1 + (o.id * 13 % 100000);

COMMIT;

VACUUM (ANALYZE);
