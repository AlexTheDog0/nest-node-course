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
  // Both the Nest launcher (/) and ORM wrapper (/hw13) use the course DB via PgBouncer.
  // dev/prod here are local educational environments, not production infrastructure.
  for (const secretPath of ['/', '/hw13']) {
    const query = new URLSearchParams({ projectId: client.projectId, environment, secretPath });
    const existing = await api(`/api/v4/secrets/DB_URL?${query}`, {
      token: admin.token,
      allowMissing: true,
    });
    await api('/api/v4/secrets/DB_URL', {
      token: admin.token,
      method: existing ? 'PATCH' : 'POST',
      body: {
        projectId: client.projectId,
        environment,
        secretPath,
        secretValue: 'postgresql://app:homework-development-only@127.0.0.1:6432/marketplace',
        secretComment: 'Local course database via PgBouncer; dev/prod are educational fixtures.',
      },
    });
  }
}
console.log('Infisical DB_URL updated to PgBouncer in dev/prod, / and /hw13.');
