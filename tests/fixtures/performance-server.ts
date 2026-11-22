import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createApp } from '../../apps/api/src/app.js';
import { createDatabase } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';

const url = process.env.TEST_DATABASE_URL;
if (!process.send || !url || process.env.NODE_ENV !== 'test') {
  throw new Error('Only the isolated performance test may start this server');
}
const db = createDatabase(url);
const app = await createApp({
  db,
  registry: createRegistry(false),
  config: {
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: 3001,
    DATABASE_URL: url,
    WEB_ORIGIN: 'http://127.0.0.1:5173',
    ENABLE_DEV_LAB: false,
    LOG_LEVEL: 'silent',
  },
});
await app.listen({ host: '127.0.0.1', port: 0 });
const address = app.server.address();
if (!address || typeof address === 'string') throw new Error('Expected TCP address');

const lag = monitorEventLoopDelay({ resolution: 10 });
let cpu = process.cpuUsage();
let started = performance.now();
let peakRss = 0;
let peakWaiting = 0;
let peakPool = 0;
let sampling: NodeJS.Timeout | undefined;
function sample() {
  peakRss = Math.max(peakRss, process.memoryUsage().rss);
  peakWaiting = Math.max(peakWaiting, db.waitingCount);
  peakPool = Math.max(peakPool, db.totalCount);
}
process.on('message', async (message: unknown) => {
  if (message === 'measure.start') {
    cpu = process.cpuUsage();
    started = performance.now();
    peakRss = peakWaiting = peakPool = 0;
    sample();
    lag.enable();
    lag.reset();
    sampling = setInterval(sample, 100);
    process.send?.({ type: 'measure.started' });
  } else if (message === 'measure.stop') {
    clearInterval(sampling);
    sample();
    const used = process.cpuUsage(cpu);
    const wallMs = performance.now() - started;
    lag.disable();
    process.send?.({
      type: 'measure.stopped',
      wallMs,
      cpuMs: (used.user + used.system) / 1000,
      cpuPercentOfOneCore: (used.user + used.system) / (wallMs * 10),
      peakRssBytes: peakRss,
      heapUsedBytes: process.memoryUsage().heapUsed,
      eventLoopP95Ms: lag.percentile(95) / 1e6,
      peakPoolConnections: peakPool,
      peakPoolWaiting: peakWaiting,
    });
  } else if (message === 'shutdown') {
    clearInterval(sampling);
    lag.disable();
    await app.close();
    process.disconnect();
  }
});
process.send({ type: 'ready', port: address.port });
