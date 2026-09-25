"""HW12 acceptance checks. Requires a NEW, empty dedicated HW12 database."""
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[1]
PSQL = ['docker', 'compose', '-f', str(ROOT / 'docker-compose.hw12.yml'),
        'exec', '-T', 'db', 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
        '-U', 'app', '-d', 'marketplace']


def sql(statement):
    result = subprocess.run(PSQL + ['-At'], input=statement, text=True,
                            capture_output=True)
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()


def apply(name):
    return sql((ROOT / 'db' / name).read_text())


assert sql('SELECT 1') == '1'
assert sql("SELECT count(*) FROM pg_tables WHERE schemaname='public'") == '0', \
    'Use a clean HW12 volume; this script never deletes existing data.'
apply('schema.sql')
assert int(sql("SELECT count(*) FROM information_schema.table_constraints "
               "WHERE constraint_type='FOREIGN KEY' AND table_schema='public'")) >= 3
apply('seed.sql')
for table in ('orders', 'products'):
    assert int(sql(f'SELECT count(*) FROM {table}')) >= 100000

queries = [(ROOT / 'db' / 'queries' / f'q{i}.sql').read_text().strip()
           for i in range(1, 5)]
for query in queries:
    assert ';' not in query.rstrip(';'), 'One statement per query file'
before = [sql('EXPLAIN (ANALYZE, BUFFERS) ' + q) for q in queries]
results_before = [sql(q) for q in queries]
assert all('Seq Scan' in plan for plan in before), before
apply('indexes.sql')
sql('ANALYZE')
after = []
names = ['idx_orders_user_created', 'idx_orders_pending_created',
         'idx_users_lower_email', 'idx_products_search_vector']
for query, name in zip(queries, names):
    for _ in range(3):
        plan = sql('EXPLAIN (ANALYZE, BUFFERS) ' + query)
    assert 'Seq Scan' not in plan, plan
    assert re.search(r'(?:Index(?: Only)? Scan using|Bitmap Index Scan on) ' + name, plan), plan
    after.append(plan)
assert [sql(q) for q in queries] == results_before, 'Indexes must preserve results'
assert sql("SELECT indexrelname FROM pg_stat_user_indexes WHERE schemaname='public' "
           "AND idx_scan=0 AND indexrelid NOT IN "
           "(SELECT conindid FROM pg_constraint WHERE conindid<>0)") == ''
assert int(sql("SELECT count(*) FROM pg_index WHERE indpred IS NOT NULL "
               "OR indexprs IS NOT NULL")) >= 1
assert int(sql("SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid "
               "JOIN pg_am am ON am.oid=c.relam JOIN pg_opclass o ON o.oid=i.indclass[0] "
               "WHERE am.amname='gin' AND o.opcintype='tsvector'::regtype")) >= 1
forms = {word: sql("SELECT count(*) FROM products WHERE search_vector @@ "
                   f"plainto_tsquery('simple', '{word}')")
         for word in ('кросівки', 'кросівок')}
assert forms == {'кросівки': '2000', 'кросівок': '0'}
# Transaction rollback keeps the benchmark dataset unchanged.
assert '\nt\n' in sql("BEGIN; UPDATE products SET name='Тестовий термос' WHERE id=1; "
                       "SELECT search_vector @@ plainto_tsquery('simple', 'термос') "
                       "FROM products WHERE id=1; ROLLBACK;")
for statement, expected in [
    ("INSERT INTO orders(user_id) VALUES(-1)", '23503'),
    ("INSERT INTO order_items VALUES(1, -1, 1, 10)", '23503'),
    ("INSERT INTO order_items VALUES(-1, 1, 1, 10)", '23503'),
    ("UPDATE products SET price=-1 WHERE id=1", '23514'),
    ("UPDATE products SET price='NaN' WHERE id=1", '23514'),
    ("UPDATE products SET stock=-1 WHERE id=1", '23514'),
    ("UPDATE orders SET status='invalid' WHERE id=1", '23514'),
    ("UPDATE order_items SET quantity=0 WHERE order_id=1", '23514'),
    ("UPDATE products SET name=NULL WHERE id=1", '23502'),
]:
    failure = subprocess.run(PSQL + ['--set=VERBOSITY=verbose', '-At'],
                             input='BEGIN; ' + statement + '; ROLLBACK;',
                             text=True, capture_output=True)
    assert failure.returncode != 0 and expected in failure.stderr, failure.stderr
output = ROOT / 'tmp' / 'hw12'
output.mkdir(parents=True, exist_ok=True)
for i, (old, new) in enumerate(zip(before, after), 1):
    (output / f'q{i}-before.txt').write_text(old + '\n')
    (output / f'q{i}-after.txt').write_text(new + '\n')
print('PASS: schema, seed, four before/after plans, all indexes used, partial/expression, GIN')
print('Morphology:', forms)
print('PostgreSQL:', sql('SELECT version()'))
print('Text search configurations:', sql('SELECT count(*) FROM pg_ts_config'))
print('Search matches:', sql("SELECT count(*) FROM products WHERE search_vector @@ "
                           "plainto_tsquery('simple', 'шкіряні кросівки')"))
print('Plans saved:', output)
