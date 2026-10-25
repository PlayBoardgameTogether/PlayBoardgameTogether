import { createApp } from '../../apps/api/src/app.js';
import { loadConfig } from '../../apps/api/src/config.js';
import { createDatabase } from '../../apps/api/src/db/index.js';
import { createRegistry } from '../../apps/api/src/registry/index.js';
import { deliverRegistrationMail } from './registration-mailbox.js';

const config = loadConfig();
if (config.NODE_ENV !== 'development' || config.DATABASE_URL !== process.env.TEST_DATABASE_URL) {
  throw new Error('E2E server requires the isolated test database and development mode');
}
const app = await createApp({
  config,
  db: createDatabase(config.DATABASE_URL),
  registry: createRegistry(true),
  registrationMailer: deliverRegistrationMail,
});
await app.listen({ host: config.API_HOST, port: config.API_PORT });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close().then(() => process.exit(0)));
}
