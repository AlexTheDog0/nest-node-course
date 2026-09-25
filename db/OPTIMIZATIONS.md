# PostgreSQL: результати оптимізації

Виміряно 2026-09-25 у Docker, PostgreSQL 17.10 (Debian), aarch64.
Чиста БД → schema → seed → VACUUM (ANALYZE) → плани до → indexes → ANALYZE → плани після. Після індексів кожен запит виконано тричі; нижче останній план. Налаштування планера не змінювалися. Це локальні виміри прогрітого стенда, а не гарантія production latency.

Дані: users — 20 000; products — 100 000; orders та order_items — по 200 000. Статуси замовлень: shipped 70%, paid 20%, cancelled 8%, pending 2%. Пошук «шкіряні кросівки» повертає 1000 кандидатів (1% каталогу), LIMIT — 20.

| Запит | До, мс | Після, мс | Прискорення | Execution buffers, shared hit, до → після |
| --- | ---: | ---: | ---: | --- |
| q1 | 7.170 | 0.053 | 135.3× | 1524 → 7 |
| q2 | 7.574 | 0.059 | 128.4× | 1532 → 3 |
| q3 | 6.193 | 0.025 | 247.7× | 238 → 3 |
| q4 | 14.651 | 2.183 | 6.7× | 7699 → 1014 |

## q1

`idx_orders_user_created` замінив Parallel Seq Scan, Sort і Gather Merge на Index Only Scan: рівність за user_id та діапазон часу звужують читання, порядок ключів прибирає сортування, INCLUDE разом із visibility map після VACUUM забезпечують Heap Fetches: 0.

До:

```text
Gather Merge  (cost=4545.91..4546.60 rows=6 width=23) (actual time=6.109..7.137 rows=10 loops=1)
  Workers Planned: 1
  Workers Launched: 1
  Buffers: shared hit=1524
  ->  Sort  (cost=3545.90..3545.92 rows=6 width=23) (actual time=5.234..5.234 rows=5 loops=2)
        Sort Key: created_at DESC
        Sort Method: quicksort  Memory: 25kB
        Buffers: shared hit=1524
        Worker 0:  Sort Method: quicksort  Memory: 25kB
        ->  Parallel Seq Scan on orders  (cost=0.00..3545.82 rows=6 width=23) (actual time=0.440..5.206 rows=5 loops=2)
              Filter: ((created_at >= '2025-01-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2026-01-01 00:00:00+00'::timestamp with time zone) AND (user_id = 42))
              Rows Removed by Filter: 99995
              Buffers: shared hit=1487
Planning:
  Buffers: shared hit=97
Planning Time: 0.163 ms
Execution Time: 7.170 ms
```

Після:

```text
Index Only Scan using idx_orders_user_created on orders  (cost=0.42..4.64 rows=10 width=23) (actual time=0.033..0.034 rows=10 loops=1)
  Index Cond: ((user_id = 42) AND (created_at >= '2025-01-01 00:00:00+00'::timestamp with time zone) AND (created_at < '2026-01-01 00:00:00+00'::timestamp with time zone))
  Heap Fetches: 0
  Buffers: shared hit=7
Planning:
  Buffers: shared hit=149
Planning Time: 0.244 ms
Execution Time: 0.053 ms
```

## q2

`idx_orders_pending_created` замінив Parallel Seq Scan і сортування на Index Only Scan: partial-індекс містить лише pending, читається в потрібному порядку й зупиняється після 100 рядків; Heap Fetches: 0.

До:

```text
Limit  (cost=4332.40..4343.90 rows=100 width=24) (actual time=6.449..7.545 rows=100 loops=1)
  Buffers: shared hit=1532
  ->  Gather Merge  (cost=4332.40..4575.16 rows=2111 width=24) (actual time=6.447..7.529 rows=100 loops=1)
        Workers Planned: 1
        Workers Launched: 1
        Buffers: shared hit=1532
        ->  Sort  (cost=3332.39..3337.66 rows=2111 width=24) (actual time=5.521..5.525 rows=82 loops=2)
              Sort Key: created_at, id
              Sort Method: top-N heapsort  Memory: 36kB
              Buffers: shared hit=1532
              Worker 0:  Sort Method: top-N heapsort  Memory: 36kB
              ->  Parallel Seq Scan on orders  (cost=0.00..3251.71 rows=2111 width=24) (actual time=0.007..5.318 rows=1836 loops=2)
                    Filter: ((created_at < '2025-12-01 00:00:00+00'::timestamp with time zone) AND (status = 'pending'::text))
                    Rows Removed by Filter: 98164
                    Buffers: shared hit=1487
Planning:
  Buffers: shared hit=91
Planning Time: 0.188 ms
Execution Time: 7.574 ms
```

