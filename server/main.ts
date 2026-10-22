import { startServer } from './server';

// `npm run server` — the local development server (docs/MULTIPLAYER.md 3A.2).
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
startServer({ port, host }).catch((err) => {
  console.error(err);
  process.exit(1);
});
