SELECT id, email, name
FROM users
WHERE lower(email) = lower('CUSTOMER1234@example.test')
