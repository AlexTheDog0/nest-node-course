import { test, expect } from '@jest/globals';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createBrokerProxy } from '../../scripts/pact-broker-proxy.mjs';

test('broker proxy rejects missing configuration', () => {
  expect(() => createBrokerProxy({ token: '' })).toThrow(/token/i);
});

test('broker proxy rejects invalid credentials and forwards authorized requests', async () => {
  const token = randomBytes(32).toString('hex');
  const requests = [];
  const backend = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push({
      method: req.method,
      url: req.url,
      auth: req.headers.authorization,
      body,
    });
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ saved: true }));
  });
  backend.listen(0, '127.0.0.1');
  await once(backend, 'listening');
  let proxy;
  try {
    proxy = createBrokerProxy({ token, upstreamPort: backend.address().port });
    proxy.listen(0, '127.0.0.1');
    await once(proxy, 'listening');
    const url = `http://127.0.0.1:${proxy.address().port}/pacts?version=1`;
    for (const authorization of [undefined, 'Bearer wrong', `Basic ${token}`]) {
      const response = await fetch(url, {
        headers: authorization ? { Authorization: authorization } : {},
      });
      expect(response.status).toBe(401);
      await response.text();
    }
    expect(requests).toHaveLength(0);
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: '{"contract":true}',
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ saved: true });
    expect(requests).toEqual([
      {
        method: 'PUT',
        url: '/pacts?version=1',
        auth: undefined,
        body: '{"contract":true}',
      },
    ]);
    await new Promise((resolve) => backend.close(resolve));
    const unavailable = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(unavailable.status).toBe(502);
    await unavailable.text();
  } finally {
    if (proxy) await new Promise((resolve) => proxy.close(resolve));
    if (backend.listening)
      await new Promise((resolve) => backend.close(resolve));
  }
});
