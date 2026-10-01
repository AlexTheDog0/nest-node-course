import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const base = process.env.PACT_BROKER_URL || 'http://127.0.0.1:9292';
const version =
  process.env.PACT_CONSUMER_VERSION ||
  execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const providerVersion = process.env.PACT_PROVIDER_VERSION || version;
const headers = {
  'Content-Type': 'application/json',
  Accept: 'application/hal+json',
};
if (process.env.PACT_BROKER_TOKEN)
  headers.Authorization = `Bearer ${process.env.PACT_BROKER_TOKEN}`;
const command = process.argv[2];
let path, options;
switch (command) {
  case 'publish':
    path = `/pacts/provider/MarketplaceAPI/consumer/MarketplaceWeb/version/${encodeURIComponent(version)}`;
    options = {
      method: 'PUT',
      body: await readFile('pacts/MarketplaceWeb-MarketplaceAPI.json', 'utf8'),
    };
    break;
  case 'tag-prod':
    path = `/pacticipants/MarketplaceAPI/versions/${encodeURIComponent(providerVersion)}/tags/prod`;
    options = { method: 'PUT', body: '{}' };
    break;
  case 'can-i-deploy':
    path = `/can-i-deploy?${new URLSearchParams({ pacticipant: 'MarketplaceWeb', version, to: 'prod' })}`;
    options = {};
    break;
  default:
    throw new Error('Use publish, tag-prod, or can-i-deploy');
}
const response = await fetch(new URL(path, base), {
  ...options,
  headers,
  signal: AbortSignal.timeout(15000),
});
if (!response.ok)
  throw new Error(`Broker ${command} failed: HTTP ${response.status}`);
if (command === 'can-i-deploy') {
  const result = await response.json();
  console.log(JSON.stringify(result.summary));
  if (result.summary?.deployable !== true) process.exitCode = 1;
} else console.log(`${command}: HTTP ${response.status}`);
