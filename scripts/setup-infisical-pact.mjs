import { api, readState } from './infisical-api.mjs';
const admin = await readState('bootstrap.json');
const client = await readState('client.json');
if (!admin || !client)
  throw new Error('Run infisical:setup and infisical:setup:orm first');
for (const environment of ['dev', 'prod']) {
  for (const [name, value] of Object.entries({
    PACT_BROKER_URL: process.env.PACT_BROKER_URL || 'http://127.0.0.1:9292',
    // The loopback-only local OSS broker has no authentication. Hosted brokers
    // require a real token supplied by the operator, never committed to source.
    PACT_BROKER_TOKEN: process.env.PACT_BROKER_TOKEN ?? '',
  })) {
    const scope = {
      projectId: client.projectId,
      environment,
      secretPath: '/hw13',
    };
    const existing = await api(
      `/api/v4/secrets/${name}?${new URLSearchParams(scope)}`,
      {
        token: admin.token,
        allowMissing: true,
      },
    );
    if (existing && process.env[name] === undefined) continue;
    await api(`/api/v4/secrets/${name}`, {
      token: admin.token,
      method: existing ? 'PATCH' : 'POST',
      body: { ...scope, secretValue: value },
    });
  }
}
console.log(
  'Pact settings ready in Infisical /hw13 dev/prod; no credentials printed.',
);
