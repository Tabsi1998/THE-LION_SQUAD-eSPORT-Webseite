const { defineConfig, devices } = require("@playwright/test");

const localPort = process.env.E2E_PORT || "3000";
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${localPort}`;

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [
        ["line"],
        ["html", { open: "never" }],
        ["junit", { outputFile: "test-results/e2e-junit.xml" }],
      ]
    : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: process.env.E2E_BASE_URL ? undefined : {
    command: `node node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${localPort}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI && process.env.E2E_ISOLATED !== "1",
    timeout: 120_000,
    env: { BROWSER: "none", PORT: localPort },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
    ...(process.env.E2E_EXTRA_BROWSERS === "1" ? [
      { name: "firefox", use: { ...devices["Desktop Firefox"] } },
      { name: "webkit", use: { ...devices["Desktop Safari"] } },
    ] : []),
  ],
});