Після:

```text
Limit  (cost=0.28..4.26 rows=100 width=24) (actual time=0.027..0.038 rows=100 loops=1)
  Buffers: shared hit=3
  ->  Index Only Scan using idx_orders_pending_created on orders  (cost=0.28..150.24 rows=3769 width=24) (actual time=0.025..0.032 rows=100 loops=1)
        Index Cond: (created_at < '2025-12-01 00:00:00+00'::timestamp with time zone)
        Heap Fetches: 0
        Buffers: shared hit=3
Planning:
  Buffers: shared hit=137
Planning Time: 0.354 ms
Execution Time: 0.059 ms
```

## q3

`idx_users_lower_email` замінив Seq Scan на Index Scan, оскільки expression-індекс відповідає lower(email) у предикаті; звичайний UNIQUE(email) цей пошук не оптимізує.

До:

```text
Seq Scan on users  (cost=0.00..538.00 rows=100 width=56) (actual time=0.388..6.183 rows=1 loops=1)
  Filter: (lower(email) = 'customer1234@example.test'::text)
  Rows Removed by Filter: 19999
  Buffers: shared hit=238
Planning:
  Buffers: shared hit=84
Planning Time: 0.193 ms
Execution Time: 6.193 ms
```

Після:

```text
Index Scan using idx_users_lower_email on users  (cost=0.29..8.30 rows=1 width=56) (actual time=0.013..0.013 rows=1 loops=1)
  Index Cond: (lower(email) = 'customer1234@example.test'::text)
  Buffers: shared hit=3
Planning:
  Buffers: shared hit=104
Planning Time: 0.240 ms
Execution Time: 0.025 ms
```

## q4

`idx_products_search_vector` замінив Seq Scan на Bitmap Index Scan + Bitmap Heap Scan: GIN знаходить 1000 кандидатів, а heap читається лише для цих товарів; top-N Sort лишився, бо GIN не впорядковує результати за ts_rank.

До:

```text
Limit  (cost=8943.42..8943.47 rows=18 width=58) (actual time=14.614..14.618 rows=20 loops=1)
  Buffers: shared hit=7699
  ->  Sort  (cost=8943.42..8943.47 rows=18 width=58) (actual time=14.611..14.613 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 27kB
        Buffers: shared hit=7699
        ->  Seq Scan on products  (cost=0.00..8943.05 rows=18 width=58) (actual time=0.033..14.462 rows=1000 loops=1)
              Filter: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Rows Removed by Filter: 99000
              Buffers: shared hit=7693
Planning:
  Buffers: shared hit=96
Planning Time: 0.204 ms
Execution Time: 14.651 ms
```

Після:

```text
Limit  (cost=119.26..119.31 rows=20 width=58) (actual time=2.157..2.160 rows=20 loops=1)
  Buffers: shared hit=1014
  ->  Sort  (cost=119.26..119.32 rows=23 width=58) (actual time=2.157..2.158 rows=20 loops=1)
        Sort Key: (ts_rank(search_vector, '''шкіряні'' & ''кросівки'''::tsquery)) DESC, id
        Sort Method: top-N heapsort  Memory: 27kB
        Buffers: shared hit=1014
        ->  Bitmap Heap Scan on products  (cost=30.17..118.74 rows=23 width=58) (actual time=0.235..2.016 rows=1000 loops=1)
              Recheck Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
              Heap Blocks: exact=1000
              Buffers: shared hit=1008
              ->  Bitmap Index Scan on idx_products_search_vector  (cost=0.00..30.16 rows=23 width=0) (actual time=0.145..0.145 rows=1000 loops=1)
                    Index Cond: (search_vector @@ '''шкіряні'' & ''кросівки'''::tsquery)
                    Buffers: shared hit=8
Planning:
  Buffers: shared hit=121
Planning Time: 0.258 ms
Execution Time: 2.183 ms
```

