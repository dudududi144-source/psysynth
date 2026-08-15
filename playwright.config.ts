import { defineConfig } from '@playwright/test'

// Browser-CI for the render proof. Runs only in the dedicated browser CI job
// (see .github/workflows/ci.yml `browser` job), after `bun run build:harness`.
export default defineConfig({
  testDir: './e2e',
  timeout: 120000,
  retries: 0,
  use: {
    headless: true,
    browserName: 'chromium',
  },
  reporter: [['list']],
})
