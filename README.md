# Архітектурна записка курсового проєкту: Marketplace API

## Data layer ops — ДЗ №15

`docker compose up -d --wait` піднімає PostgreSQL 17 і PgBouncer 1.25.2.
Застосунок/ORM підключається до `127.0.0.1:6432`; прямий порт PostgreSQL 5434
залишається лише для локального адміністрування. Конфіг —
`pgbouncer/pgbouncer.ini`, `pool_mode = transaction`, `default_pool_size = 5`,
`max_client_conn = 200`, `admin_users = app`. Пароль у userlist.txt — відкритий
дев-пароль цього Compose, не production-секрет.

Transaction mode повертає серверне з’єднання в пул після COMMIT/ROLLBACK:
багато клієнтів ділять 5 backend-з’єднань, а транзакція checkout залишається на
одному backend. Не можна покладатися на session-level SET, LISTEN, session
advisory locks та тимчасові таблиці, що мають пережити транзакцію. SQL
PREPARE/DEALLOCATE також несумісні; protocol-level named prepared statements
підтримуються налаштуванням `max_prepared_statements = 200` у цій версії.
Деталі: [офіційна матриця PgBouncer](https://www.pgbouncer.org/features.html).

Наявна команда `npm run infisical:setup:orm` оновлює DB_URL у локальних
навчальних dev/prod: `/hw13` для ORM-обгортки та `/` для Nest launcher.
Після зміни адреси запущений Nest потрібно перезапустити. Обидва оточення
навчальні; команда використовує дев-креденшели Compose. Нових env-файлів немає,
`.env.example` містить лише контракт із фейковим паролем. Для основного шляху
потрібні запущене локальне сховище й Infisical CLI, як у ДЗ13.

```bash
npm run infisical:setup:orm
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

Backup створює `backups/marketplace-<UTC-дата>-<pid>.dump` через `pg_dump -Fc`.
Поруч зберігає `.checks.sql` і `.expected.txt`: кількість рядків кожної таблиці
public та `sum(price_cents * stock)` для products. Дамп і контрольні значення
беруться з одного REPEATABLE READ snapshot через `pg_export_snapshot()` і
`pg_dump --snapshot`; після backup поточна БД може змінюватись. Архів публікується
лише після успіху pg_dump. [Параметри pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).
Тримай три файли одного backup разом. `BACKUP_DIR` може перевизначити локальну
теку; за замовчуванням `backups/` ігнорується Git. Це локальний backup на хості,
він не захищає від втрати самого диска хоста.

Restore-drill бере останній завершений дамп, створює новий контейнер
PostgreSQL з порожнім tmpfs, без мережі й опублікованих портів, виконує
`pg_restore --no-owner --no-acl --exit-on-error`, порівнює контрольні значення
та друкує MATCH. Контейнер і його тимчасове сховище видаляються після успіху
або помилки; джерельна БД не змінюється. На ще не мігрованій порожній БД
перевіряється порожня схема; змістовний drill курсового виконуй після migrate/seed.
Фактичний протокол: [RESTORE-DRILL.md](RESTORE-DRILL.md).

Скрипти потребують Bash, Docker Compose v2 і Node.js; PostgreSQL-клієнти беруть
із контейнера `db`, тому локальні pg_dump/pg_restore не обов’язкові. URL до
`127.0.0.1:6432` або `localhost:6432` всередині клієнтського контейнера
перетворюється на `pgbouncer:5432`; пароль і назва БД зберігаються.

`backup.cron` задає запуск щодня о 02:00 у часовому поясі хоста. Для встановлення
заміни `/absolute/path/to/repo` своїм шляхом і додай рядок через `crontab -e`,
перевіривши PATH до Docker/Node/Infisical. Cron автоматично не встановлюється.
RPO при успішних щоденних backup — до 24 годин; пропущені запуски збільшують його.

Адмін-консоль (дев-пароль із Compose):

```bash
PGPASSWORD=homework-development-only psql -h 127.0.0.1 -p 6432 -U app -d marketplace -c 'SELECT 1'
PGPASSWORD=homework-development-only psql -h 127.0.0.1 -p 6432 -U app -d pgbouncer -c 'SHOW POOLS'
# Якщо psql немає на хості:
docker compose exec -T -e PGPASSWORD=homework-development-only pgbouncer psql -h 127.0.0.1 -U app -d pgbouncer -c 'SHOW POOLS'
```

## ДЗ №14 — Конкурентність

Checkout у `src/transactions/checkout.ts` в одній транзакції зменшує stock,
списує баланс у копійках, створює paid-замовлення, його позицію та задачу.
Недостатній stock або баланс відхиляє всю операцію. Нова міграція
`1790600000000-CheckoutQueue.ts` додає `users.balance_cents` і таблицю `jobs`;
`synchronize: false` збережено. `bigint` суми та ID представлені рядками,
обчислення вартості виконуються через `BigInt`.

Обрано атомарний `UPDATE … WHERE stock >= quantity RETURNING`, а для балансу —
аналогічний умовний UPDATE. PostgreSQL перевіряє умову та змінює значення під
блокуванням рядка; немає проміжку між читанням і записом у JavaScript.
`SELECT FOR UPDATE` також коректний, але для одного товару й простого декременту
потребував би окремого читання. Ціна береться з того самого RETURNING.
Усі запити йдуть через manager однієї транзакції, не через загальний пул.

Воркери тримають `FOR UPDATE SKIP LOCKED` до завершення обробки. Результат,
`status=done`, `worker_id` і `processed=processed+1` комітяться разом.
Якщо вільної задачі немає, воркер перевіряє наявність pending-рядків і повторює
пошук: вони можуть бути заблоковані іншим воркером. Частковий індекс
`idx_jobs_pending` індексує лише чергу очікування. Падіння до COMMIT відкочує
результат і звільняє задачу; повторний запуск підбере її. Гарантія «рівно один
раз» стосується закоміченого результату в БД. Реальний email/API-виклик потребує
ідемпотентного одержувача; демо зберігає текст чека, не надсилає листи.

Retry повторює **всю транзакцію разом із читаннями**, лише для PostgreSQL
`40001` (serialization failure) та `40P01` (deadlock): обидва означають, що
транзакцію скасовано через конкуренцію. Помилки валідації, обмежень, доступу
або невідомий результат COMMIT не можна сліпо повторювати. Ліміт — 5 спроб,
експоненційний backoff із jitter; кожен повтор логується. Демо через бар’єр
гарантує два початкові знімки `REPEATABLE READ`, тому конфлікт відтворюється.

Фактичний запуск 28.09.2026 (Node.js 24, PostgreSQL 17):

| Демо | Результат |
| --- | --- |
| `demo:race` | 50 спроб, 10 успішних, stock 0, від’ємних рядків 0 |
| `demo:workers` | 12 задач; 3 воркери по 4; 444.1 ms проти ≥1200 ms послідовно; оброблено двічі: 0 |
| `demo:retry` | 1 повтор із 40001; баланс 100 + 1 + 1 = 102 |

Демо незалежні: створюють власних покупців із надлишковим балансом і товари,
перевіряють інваріанти через assert та прибирають лише власні записи у finally.
Всі 50 checkout запускаються через `Promise.all` без черги застосунку;
пул PostgreSQL може обмежувати кількість одночасних з’єднань. Звичайний seed
також задає новим покупцям баланс 1 000 000 копійок, не поповнюючи існуючих.

| Файли | Призначення |
| --- | --- |
| `src/transactions/checkout.ts` | Транзакційна бізнес-операція |
| `src/transactions/workers.ts` | Пул воркерів із SKIP LOCKED |
| `src/transactions/retry.ts` | Обмежений retry транзакцій |
| `src/demos/{race,workers,retry,fixture}.ts` | Самоперевірні демо та ізольовані дані |
| `src/entities/job.entity.ts`, `src/migrations/1790600000000-CheckoutQueue.ts` | Черга та міграція |
| `test/transactions/` | Rollback, баланс, bigint, відновлення воркера, коди retry |

## ДЗ №13 — TypeORM

Чотири entities у `src/entities/` відтворюють таблиці ДЗ №12: `users`,
`products`, `orders`, `order_items`. `OrderItem` — явна M:N-сутність із кількістю
й історичною ціною, складеним PK `(order_id, product_id)`. Усі bigint ID — рядки,
щоб не втрачати точність JavaScript. Nullable, CHECK, defaults, identity,
generated `search_vector` і всі чотири індекси SQL-схеми збережені.

Свідома зміна порівняно з ДЗ №12: `price numeric(12,2)` → `price_cents integer`,
`unit_price numeric(12,2)` → `unit_price_cents integer`, одиниця — копійка.
Це початкова міграція **для чистої БД**, а не конвертація заповненої HW12-бази.
SQL-файли в `db/` залишаються історичним стендом ДЗ №12.
ORM-шар не змінює наявний HTTP API з товарами в пам’яті.

Структура:

| Шлях | Призначення |
| --- | --- |
| `src/entities/` | User, Product, Order, OrderItem та relations |
| `src/migrations/` | Згенерована й перевірена початкова міграція, робочий down |
| `src/data-source.ts` | Лише process.env, synchronize: false |
| `src/seed.ts` | Транзакційний детермінований повторюваний seed |
| `src/demo-nplus1.ts` | SQL-лог, лічильник, порівняння результатів до/після |
| `src/report.ts`, `src/reports/product-revenue.ts` | Виторг по товарах через QueryBuilder |
| `scripts/with-secrets.sh` | Infisical CLI та SKIP_VAULT для CI/грейдера |
| `test/orm/` | Перевірка seed, звіту, relations, обмежень і обгортки |

## Grading

Потрібні Node.js 22.22.3+ (або 24.15+), npm, Docker Compose v2.
Виконувати в корені свіжого клону; `.env`, `.secrets/`, `secrets/` та Infisical CLI
для цього сценарію не потрібні. Порти 5434 і 6432 мають бути вільними.
Compose має власний volume і healthcheck; дев-креденшели не є секретом.

```bash
docker compose up -d --wait

export DATABASE_URL=postgres://app:homework-development-only@127.0.0.1:6432/marketplace

export SKIP_VAULT=1    # у грейдера немає доступу до сховища
```

Скрипти читають DATABASE_URL (або DB_URL) із середовища; обгортка під
SKIP_VAULT=1 лише передає його. DATABASE_URL має пріоритет в ORM і ops-скриптах.
Після export вище мінімальна перевірка ДЗ15 — ці дві команди (навіть на порожній БД):

```bash
bash scripts/with-secrets.sh dev bash scripts/backup.sh
bash scripts/with-secrets.sh dev bash scripts/restore-drill.sh
```

Для перевірки на даних курсового спочатку виконай migrate/seed нижче, потім
повтори backup/drill. Додаткові перевірки ДЗ13/14 наведено для регресії.
`test:orm` історично читає DB_URL, тому для нього передай `DB_URL="$DATABASE_URL"`.

```bash
npm ci && npx tsc --noEmit
npm run build
npm run migrate
npm run migrate:show
npm run migrate:revert
npm run migrate
npm run seed && npm run seed
npm run demo:nplus1
npm run report
DB_URL="$DATABASE_URL" npm run test:orm
npm run test:transactions
npm run demo:race
npm run demo:workers
npm run demo:retry
npm test
npm run lint
```

Після migrate застосовані дві міграції: `InitialMarketplace1790499954883`
та `CheckoutQueue1790600000000`. Один `migrate:revert` відкочує лише останню:
видаляє jobs і balance_cents, зберігає таблиці ДЗ13. Це також видаляє дані черги
та балансів; команда вище призначена для чистого навчального стенда до seed.
Повторний migrate відновлює структуру. `test:orm` перевіряє точні fixture-дані
ДЗ13, нові демо після завершення залишають їх незмінними.

Нові демо, як migrate/seed, починаються з `bash scripts/with-secrets.sh dev`:
звичайний шлях — чинне сховище Infisical `/hw13`, шлях грейдера — `SKIP_VAULT=1`
і DATABASE_URL з Compose. Нових env-файлів чи змін обгортки немає.

Після **кожного** запуску seed кількість однакова — 10 / 10 / 10 / 20:

```bash
docker compose exec -T db psql -X -U app -d marketplace -c 'SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM products) AS products, (SELECT count(*) FROM orders) AS orders, (SELECT count(*) FROM order_items) AS order_items;'
```

Статичні перевірки з умови:

```bash
grep -rn "synchronize" src/
grep -rn "onDelete" src/
grep -rniE "\.(add)?groupBy\(" src/
node -e "const s=require('./package.json').scripts;const bad=['migrate','seed'].filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));process.exit(bad.length===0?0:1)"
```

Статичні критерії ДЗ14 (із кореня репозиторію):

```bash
grep -rniE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist "for update|returning|pessimistic_write" .
grep -rniE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist "skip[ _]locked" .
grep -rniE --include='*.ts' --exclude-dir=node_modules --exclude-dir=dist "40001|40P01" .
node -e "const s=require('./package.json').scripts;const bad=['demo:race','demo:workers','demo:retry'].filter(k=>/with-secrets\.sh/.test(s[k]||'')===false);console.log(bad.length===0?'OK':'без обгортки: '+bad.join(', '));process.exit(bad.length===0?0:1)"
```

Докази запусків: [docs/HW14-VERIFICATION.md](docs/HW14-VERIFICATION.md).

### N+1: фактичні виміри

Граф: `orders → items → product`, два рівні, по дві позиції на замовлення.
Наївно: 1 запит списку + N запитів позицій + 2N запитів товарів = 1 + 3N.
JOIN завантажує той самий граф одним запитом; скрипт перевіряє рівність результатів.

| N | До (запити в циклах) | Після (leftJoinAndSelect) |
| --- | --- | --- |
| 5 | 16 | 1 |
| 10 | 31 | 1 |

Лічильник скидається після initialize і перед кожною вибіркою. SQL друкується
через logger із `logging: ['query']`; службові запити відкриття з’єднання
не входять у вимір. Вибірка обмежена предикатом ID, тому JOIN не додає
окремого запиту pagination. Seed резервує ID 1..10; демо виконується після seed.
Стратегія `relationLoadStrategy: 'query'` не використовується.

### Repository, QueryBuilder, onDelete

Repository застосовуємо для простих CRUD і вибірок entities зі зв’язками.
QueryBuilder застосовуємо для контрольованих JOIN та агрегатів із GROUP BY,
які не виразити через `find()`; звіт використовує `getRawMany()`.
Виторг враховує лише `paid`/`shipped`, бере історичний `unit_price_cents`,
а не поточну ціну товару; множення виконується як bigint, SUM/COUNT лишаються
рядками. Наприклад, Product 01: 3 одиниці, 3000 копійок; увесь звіт — 25700 копійок.

- `orders.user_id → users`: RESTRICT захищає історію замовлень клієнта.
- `order_items.product_id → products`: RESTRICT захищає посилання на придбаний товар.
- `order_items.order_id → orders`: CASCADE прибирає позиції разом із замовленням.

### Міграції та seed

Початкову міграцію отримано на порожній БД командою:

```bash
npm run build
npm run migration:generate -- src/migrations/InitialMarketplace
npm run build
```

Це історія генерації: **не повторюй** її поруч із готовою початковою міграцією.
Для наступної зміни спочатку застосуй наявні міграції, зміни entities,
збери код і генеруй міграцію з новою назвою.
Генератор перевірено вручну: додано covering/partial/expression/GIN індекси
ДЗ №12, прибрано прив’язку metadata до конкретної назви БД.
Їхні `@Index(..., { synchronize: false })` не дозволяють генератору видалити
ручні індекси. `schema:log` після міграції не знаходить відмінностей.
Про складні індекси: [офіційна документація TypeORM](https://typeorm.io/docs/advanced-topics/indices/).

Seed має фіксовані значення й дати, `ON CONFLICT (PK) DO NOTHING` та транзакцію.
Другий запуск не дублює і не перезаписує рядки. Identity sequences після явних
ID просуваються щонайменше до max(id), тому наступні INSERT без ID працюють.
Це fixture для навчальної БД, не production seed.

### Основний запуск через сховище ДЗ №11

Встанови [офіційний Infisical CLI](https://infisical.com/docs/cli/overview).
Сховище та machine identity використовуються ті самі, що в ДЗ №11–12.
Папка `/hw13` зберігає DB_URL ORM-стенда. Починаючи з ДЗ15, setup оновлює
також root DB_URL для Nest; історичні команди ротації ДЗ12 більше не застосовуються.

```bash
docker compose up -d --wait
npm run infisical:up
npm run infisical:setup
npm run infisical:setup:orm
unset SKIP_VAULT
npm run build
npm run migrate
npm run seed
npm run demo:nplus1
npm run report
```

`with-secrets.sh` читає наявні `secrets/infisical/client.json` і `app-token`,
викликає `infisical run --env=dev --path=/hw13 -- …`; CLI наповнює process.env.
DataSource не читає env-файлів і не імпортує Nest ConfigModule.
Для іншого сховища можна передати INFISICAL_TOKEN, INFISICAL_PROJECT_ID,
INFISICAL_API_URL, INFISICAL_SECRET_PATH через оточення або ігнорований
`.secrets/infisical.env` (лише параметри доступу до сховища, не DB-креденшели).
SKIP_VAULT обробляється після відокремлення `dev` та до читання файлів/виклику CLI.
Про ін’єкцію: [infisical run](https://infisical.com/docs/cli/commands/run).

## ДЗ №12 — PostgreSQL: схема, індекси та пошук

Для перевірки ДЗ №12 потрібні Docker Compose v2 і Python 3. Використовуй окремий
`docker-compose.hw12.yml`: PostgreSQL 17, власний volume, порт `127.0.0.1:5433`,
без залежності від `.env` та локального файла секретів. Це ізольований навчальний стенд; попередній Compose із файловим секретом збережено як
`docker-compose.file-secrets.yml`; стандартний `docker-compose.yml` тепер належить ДЗ №13.
Усі команди нижче — з кореня репозиторію.

Підняти базу (працює зі свіжого клону):
```bash
docker compose -f docker-compose.hw12.yml up -d --wait
```

Підключитись:
```bash
docker compose -f docker-compose.hw12.yml exec db psql -X -U app -d marketplace
```

Всередині `psql` команда `SELECT 1;` повертає `1`; `\q` завершує сесію.
Креденшели стенда: `app` / `homework-development-only`, база `marketplace`.
Вони демонстраційні, записані в Compose й не призначені для production.

Головна таблиця — **orders** (200 000 рядків), таблиця пошуку q4 — **products**
(100 000 рядків). Також є `users` (20 000) і `order_items` (200 000), три FK.
Ціна в SQL — `numeric(12,2)` у гривнях; HTTP-контракт попереднього етапу
з `price_cents` залишається без змін, майбутній DB-адаптер має конвертувати одиниці.
Товари API поки зберігаються в пам’яті: це ДЗ готує дата-шар для наступних етапів.

Повний автоматичний цикл на **порожній** базі:
```bash
python3 scripts/check-db.py
```

Скрипт застосовує `schema.sql`, `seed.sql`, знімає чотири плани до індексів,
застосовує `indexes.sql`, виконує `ANALYZE` та знімає кожен план тричі.
Перевіряє Seq Scan до / відсутність після, імена й використання всіх індексів,
обсяг, FK, partial/expression, GIN по tsvector, однакові результати запитів,
морфологію, оновлення generated-колонки та відхилення некоректних даних.
Повні плани зберігаються в ігнорованій теці `tmp/hw12/`.
Повторний запуск на непорожній базі навмисно відхиляється.

Для повторення з нуля видали **лише дані навчального стенда ДЗ №12**:
```bash
docker compose -f docker-compose.hw12.yml down -v
```
Після цього повтори команди підняття та автоматичної перевірки вище.

Ручний еквівалент циклу на порожній БД:
```bash
docker compose -f docker-compose.hw12.yml exec -T db psql -X -v ON_ERROR_STOP=1 -U app -d marketplace < db/schema.sql
docker compose -f docker-compose.hw12.yml exec -T db psql -X -v ON_ERROR_STOP=1 -U app -d marketplace < db/seed.sql
for n in 1 2 3 4; do docker compose -f docker-compose.hw12.yml exec -T db psql -X -v ON_ERROR_STOP=1 -U app -d marketplace -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q$n.sql)"; done
docker compose -f docker-compose.hw12.yml exec -T db psql -X -v ON_ERROR_STOP=1 -U app -d marketplace < db/indexes.sql
docker compose -f docker-compose.hw12.yml exec -T db psql -X -v ON_ERROR_STOP=1 -U app -d marketplace -c 'ANALYZE;'
for pass in 1 2 3; do for n in 1 2 3 4; do docker compose -f docker-compose.hw12.yml exec -T db psql -X -v ON_ERROR_STOP=1 -U app -d marketplace -c "EXPLAIN (ANALYZE, BUFFERS) $(cat db/queries/q$n.sql)"; done; done
```

Виміри та пояснення: [db/OPTIMIZATIONS.md](db/OPTIMIZATIONS.md).

**Підключення застосунку:** сховище секретів
із `dev` / `prod` реалізовано через локальний Infisical — див. розділ
Configuration нижче. Для грейдера SQL-стенд запускається незалежно від Infisical.

Перевірка ДЗ №12 у копії без `.env`, `secrets/` і `node_modules/` описана у звіті.

Цей репозиторій містить наскрізний курсовий проєкт — сервіс **Marketplace API**, спроєктований відповідно до вимог надійності, масштабованості та контрактної специфікації.

---

## 1. Що це за сервіс

**Marketplace API** — це бекенд-платформа для простого інтернет-магазину (маркетплейсу). Сервіс вирішує проблему швидкого та зручного замовлення фізичних товарів клієнтами, а також автоматизує контроль залишків на складах та інформування покупців про статус їхніх покупок. Адміністратори платформи мають можливість гнучко керувати асортиментом та відстежувати транзакції.

### User Stories (Сценарії користувачів):
1. **Як гість**, я хочу переглядати каталог товарів з актуальними цінами, фільтрами та фотографіями, щоб обрати потрібні позиції.
2. **Як клієнт**, я хочу оформити замовлення, додавши декілька товарів у кошик, та ініціювати оплату, щоб зарезервувати товар на складі.
3. **Як клієнт**, я хочу отримати лист-підтвердження на електронну пошту після успішної оплати замовлення, щоб переконатися в його відправці.
4. **Як адміністратор**, я хочу додавати нові товари, завантажувати їхні зображення та коригувати залишки на складі, щоб підтримувати каталог в актуальному стані.

---

## 2. Домен

Сервіс оперує наступними ключовими сутностями:
*   **User (Користувач)** — зберігає дані користувачів та їхні ролі (Клієнт, Адміністратор). Зв'язок `1:N` із сутністю `Order`.
*   **Product (Товар)** — опис товару, ціна та кількість на складі. Зв'язок `1:N` із `ProductImage` та `M:N` із `Order` через проміжну таблицю `OrderItem`.
*   **ProductImage (Зображення товару)** — посилання на завантажені у хмару фотографії товарів. Зв'язок `N:1` із `Product`.
*   **Order (Замовлення)** — містить інформацію про покупця, статус замовлення та загальну суму. Зв'язок `1:1` із `Payment` та `1:N` із `OrderItem`.
*   **OrderItem (Елемент замовлення)** — проміжна сутність для збереження зрізу ціни та кількості товару на момент покупки. Зв'язок `N:1` із `Product`.
*   **Payment (Платіж)** — запис транзакції оплати замовлення. Зберігає статус платежу та ідемпотентний токен. Зв'язок `1:1` із `Order`.

### Таблиця перевірки домену (Sieve Test):

| ✔ | Вимога до домену | Де реалізується в проєкті |
| :-: | :--- | :--- |
| **[x]** | ≥ 2 ролі користувачів із різними правами | **ДЗ#24** — роль `Admin` (керування товарами) та роль `Client` (перегляд, купівля). |
| **[x]** | Обмежений ресурс, за який конкурують | **ДЗ#14** — залишок товару на складі (`Product.stock`), який зменшується під час замовлення. |
| **[x]** | Операція з незворотним ефектом | **ДЗ#22** — списання коштів та фіксація платежу (`Payment`) з використанням Outbox та Idempotency-Key. |
| **[x]** | Подія, про яку треба когось сповістити | **ДЗ#19** — подія `order.paid`, що запускає асинхронне надсилання email через чергу повідомлень. |
| **[x]** | Сутність із файлами | **ДЗ#26** — зображення товарів (`ProductImage`), які зберігаються на S3 із завантаженням через presigned URLs. |
| **[x]** | Дані, які часто читають і рідко змінюють | **ДЗ#23** — каталог товарів (`Product`), який кешується у Redis за паттерном cache-aside. |
| **[x]** | 4–6 сутностей зі звʼязками й важким запитом | **ДЗ#12, #13** — отримання списку товарів з пагінацією за курсором, фільтрацією та агрегацією зображень. |

---

## 3. Архітектурні рішення

Для реалізації сервісу обрано збалансований технологічний стек, орієнтований на надійність та простоту локального запуску:

*   **Compute Model:** Node.js + фреймворк NestJS. Це стандартний інструмент курсу, який забезпечує строгу типізацію (TypeScript), модульну структуру коду та просту автоматичну генерацію OpenAPI-спеки з декораторів.
*   **База даних:** PostgreSQL. Повноцінна реляційна СУБД, що підтримує ACID-транзакції та рівні ізоляції, які є критично важливими для недопущення овербукінгу товарів на складі.
*   **Асинхронність та черги:** Redis + BullMQ. Redis виконує роль швидкого in-memory сховища для кешування каталогу товарів, а бібліотека BullMQ забезпечує надійну роботу черги задач для надсилання email-сповіщень.
*   **Авторизація (Auth):** stateless JWT-токени. Ролі користувача (Admin/Client) зашиваються безпосередньо в токен, що дозволяє проводити RBAC-валідацію без додаткових запитів до БД.
*   **Робота з файлами:** S3-сумісне сховище (AWS S3 для продакшну та MinIO для локальної розробки).
*   **Deploy (Деплой):** Контейнеризація за допомогою Docker та Docker Compose для локального запуску всієї інфраструктури однією командою. Для хостингу буде використано Render або Railway.

---

## 4. Trade-offs (Архітектурні компроміси)

*   **Реляційна БД (PostgreSQL) замість NoSQL (MongoDB):**  
    Ми свідомо обрали PostgreSQL, хоча MongoDB дозволила б швидше розробляти схеми даних без міграцій. Проте маркетплейс потребує суворої узгодженості даних (Strong Consistency) при декременті залишків товарів на складі під конкурентним навантаженням. Використання NoSQL із паттерном Eventual Consistency змусило б нас писати складну прикладну логіку для запобігання овербукінгу (продажу товару, якого немає в наявності), що ускладнило б систему.
*   **Модульний моноліт замість мікросервісів:**  
    Проєкт розробляється як єдиний бекенд-додаток (моноліт), розділений на логічні модулі (`UsersModule`, `ProductsModule`, `OrdersModule`). Ми відмовилися від мікросервісної архітектури, оскільки на старті вона створила б надмірні інфраструктурні витрати, складність налаштування мережевих викликів та розподілених транзакцій (Saga/Outbox), що є недоцільним для першої версії системи.
*   **Пошук у каталозі через PostgreSQL full-text search замість Elasticsearch:**  
    Для реалізації пошуку за назвою та описом товарів ми використовуємо вбудовані можливості повнотекстового пошуку PostgreSQL. Ми свідомо не додаємо в інфраструктуру Elasticsearch/OpenSearch, щоб уникнути витрат на синхронізацію даних між БД та пошуковим рушієм, а також знизити вимоги додатка до оперативної пам’яті на етапі хостингу.

---

## 5. Журнал архітектурних рішень (ADR)
*(Буде заповнюватися в процесі виконання наступних ДЗ при зміні архітектури)*


---

## 6. ДЗ: OpenAPI та runtime-контракт (варіант Б)

Архітектурна записка вище описує цільовий проєкт. Поточна навчальна реалізація використовує NestJS 12, Express 5 та express-openapi-validator 5.6.2. Сумісність перевіряється HTTP-тестами. OpenAPI написаний вручну; PostgreSQL, JWT, Redis та S3 на цьому етапі не потрібні.

Реалізовано три маршрути: `GET /products`, `GET /products/{id}`, `POST /products`. Два маршрути Users залишаються контрактом майбутнього етапу; runtime-частина ДЗ вимагає 2–3 маршрути. Авторизація зараз вимкнена (`security: []`); описані 401/403 призначені для наступного етапу.

### Встановлення й запуск

Рекомендовано Node.js 22.22.3+ (або 24.15+) та npm відповідно до engines залежностей Nest CLI. Перевірки також пройдено на Node.js 22.17.0, де npm показує engine/peer warnings. Усі команди виконуються з кореня репозиторію:

```bash
npm install
npm start
```

API: `http://localhost:3000`; порт можна змінити через `PORT`. Товари та ключі ідемпотентності зберігаються в пам’яті й скидаються після перезапуску. Початковий товар має ID 1. Ключі діють для POST /products до перезапуску одного процесу; це не розподілене або довготривале сховище.

