import { startServer } from './server';

// `npm run server` — the local development server (docs/MULTIPLAYER.md 3A.2).
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
// GUESTS=1 also allows unsaved guest play by name (development and automated tests).
startServer({ port, host, allowGuests: process.env.GUESTS === '1' }).catch((err) => {
  console.error(err);
  process.exit(1);
});
