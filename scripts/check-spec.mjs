import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const s = JSON.parse(readFileSync('spec.json', 'utf8'));
const methods = ['get', 'post', 'put', 'patch', 'delete'];
const ops = Object.entries(s.paths).flatMap(([path, value]) =>
  Object.entries(value)
    .filter(([method]) => methods.includes(method))
    .map(([method, op]) => ({ path, method, op })),
);
const resources = new Set(
  Object.keys(s.paths).map((path) => path.split('/')[1]),
);
assert(ops.length >= 5 && resources.size >= 2);
assert.equal(new Set(ops.map(({ op }) => op.operationId)).size, ops.length);
for (const { op } of ops) {
  assert(op.operationId && op.summary);
  assert(Object.keys(op.responses).some((code) => /^[45]/.test(code)));
  for (const [code, response] of Object.entries(op.responses)) {
    if (/^4/.test(code))
      assert(response.content?.['application/problem+json']?.schema);
  }
}
for (const key of ['type', 'title', 'status', 'detail', 'instance'])
  assert(s.components.schemas.Problem.required.includes(key));
const get = s.paths['/products'].get;
for (const name of ['limit', 'cursor'])
  assert(get.parameters.some((p) => p.in === 'query' && p.name === name));
const page = get.responses['200'].content['application/json'].schema;
assert.equal(page.properties.items.type, 'array');
assert.equal(page.properties.next_cursor.nullable, true);
const key = s.paths['/products'].post.parameters.find(
  (p) => p.in === 'header' && p.name.toLowerCase() === 'idempotency-key',
);
assert.equal(key.required, true);
assert(key.description.trim().length >= 40);
console.log(
  `Contract checks passed: ${ops.length} operations, ${resources.size} resources, required Idempotency-Key, pagination, Problem.`,
);