### Автоматичне приймання

```bash
npm run check:homework
```

Команда запускає lint, bundle, перевірку вимог специфікації, збірку та HTTP-тести. Тести самі створюють ізольований NestJS-застосунок із тим самим middleware та фільтром на вільному порту; запускати `npm start` для них не потрібно.

Окремі перевірки:

```bash
npm run spec:lint
npm run spec:check
npm run test:contract
npm run build
```

Еквівалентні команди з ДЗ:

```bash
npx @redocly/cli lint openapi/openapi.yaml
npx @redocly/cli bundle openapi/openapi.yaml -o spec.json
node scripts/check-spec.mjs
```

`spec.json` — згенерований bundle. Попередження Redocly про localhost дозволене критеріями. Автотести перевіряють відсутній ключ, невалідне тіло, 201, replay, конфлікт ключа, конкурентні повтори, пагінацію, некоректний курсор, 404, пошкоджений JSON та порушення схеми відповіді. Для останнього тест тимчасово підміняє метод сервісу лише у тестовому застосунку та відновлює його у finally; production-контролер не змінюється.

### Ручні перевірки після npm start

Без ключа → 400 application/problem+json із detail про idempotency-key:

```bash
curl -i -X POST http://localhost:3000/products -H 'Content-Type: application/json' -d '{"name":"Notebook","price_cents":15000,"stock":3}'
```

