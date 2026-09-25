import { readFile, writeFile } from 'node:fs/promises';

export const directory = new URL('../secrets/infisical/', import.meta.url);
export const apiUrl = 'http://localhost:8088';

export async function readState(name) {
  try { return JSON.parse(await readFile(new URL(name, directory), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function saveState(name, value) {
  await writeFile(new URL(name, directory), JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
}

export async function api(path, { token, method = 'GET', body, allowMissing = false } = {}) {
  const response = await fetch(new URL(path, apiUrl), {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (allowMissing && response.status === 404) return null;
  if (!response.ok) throw new Error(`Infisical ${method} ${path.split('?')[0]} failed (HTTP ${response.status})`);
  return response.json();
}
