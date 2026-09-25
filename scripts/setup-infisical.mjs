import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { api, apiUrl, directory, readState, saveState } from './infisical-api.mjs';

let admin = await readState('bootstrap.json');
if (!admin) {
  const config = await api('/api/v1/admin/config');
  if (config.config.initialized) throw new Error('Infisical is already initialized; restore secrets/infisical/bootstrap.json');
  const email = 'admin@marketplace.test';
  const password = randomBytes(32).toString('base64url') + 'aA1!';
  // Persist login credentials before the one-time request so a retry cannot lose them.
  await saveState('admin-login.json', { url: apiUrl, email, password });
  const result = await api('/api/v1/admin/bootstrap', {
    method: 'POST', body: { email, password, organization: 'Marketplace Homework' },
  });
  admin = { token: result.identity.credentials.token, organizationId: result.organization.id };
  await saveState('bootstrap.json', admin);
}

let client = await readState('client.json');
if (!client) {
  const result = await api('/api/v1/projects', { token: admin.token, method: 'POST', body: {
    projectName: 'Marketplace HW12', slug: 'marketplace-hw12', type: 'secret-manager',
    shouldCreateDefaultEnvs: true,
  } });
  client = { apiUrl, projectId: result.project.id };
  await saveState('client.json', client);
}

for (const environment of ['dev', 'prod']) {
  const query = new URLSearchParams({ projectId: client.projectId, environment, secretPath: '/' });
  const current = await api(`/api/v4/secrets/DB_URL?${query}`, { token: admin.token, allowMissing: true });
  if (!current) await api('/api/v4/secrets/DB_URL', {
    token: admin.token, method: 'POST', body: {
      projectId: client.projectId, environment, secretPath: '/',
      secretValue: 'postgresql://app:homework-development-only@127.0.0.1:5433/marketplace',
      secretComment: 'Local HW12 demonstration database. prod is an environment name, not a real production deployment.',
    },
  });
}

if (!client.identityId) {
  const result = await api('/api/v1/identities', { token: admin.token, method: 'POST', body: {
    name: 'Marketplace application (read only)', organizationId: admin.organizationId, role: 'no-access',
  } });
  client.identityId = result.identity.id;
  await saveState('client.json', client);
}
const membershipPath = `/api/v1/projects/${client.projectId}/identity-memberships/${client.identityId}`;
const membership = await api(membershipPath, { token: admin.token, allowMissing: true });
if (!membership) await api(membershipPath, { token: admin.token, method: 'POST', body: { role: 'viewer' } });
const authPath = `/api/v1/auth/token-auth/identities/${client.identityId}`;
const auth = await api(authPath, { token: admin.token, allowMissing: true });
if (!auth) await api(authPath, { token: admin.token, method: 'POST', body: {
  accessTokenTTL: 2592000, accessTokenMaxTTL: 2592000,
} });
const credentials = await api(`${authPath}/tokens`, {
  token: admin.token, method: 'POST', body: { name: 'Local application access' },
});
await writeFile(new URL('app-token', directory), credentials.accessToken + '\n', { mode: 0o600 });
console.log('Infisical ready: Marketplace HW12, dev/prod DB_URL, read-only application identity.');
console.log('Admin login: secrets/infisical/admin-login.json (ignored; never commit).');
console.log('Application token expires in 30 days; rerun setup to issue a new token.');
