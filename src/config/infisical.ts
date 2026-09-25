import { readFile } from 'node:fs/promises';
import { isPostgresUrl } from './env.schema.js';

export interface InfisicalConnection {
  apiUrl: string;
  projectId: string;
  environment: 'dev' | 'prod';
  tokenFile: string;
}

export async function readDatabaseUrl(connection: InfisicalConnection): Promise<string> {
  const endpoint = new URL('/api/v4/secrets/DB_URL', connection.apiUrl);
  endpoint.search = new URLSearchParams({
    projectId: connection.projectId,
    environment: connection.environment,
    secretPath: '/',
  }).toString();
  let response: Response;
  try {
    const token = (await readFile(connection.tokenFile, 'utf8')).trim();
    if (!token) throw new Error('Empty token');
    response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    throw new Error('Cannot read DB_URL from Infisical; check availability and token file');
  }
  // Never include response bodies, URLs with credentials, or token values in errors.
  if (!response.ok) throw new Error(`Infisical rejected DB_URL request (HTTP ${response.status})`);
  let value: unknown;
  try {
    const data = await response.json() as { secret?: { secretValue?: unknown } } | null;
    value = data?.secret?.secretValue;
  } catch {
    throw new Error('Invalid Infisical response');
  }
  if (typeof value !== 'string' || !isPostgresUrl(value)) {
    throw new Error('Infisical DB_URL must be a PostgreSQL URL with user, password and database');
  }
  return value;
}
