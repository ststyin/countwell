import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '*.browser.ts',
  use: { ...devices['Desktop Chrome'], baseURL: 'http://127.0.0.1:4174' },
  webServer: {
    command: 'npm exec -- vite --host 127.0.0.1 --port 4174 --strictPort',
    url: 'http://127.0.0.1:4174',
    env: { VITE_COUNTWELL_CLOUD: 'true' },
  },
})