## Морфологія

`кросівки` → **2000** збігів; `кросівок` → **0** збігів. Конфігурація `simple` нормалізує регістр, але не зводить українські словоформи до спільної лексеми.

```sql
SELECT count(*) FROM products WHERE search_vector @@ plainto_tsquery('simple', 'кросівки');
SELECT count(*) FROM products WHERE search_vector @@ plainto_tsquery('simple', 'кросівок');
SELECT count(*) FROM pg_ts_config;
```

У цій БД **29** конфігурацій; перегляд `pg_ts_config` / `\dF` не показує української. Заміна на `russian` не додає української морфології.

## Вартість збереженого tsvector

На тимчасовій копії тих самих 100 000 товарів без індексів `pg_total_relation_size` до додавання generated-колонки — **29 368 320 байтів**, після — **63 447 040 байтів** (приблизно **2,16×**). Обидва значення включають TOAST; GIN у цей вимір не входить. Це контрольована копія, тому в основній схемі колонка була присутня ще до EXPLAIN «до». Обчислення вектора додає роботу під час INSERT та зміни назви/опису; окремий INSERT benchmark не проводився.

```sql
BEGIN;
CREATE TEMP TABLE products_size_probe AS
SELECT id, name, description, price, stock, created_at FROM products;
SELECT pg_total_relation_size('products_size_probe');
ALTER TABLE products_size_probe ADD COLUMN search_vector tsvector
GENERATED ALWAYS AS (to_tsvector('simple', name || ' ' || description)) STORED;
SELECT pg_total_relation_size('products_size_probe');
ROLLBACK;
```

## Межі й відтворення

Запуск: див. розділ ДЗ №12 у README та `python3 scripts/check-db.py`. Усі чотири індекси мають idx_scan > 0; додаткових індексів «про запас» немає. PK/UNIQUE підтримують цілісність і не входять до цієї перевірки. q4 прискорився менше за B-tree-запити: потрібні читання 1000 heap-сторінок і ранжування кандидатів.

Схема використовує ціну продажу в order_items як snapshot; загальну суму можна обчислити як SUM(quantity * unit_price), без дублювання агрегату в orders. Видалення пов’язаних записів обмежують FK. Регістр email не впливає на q3, але UNIQUE(email) залишається чутливим до регістру; глобальна нормалізація email при реєстрації — окрема вимога майбутнього API.

Підключення застосунку тепер реалізоване через локальний Infisical: DB_URL зберігається в dev/prod, включений у Zod-контракт і .env.example. Перевірка `npm run check:infisical` підтвердила підключення до цих самих наповнених таблиць в обох оточеннях, read-only права застосунку та роботу після ротації без рестарту. Деталі — у Configuration README. Нових env-файлів із DB_URL не створено; ігнорований server.env містить лише bootstrap-конфігурацію самого Infisical.

Фактична перевірка ротації Infisical 2026-09-25: `/health` повернув HTTP 200 до й після.
Uptime `dev`: 0,443 → 1,705 с; `prod`: 0,434 → 1,100 с. Обидва процеси
залишилися запущеними під час зміни пароля; identity застосунку отримала HTTP 403
на спробу редагування секрету. Тестові процеси після перевірки зупинено.

Перевірка чистої копії: локальний `git clone --local --branch hw-12` у порожню
теку `/tmp`, поверх — поточні незакомічені README, Compose, db/ та check-db.py.
`.env` і `secrets/` відсутні. Для паралельного запуску використано окреме ім’я
Compose-проєкту `marketplace-hw12-clean-check`; конфігурація сервісу та креденшели
ідентичні команді README. `SELECT 1` повернув `1`, весь `check-db.py` завершився
з кодом 0. Це перевірка вмісту робочого дерева без локальних секретів, а не
підтвердження публікації віддаленої гілки: комітів і push не було.

Додатково: точний запит грейдера для partial/expression повернув **2**;
запит невикористаних індексів — порожній результат; у звіті **8** рядків
`Execution Time`. `npm run check:env` (включає TypeScript build) завершився
з кодом 0. Скрипт перевірив три FK, CHECK/NOT NULL, зокрема відхилення
негативної ціни, NaN, від’ємного залишку й нульової кількості.
