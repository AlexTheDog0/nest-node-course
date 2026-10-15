import { api, readState } from './infisical-api.mjs';
const admin = await readState('bootstrap.json');
const client = await readState('client.json');
if (!admin || !client) throw new Error('Run infisical:setup and infisical:setup:orm first');
const secretValue = process.env.BROKER_URL ?? 'amqp://app:homework-development-only@127.0.0.1:5672';
for (const environment of ['dev', 'prod']) {
  for (const secretPath of ['/', '/hw13']) {
    const query = new URLSearchParams({ projectId: client.projectId, environment, secretPath });
    const existing = await api(`/api/v4/secrets/BROKER_URL?${query}`, { token: admin.token, allowMissing: true });
    await api('/api/v4/secrets/BROKER_URL', {
      token: admin.token, method: existing ? 'PATCH' : 'POST',
      body: { projectId: client.projectId, environment, secretPath, secretValue,
        secretComment: 'Local educational RabbitMQ AMQP endpoint, homework 19.' },
    });
  }
}
console.log('BROKER_URL saved in dev/prod, / and /hw13.');
