import { randomUUID } from 'node:crypto';
export const aUser = (overrides = {}) => ({
  name: 'Test buyer',
  email: `${randomUUID()}@example.test`,
  balanceCents: '100000',
  ...overrides,
});
export const aProduct = (overrides = {}) => ({
  name: `Product ${randomUUID()}`,
  priceCents: 1200,
  stock: 10,
  ...overrides,
});
export const anOrder = (userId, overrides = {}) => ({
  userId,
  status: 'paid',
  ...overrides,
});