Невалідне тіло → 400 із detail від валідатора:

```bash
curl -i -X POST http://localhost:3000/products -H 'Content-Type: application/json' -H 'Idempotency-Key: invalid-1' -d '{"name":"Notebook","price_cents":15000,"stock":-1}'
```

Валідне створення → 201. Повтор тієї самої команди → той самий 201, тіло та `Idempotency-Replay: true`. Порядок JSON-полів не впливає на порівняння. Той самий ключ з іншим тілом → 422 Problem:

```bash
curl -i -X POST http://localhost:3000/products -H 'Content-Type: application/json' -H 'Idempotency-Key: create-1' -d '{"name":"Notebook","price_cents":15000,"stock":3}'
```

Перша сторінка; отриманий next_cursor передайте без змін у cursor. Null означає кінець:

```bash
curl -i 'http://localhost:3000/products?limit=1'
curl -i 'http://localhost:3000/products?limit=1&cursor=MQ'
curl -i 'http://localhost:3000/products?limit=101'
curl -i 'http://localhost:3000/products?cursor=aGVsbG8'
curl -i 'http://localhost:3000/products/999'
```

Останні три запити повертають 400, 400 та 404 у форматі Problem. Ціна — ціле число копійок. JSON-парсер працює перед валідатором, `validateRequests` і `validateResponses` увімкнені. Express error-handler обробляє помилки middleware; глобальний NestJS filter — винятки контролерів та помилки валідації відповідей.

