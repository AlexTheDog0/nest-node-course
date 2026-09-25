SELECT id, user_id, created_at
FROM orders
WHERE status = 'pending'
  AND created_at < timestamptz '2025-12-01 00:00:00+00'
ORDER BY created_at, id
LIMIT 100
