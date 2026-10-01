import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  test,
  expect,
} from '@jest/globals';
import { User } from '../../dist/entities/user.entity.js';
import { startDatabase } from './testkit/database.mjs';
import { aUser } from './testkit/builders.mjs';
let db, users;
beforeAll(async () => {
  db = await startDatabase();
  users = db.source.getRepository(User);
});
beforeEach(async () => db.reset());
afterAll(async () => db?.close());
describe('User repository / PostgreSQL', () => {
  test('persists and reads an exact bigint balance', async () => {
    const input = aUser({ balanceCents: '9007199254740993' });
    const saved = await users.save(input);
    expect(await users.findOneByOrFail({ id: saved.id })).toMatchObject(input);
  });
  test('duplicate email violates unique constraint 23505', async () => {
    const input = aUser();
    await users.save(input);
    await expect(
      users.insert(aUser({ email: input.email })),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
  });
  test('ON CONFLICT updates one existing user instead of creating a duplicate', async () => {
    const input = aUser();
    await users.save(input);
    await users.upsert(aUser({ email: input.email, name: 'Updated buyer' }), [
      'email',
    ]);
    expect(await users.count()).toBe(1);
    expect(await users.findOneByOrFail({ email: input.email })).toMatchObject({
      name: 'Updated buyer',
    });
  });
});
