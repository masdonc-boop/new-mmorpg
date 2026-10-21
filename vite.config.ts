import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works from any static host path (e.g. GitHub Pages project sites).
  base: './',
  server: { host: true, port: 5173 },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
  // css.include lets tests read stylesheets via ?raw (Vitest blanks CSS by default).
  test: { environment: 'node', include: ['tests/**/*.test.ts'], css: { include: [/styles\.css/] } },
});
