const { defineConfig, devices } = require("@playwright/test");

const localPort = process.env.E2E_PORT || "3000";
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${localPort}`;

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  // Ohne Vorgabe startet Playwright halb so viele Worker wie Kerne. Auf einem
  // großen Rechner überlastet das den Vite-Entwicklungsserver, und Seiten hängen
  // beim Nachladen. E2E_WORKERS=2 entspricht dem 4-Kern-Rechner von GitHub.
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : undefined,
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
