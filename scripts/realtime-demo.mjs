import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { io } from 'socket.io-client';

const base = process.env.REALTIME_URL ?? 'http://localhost:3000';
const sameRoom = process.argv.includes('--same-room');
const sockets = [];
let receivedA = false,
  receivedB = false;
const deadline = setTimeout(() => {
  console.error('Realtime demo timed out');
  sockets.forEach((socket) => socket.disconnect());
  console.log(
    `A_RECEIVED=${Number(receivedA)}\nB_RECEIVED=${Number(receivedB)}`,
  );
  process.exit(1);
}, 10000);

async function connect(token) {
  const socket = io(base, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    timeout: 2500,
  });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}
async function join(socket, orderId) {
  const ack = await socket.timeout(2500).emitWithAck('join', { orderId });
  if (!ack?.ok)
    throw new Error(`Join refused (status ${ack?.status ?? 'unknown'})`);
}
async function http(path, token, options = {}) {
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${path}`);
  return response.json();
}

try {
  const { orderA, orderB, tokenA, tokenB } = JSON.parse(
    await readFile(
      process.env.REALTIME_DEMO_FILE ?? 'secrets/realtime-demo.json',
      'utf8',
    ),
  );
  if (!orderA || !orderB || orderA === orderB || !tokenA || !tokenB)
    throw new Error(
      'Run realtime:setup to prepare distinct orders and credentials',
    );
  const a = await connect(tokenA);
  const b = await connect(sameRoom ? tokenA : tokenB);
  await join(a, orderA);
  await join(b, sameRoom ? orderA : orderB);
  const before = await http(`/orders/${orderA}`, tokenA);
  const status = before.status === 'shipped' ? 'paid' : 'shipped';
  const observedA = [],
    observedB = [];
  a.on('order.status', (event) => observedA.push(event));
  b.on('order.status', (event) => observedB.push(event));
  const changed = await http(`/orders/${orderA}/status`, tokenA, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
  // Observe B even after A receives: room leakage can arrive on a later frame.
  await delay(800);
  const matches = (event) =>
    event.id === changed.eventId &&
    event.orderId === orderA &&
    event.status === status;
  receivedA = observedA.some(matches);
  receivedB = observedB.some(matches);
  if (!receivedA || receivedB !== sameRoom) {
    throw new Error('Measured room delivery does not match the selected mode');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  sockets.forEach((socket) => socket.disconnect());
  console.log(
    `A_RECEIVED=${Number(receivedA)}\nB_RECEIVED=${Number(receivedB)}`,
  );
}
