import { test, expect } from '@jest/globals';
import { PactV3, MatchersV3 } from '@pact-foundation/pact';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getProduct } from './catalog-client.mjs';

const file = 'pacts/MarketplaceWeb-MarketplaceAPI.json';
test('frontend reads a product from the OpenAPI /products/{id} endpoint', async () => {
  await mkdir('pacts', { recursive: true });
  await rm(file, { force: true });
  const provider = new PactV3({
    consumer: 'MarketplaceWeb',
    provider: 'MarketplaceAPI',
    dir: resolve('pacts'),
    logLevel: 'info',
  });
  provider
    .given('product 42 exists')
    .uponReceiving('a request for product 42')
    .withRequest({
      method: 'GET',
      path: '/products/42',
      headers: { Accept: 'application/json' },
    })
    .willRespondWith({
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: {
        id: MatchersV3.integer(42),
        name: MatchersV3.like('Pact notebook'),
        price_cents: MatchersV3.integer(1500),
        stock: MatchersV3.integer(8),
      },
    });
  await provider.executeTest(async (mock) => {
    expect(await getProduct(mock.url, 42)).toEqual({
      id: 42,
      name: 'Pact notebook',
      price_cents: 1500,
      stock: 8,
    });
  });
  // Keep paths aligned with the existing spec, including concrete IDs vs placeholders.
  const pact = JSON.parse(await readFile(file, 'utf8'));
  const spec = await readFile('openapi/openapi.yaml', 'utf8');
  const paths = [...spec.matchAll(/^\s+(\/\S*):\s*$/gm)].map(
    (match) => match[1],
  );
  for (const interaction of pact.interactions) {
    const segments = interaction.request.path.split('/');
    expect(
      paths.some((path) => {
        const expected = path.split('/');
        return (
          expected.length === segments.length &&
          expected.every((part, index) =>
            /^\{[^}]+\}$/.test(part)
              ? segments[index] !== ''
              : part === segments[index],
          )
        );
      }),
    ).toBe(true);
  }
});
