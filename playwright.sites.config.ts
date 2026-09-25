import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/sites",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 60_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  use: {
    trace: "retain-on-failure"
  }
});
