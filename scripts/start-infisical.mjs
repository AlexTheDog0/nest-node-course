import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readState, directory } from './infisical-api.mjs';
import { readDatabaseUrl } from '../dist/config/infisical.js';

const environment = process.argv[2] || 'dev';
if (!['dev', 'prod'].includes(environment)) throw new Error('Environment must be dev or prod');
const client = await readState('client.json');
if (!client) throw new Error('Run npm run infisical:setup first');
const tokenFile = fileURLToPath(new URL('app-token', directory));
const dbUrl = await readDatabaseUrl({ ...client, environment, tokenFile });
const child = spawn(process.execPath, ['dist/main.js'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    CONFIG_SOURCE: 'infisical', DB_URL: dbUrl,
    PORT: process.env.PORT || '9999',
    INFISICAL_API_URL: client.apiUrl,
    INFISICAL_PROJECT_ID: client.projectId,
    INFISICAL_ENVIRONMENT: environment,
    INFISICAL_TOKEN_FILE: tokenFile,
  },
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { console.error('Cannot start Nest application'); process.exitCode = 1; });
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
