import { createServer, request } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// CI-only loopback gateway. The OSS broker itself does not support Bearer tokens.
export function createBrokerProxy({ token, upstreamPort = 9293 }) {
  if (!token?.trim()) throw new Error('PACT_BROKER_TOKEN must be configured');
  const expected = Buffer.from(`Bearer ${token}`);
  return createServer((incoming, outgoing) => {
    const supplied = Buffer.from(incoming.headers.authorization || '');
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      outgoing.writeHead(401, { 'WWW-Authenticate': 'Bearer' });
      outgoing.end('Unauthorized');
      return;
    }
    const headers = { ...incoming.headers };
    delete headers.authorization;
    const upstream = request(
      {
        hostname: '127.0.0.1',
        port: upstreamPort,
        path: incoming.url,
        method: incoming.method,
        headers,
        timeout: 30_000,
      },
      (response) => {
        outgoing.writeHead(response.statusCode, response.headers);
        response.on('error', () => outgoing.destroy());
        response.pipe(outgoing);
      },
    );
    upstream.on('timeout', () => upstream.destroy());
    upstream.on('error', () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end('Broker unavailable');
    });
    incoming.on('aborted', () => upstream.destroy());
    incoming.pipe(upstream);
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const url = new URL(process.env.PACT_BROKER_URL);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('CI broker URL must be http://127.0.0.1:<port>');
  }
  const server = createBrokerProxy({ token: process.env.PACT_BROKER_TOKEN });
  server.listen(Number(url.port), '127.0.0.1', () =>
    console.log('Broker gateway ready'),
  );
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => server.close());
  }
}
