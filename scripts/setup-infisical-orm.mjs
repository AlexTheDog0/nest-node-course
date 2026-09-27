import { api, readState } from './infisical-api.mjs';

const admin = await readState('bootstrap.json');
const client = await readState('client.json');
if (!admin || !client) throw new Error('Run npm run infisical:setup first');

// A separate folder preserves homework 11/12 DB_URL and password rotation.
for (const environment of ['dev', 'prod']) {
  const foldersQuery = new URLSearchParams({
    projectId: client.projectId,
    environment,
    path: '/',
  });
  const { folders } = await api(`/api/v2/folders?${foldersQuery}`, {
    token: admin.token,
  });
  if (!folders.some((folder) => folder.name === 'hw13')) {
    await api('/api/v2/folders', {
      token: admin.token,
      method: 'POST',
      body: {
        projectId: client.projectId,
        environment,
        name: 'hw13',
        path: '/',
      },
    });
  }
  const query = new URLSearchParams({
    projectId: client.projectId,
    environment,
    secretPath: '/hw13',
  });
  const existing = await api(`/api/v4/secrets/DB_URL?${query}`, {
    token: admin.token,
    allowMissing: true,
  });
  if (!existing)
    await api('/api/v4/secrets/DB_URL', {
      token: admin.token,
      method: 'POST',
      body: {
        projectId: client.projectId,
        environment,
        secretPath: '/hw13',
        secretValue:
          'postgresql://app:homework-development-only@127.0.0.1:5434/marketplace',
        secretComment:
          'Isolated local HW13 database. Both environments are development fixtures.',
      },
    });
}
console.log('Infisical /hw13 ready in dev/prod; existing secrets preserved.');
