import { defineConfig } from '@playwright/test';

// Template port (see ~/.claude/CLAUDE.md port table). Clones get their own via new-project.
const PORT = Number(process.env.PORT ?? 6100);

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  // One worker: every spec shares the one gavel_test database, and the auction specs TRUNCATE and reseed it in
  // beforeAll (runDb). Two files in flight at once race on that reseed (task 3.8: catalog and lot-history failed
  // under 5 workers with "Bidder_orgId_userId_key" and BIDDER_NOT_ACTIVE). 13 specs run in ~10 s serially.
  workers: 1,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  webServer: {
    command: process.env.E2E_DEV ? 'npm run dev:test' : 'npm run e2e:server',
    url: `http://localhost:${PORT}/api/health`,
    env: { DEMO_MODE: '1' }, // e2e/demo.spec.ts drives /demo
    reuseExistingServer: false, // a stale server on this port would test the wrong app
    timeout: 300_000, // a cold production build outruns the 120s default
  },
});
