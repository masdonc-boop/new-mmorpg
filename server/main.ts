import { startServer } from './server';
import { configFromEnv } from './config';

// `npm run server`: the development server (docs/MULTIPLAYER.md 3A.2; settings in server/config.ts).
const config = configFromEnv(process.env);
if (!config.ok) {
  console.error(`[server] ${config.error}`);
  process.exit(1);
}
for (const note of config.notes) console.log(`[server] ${note}`);
startServer(config.options).catch((err) => {
  console.error(err);
  process.exit(1);
});