---

## Configuration

Режим ДЗ №11–12 — локальний **Infisical** (`http://localhost:8088`),
Nest на хості та база `marketplace` із `docker-compose.hw12.yml` на `127.0.0.1:5433`.
Потрібні Docker Compose v2, Node.js 22.22.3+ та npm.

### Infisical: налаштування та запуск

Після підняття й наповнення БД командами розділу ДЗ №12:

```bash
npm ci
npm run infisical:up
npm run infisical:setup
npm run start:infisical -- dev
```

Перевірка: `curl http://localhost:9999/health` → `{"status":"ok","uptime":...}`.
Для оточення `prod` зупини dev-процес та запусти `npm run start:infisical -- prod`.
Обидва оточення навчальні й вказують на ту саму локальну базу ДЗ №12;
назва `prod` не означає розгортання в інтернеті.

`infisical:up` генерує ключі шифрування й пароль внутрішньої БД у
`secrets/infisical/server.env` (права 0600), не перезаписуючи їх при повторному запуску.
Файл потрібен для запуску самого сховища; DB_URL застосунку в ньому немає.
Далі запускаються Infisical v0.165.16, його окремий PostgreSQL і Redis.

`infisical:setup` одноразово створює локального адміністратора, організацію,
проєкт Marketplace HW12 та секрет `DB_URL` в `dev` і `prod`. Повторний запуск
зберігає значення секретів і видає новий токен застосунку на 30 днів.
Дані входу в UI: `secrets/infisical/admin-login.json`; відкрий цей файл локально.
Адміністративний токен зберігається окремо в `bootstrap.json`; застосунок отримує
лише `app-token` identity з роллю `viewer` у цьому проєкті та `no-access` в організації.
Уся тека `secrets/` ігнорується Git і Dockerfile-контекстом; значення не друкуються скриптами.

