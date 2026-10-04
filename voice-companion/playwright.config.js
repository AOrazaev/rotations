// @ts-check
const path = require('path');
const { defineConfig } = require('@playwright/test');

const python = process.platform === 'win32'
  ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
  : 'python3';

module.exports = defineConfig({
  testDir: './tests/browser',
  reporter: 'line',
  use: {
    baseURL: 'http://127.0.0.1:8767'
  },
  webServer: {
    command: `"${python}" scripts/run_fixture.py --port 8767 --token checkpoint-zero-token`,
    cwd: path.resolve(__dirname),
    url: 'http://127.0.0.1:8767/',
    reuseExistingServer: false,
    timeout: 20_000
  }
});
