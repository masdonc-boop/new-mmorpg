import { startServer } from './server';

// `npm run server` — the local development server (docs/MULTIPLAYER.md 3A.2).
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '127.0.0.1';
// GUESTS=1 also allows unsaved guest play by name (development and automated tests).
// LIVE_EXCHANGE=1 opens the live Exchange with real items and coins (off unless the owner says so).
startServer({ port, host, allowGuests: process.env.GUESTS === '1', liveExchange: process.env.LIVE_EXCHANGE === '1' }).catch((err) => {
  console.error(err);
  process.exit(1);
});
