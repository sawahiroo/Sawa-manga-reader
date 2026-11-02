import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /(electron-scroll|installer-smoke|packaged-smoke|sawa-(4-[123]|5-0)-.*)\.spec\.js/,
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: { trace: 'retain-on-failure' }
});