Запуск Nest у ДЗ №11–12 використовує офіційний REST API Infisical, тому CLI та SDK для нього не потрібні. ORM-команди ДЗ №13 використовують Infisical CLI, як вимагає нове завдання.
Версію й параметри стенда звірено з [офіційним Compose Infisical](https://github.com/Infisical/infisical/blob/v0.165.16/docker-compose.prod.yml);
схема API запущеної версії доступна на `http://localhost:8088/api/docs/json`.
Скрипт читає DB_URL зі сховища й передає його дочірньому процесу Nest у пам’яті.
В режимі `CONFIG_SOURCE=infisical` локальний `.env` **не завантажується**.
Zod перевіряє конфігурацію до створення Nest-провайдерів; при помилці секретні значення
не включаються в повідомлення. Нових env-файлів із DB_URL немає.

### Ротація та перевірка Infisical (історичний стенд ДЗ12)

Після переходу ДЗ15 на PgBouncer команди `rotate:infisical` та
`check:infisical` нижче **не застосовуються**: вони прив’язані до окремої БД
ДЗ12 на 5433 і її root-secret. Root DB_URL тепер вказує на базу курсового через
6432. Старий скрипт відмовиться працювати з новою адресою. Для PgBouncer
ротація потребуватиме узгодженого оновлення пароля Postgres, userlist і сховища;
реалізація цієї ротації не входить у ДЗ15.

При запущеному через Infisical застосунку:

```bash
curl http://localhost:9999/health
npm run rotate:infisical
curl http://localhost:9999/health
```

Скрипт змінює пароль лише локальної ролі `app` у HW12, оновлює DB_URL у двох
оточеннях і закриває старі з’єднання. `pg.Pool` перечитує актуальний пароль через
Infisical для кожного нового з’єднання. Ротація не перезапускає Nest.
Якщо оновлення сховища не вдалося, скрипт намагається відновити попередній пароль
і обидва значення секретів; помилка відновлення повертає ненульовий код.
Між зміною пароля та записом у сховище є коротке вікно розбіжності — безперервна
доступність кожного запиту під час цього вікна не гарантується.
Зміна хоста, порту, користувача чи назви БД вимагає рестарту застосунку.
Якщо Infisical недоступний, нові з’єднання завершуються помилкою; кешований пароль
не використовується як прихований fallback.

```bash
npm run check:env
npm test
npm run check:infisical
```

Остання команда запускає тимчасові dev/prod-процеси на портах 19991/19992,
перевіряє обсяг HW12-таблиць через креденшели зі сховища, заборону запису секретів
для застосунку та health/uptime до й після **реальної ротації тестового пароля**.
Після перевірки процеси зупиняються. Докази без секретів: `tmp/infisical-verification.json`.

Якщо видалено HW12 volume, нова БД матиме початковий демонстраційний пароль,
а Infisical збереже ротований. Після повторного підняття БД виконай
`npm run rotate:infisical`, щоб синхронізувати їх, і заново застосуй SQL-файли.
Цей скрипт використовує адміністративний локальний socket усередині HW12-контейнера.
Не видаляй ключі `server.env` окремо від volume Infisical — вони потрібні для
розшифрування збережених секретів.

### Змінні конфігурації

Єдина схема застосунку — `src/config/env.schema.ts`; код отримує перевірені значення
через `ConfigService<Env, true>`. `.env.example` — лише контракт із фейковими значеннями.

| Змінна | Вимоги | Джерело / приклад |
| --- | --- | --- |
| `PORT` | Ціле 1–65535 | Оточення запуску; Infisical launcher: `9999` за замовчуванням |
| `CONFIG_SOURCE` | `file` або `infisical`; default `file` | Launcher встановлює `infisical` |
| `DB_URL` | Обов’язковий для Infisical: PostgreSQL URL із користувачем, паролем і БД, без query-параметрів | **Сховище Infisical**, проєкт Marketplace HW12, `dev` / `prod` |
| `INFISICAL_API_URL` | Обов’язковий для Infisical | Локальна metadata, `http://localhost:8088` |
| `INFISICAL_PROJECT_ID` | Обов’язковий для Infisical | `secrets/infisical/client.json` |
| `INFISICAL_ENVIRONMENT` | `dev` або `prod` | Аргумент launcher |
| `INFISICAL_TOKEN_FILE` | Шлях до токена читання | `secrets/infisical/app-token`, передається launcher |
| `DB_HOST` | Обов’язковий лише для `file` | Локальний `.env`, `localhost` |
| `DB_USER` | Обов’язковий лише для `file` | Локальний `.env`, `admin` |
| `DB_NAME` | Обов’язковий лише для `file` | Локальний `.env`, `marketplace` |
| `DB_PORT` | Ціле 1–65535 для `file`; default `5432` | Локальний `.env`; Infisical бере порт із DB_URL |
| `DB_PASSWORD_FILE` | Обов’язковий лише для `file` | Шлях із `.env`, пароль із локального файла `secrets/db_password` |

Нижче збережені інструкції **режиму `file` із ДЗ №11**. Вони використовують
попередню БД на порту 5432 і `rotate.sh`; для ДЗ №12 користуйся командами Infisical вище.

### Перший запуск

Встанови залежності та створи локальний конфіг, якщо його ще немає:

```bash
npm ci
test -f .env || cp .env.example .env
mkdir -p secrets
```

Для першого запуску створи випадковий пароль. Команда не перезапише наявний файл і не виведе пароль:

```bash
node --input-type=module -e 'import { randomBytes } from "node:crypto"; import { writeFileSync } from "node:fs"; writeFileSync("secrets/db_password", randomBytes(32).toString("hex") + "\n", { flag: "wx", mode: 0o600 });'
```

Якщо файл уже існує, пропусти генерацію. У `.env` для локального запуску залиш `DB_HOST=localhost`, `DB_PORT=5432` та `DB_PASSWORD_FILE=secrets/db_password`. Compose публікує БД на `127.0.0.1:5432`; зміна лише `DB_PORT` не змінює це зіставлення портів.

```bash
npm run check:env
docker compose -f docker-compose.file-secrets.yml up -d db
docker compose -f docker-compose.file-secrets.yml exec db sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
npm run start
```

Дочекайся `accepting connections` перед запуском Nest. За потреби переглянь `docker compose -f docker-compose.file-secrets.yml logs --tail=30 db`. Використання явного `-f` гарантує вибір потрібного файла, навіть якщо поруч залишився `compose.yml`.

`start` виконує збірку та запускає `node dist/main.js` без watch. Для розробки є `npm run start:dev`.

В іншому терміналі:

```bash
curl -i http://localhost:9999/health
```

Якщо змінив `PORT`, підстав його в URL. `/health` виконує `SELECT 1` через пул і після успіху повертає HTTP 200 з `status: "ok"` та числовим `uptime` у секундах. Маршрути товарів поки зберігають дані в пам’яті; для перевірки БД використовуй `/health`.

### Початковий пароль і збереження даних

Compose передає файл секрету в `/run/secrets/postgres_password`, а Postgres читає його через `POSTGRES_PASSWORD_FILE`. На порожньому volume образ створює роль із `DB_USER`, базу з `DB_NAME` та встановлює пароль із цього файла. Окремого `init.sql` у поточній реалізації немає. Для навчального запуску застосунок використовує цю ж початкову роль, яка має адміністративні права.

Volume `postgres_data` зберігає дані й пароль БД між перезапусками. Зміна `.env` або файла секрету сама по собі не змінює роль чи пароль у вже ініціалізованій БД — для пароля використовуй ротацію нижче.

`docker compose -f docker-compose.file-secrets.yml down` зберігає volume. Варіант `down -v` видаляє всі дані БД; наступний запуск створить БД з поточним паролем із файла. У цій реалізації немає фіксованого пароля з `init.sql`, до якого потрібно повертати файл після видалення volume.

### Ротація без рестарту Nest

Залиш Postgres і Nest працювати. Потрібні встановлені npm-залежності, локальний `.env` та доступ до Docker. Виконай послідовно:

```bash
curl -i http://localhost:9999/health
bash rotate.sh
curl -i http://localhost:9999/health
```

Скрипт читає `DB_USER` та `DB_PASSWORD_FILE` лише з локального `.env`, без перевизначення цих значень змінними термінала. Для ротації вони мають відповідати конфігурації запущеного Nest. Це правило стосується скрипта; сам Nest зберігає описаний вище пріоритет змінних середовища.

Скрипт автоматично генерує новий пароль і виконує:

1. `ALTER ROLE` для `DB_USER` через `psql` усередині сервісу `db`.
2. Запис нового пароля у `DB_PASSWORD_FILE` без заміни самого файла, щоб зберегти чинне монтування; права файла — `0600`.
3. `pg_terminate_backend` для клієнтських з’єднань цієї ролі в поточній БД, крім з’єднання самого скрипта.

Пароль у `pg.Pool` заданий асинхронною функцією: кожне нове з’єднання перечитує файл. Обробник `pool.on('error', …)` логує помилки неактивних з’єднань після їх закриття. Повторний `/health` має повернути 200, а uptime — бути більшим за попередній. Не перезапускай Nest між цими перевірками.

Між `ALTER ROLE` і записом файла є коротке вікно розбіжності паролів; запит у цей момент може завершитися помилкою. Якщо SQL-зміна не вдалася, файл не оновлюється. Якщо зміна в БД пройшла, але запис файла не вдався, скрипт повідомить про це: віднови доступ до файла й повтори ротацію через адміністративне з’єднання.

### Перевірки конфігурації та образу

```bash
npm run check:env
PORT=abc DB_PORT=70000 npm run start
echo $?
```

Перша команда має завершитися з кодом 0. Друга — показати помилки для обох змінних і завершитися з кодом 1. Для негативної перевірки `check:env` тимчасово закоментуй змінну в `.env.example`, повтори команду й перевір код 1; потім віднови рядок.

Відсутність обов’язкової змінної можна перевірити без переміщення локального `.env`, запустивши лише перевірку схеми в окремому процесі:

```bash
npm run build
env -u PORT node --input-type=module -e 'import { validate } from "./dist/config/env.schema.js"; validate(process.env);'
echo $?
```

Це окрема перевірка схеми. Для приймальної перевірки повного запуску тимчасово прибери `.env` у безпечне місце, виконай `env -u PORT npm run start`, перевір ненульовий код і поверни файл.

```bash
git check-ignore .env secrets/db_password
git ls-files .env secrets/db_password
docker build -t myapp .
docker run --rm myapp ls -a /app
docker run --rm myapp sh -c 'cat /app/.env' 2>&1
docker inspect --format '{{.Config.Env}}' myapp
docker history --no-trunc myapp | grep -i password
```

Git має ігнорувати обидва локальні файли, а `git ls-files` — не виводити їх. В образі має бути `.env.example`, але не `.env` чи `secrets/`; `cat` має завершитися з кодом 1. В env образу очікуються лише змінні базового образу, а пошук `password` в історії не має нічого вивести. Docker-образ не містить локальної конфігурації: для запуску Nest у контейнері її та файл секрету потрібно передати під час запуску.
