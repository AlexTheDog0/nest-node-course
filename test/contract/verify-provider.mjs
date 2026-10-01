import { Verifier } from '@pact-foundation/pact';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { startApplication } from '../integration/testkit/application.mjs';

const broker = process.env.PACT_BROKER_URL;
const version =
  process.env.PACT_PROVIDER_VERSION ||
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const context = await startApplication();
try {
  await context.app.listen(0, '127.0.0.1');
  await new Verifier({
    provider: 'MarketplaceAPI',
    providerBaseUrl: await context.app.getUrl(),
    providerVersion: version,
    ...(broker
      ? {
          pactBrokerUrl: broker,
          ...(process.env.PACT_BROKER_TOKEN
            ? { pactBrokerToken: process.env.PACT_BROKER_TOKEN }
            : {}),
          consumerVersionSelectors: [{ latest: true }],
          publishVerificationResult: true,
        }
      : {
          pactUrls: [resolve('pacts/MarketplaceWeb-MarketplaceAPI.json')],
          publishVerificationResult: false,
        }),
    stateHandlers: {
      'product 42 exists': async () => {
        await context.database.reset();
        await context.database.source
          .query(`INSERT INTO products(id, name, price_cents, stock)
          OVERRIDING SYSTEM VALUE VALUES (42, 'Pact notebook', 1500, 8)
          ON CONFLICT (id) DO NOTHING`);
      },
    },
    logLevel: 'info',
  }).verifyProvider();
} finally {
  await context.close();
}
