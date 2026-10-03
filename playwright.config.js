// @ts-check
const { defineConfig, devices } = require('@playwright/test');
const path = require('path');

const staticServerPython = process.platform === 'win32'
  ? path.join(__dirname, 'voice-companion', '.venv', 'Scripts', 'python.exe')
  : 'python3';
const staticServerScript = path.join(__dirname, 'tests', 'static-server.py');

// The app is a zero-build static site, so tests run straight against the
// checked-in HTML/CSS/JS via a plain static file server — no bundler, no
// dev server framework, nothing that would need to exist in production.
module.exports = defineConfig({
  testDir: './tests',
  fullyParallel: true,
  workers: process.platform === 'win32' ? 1 : undefined,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
  },
  // Chromium only: the app leans on the async Clipboard API (Copy / Copy
  // image) which behaves inconsistently across engines in headless CI.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `"${staticServerPython}" "${staticServerScript}"`,
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
});
