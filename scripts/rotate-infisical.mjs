import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { api, readState } from './infisical-api.mjs';

const admin = await readState('bootstrap.json');
const client = await readState('client.json');
if (!admin || !client) throw new Error('Run infisical:setup first');
const environments = ['dev', 'prod'];
const previous = [];
for (const environment of environments) {
  const query = new URLSearchParams({ projectId: client.projectId, environment, secretPath: '/' });
  const result = await api(`/api/v4/secrets/DB_URL?${query}`, { token: admin.token });
  previous.push(result.secret.secretValue);
}
if (previous[0] !== previous[1]) throw new Error('This local rotation requires dev/prod to use the same HW12 DB_URL');
const url = new URL(previous[0]);
if (url.hostname !== '127.0.0.1' || url.port !== '5433' || url.username !== 'app'
  || url.pathname !== '/marketplace') throw new Error('Rotation only supports the local HW12 app role');

const literal = value => "'" + value.replaceAll("'", "''") + "'";
function sql(statement) {
  const result = spawnSync('docker', ['compose', '-f', 'docker-compose.hw12.yml',
    'exec', '-T', 'db', 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'app', '-d', 'marketplace'],
  { input: 'SET standard_conforming_strings=on;\n' + statement, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('HW12 database operation failed (SQL output withheld)');
}
async function update(environment, value) {
  await api('/api/v4/secrets/DB_URL', { token: admin.token, method: 'PATCH', body: {
    projectId: client.projectId, environment, secretPath: '/', secretValue: value,
  } });
}
const password = randomBytes(32).toString('hex');
url.password = password;
sql(`ALTER ROLE app WITH PASSWORD ${literal(password)};`);
try {
  for (const environment of environments) await update(environment, url.toString());
} catch {
  // Restore DB and both secret versions if a partial update fails.
  sql(`ALTER ROLE app WITH PASSWORD ${literal(decodeURIComponent(new URL(previous[0]).password))};`);
  for (let index = 0; index < environments.length; index++) await update(environments[index], previous[index]);
  throw new Error('Infisical update failed; previous DB password and secrets restored');
}
sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='app' "
  + "AND datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid();");
console.log('HW12 password rotated, Infisical dev/prod updated, old connections closed.');
