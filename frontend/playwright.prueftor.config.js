const { defineConfig, devices } = require("@playwright/test");
const { LADEZEIT_SPEC, PRUEFTOR_SPECS } = require("./e2e/prueftor-specs");

// Prüftor (#1660): Barrierefreiheit, Kontrast, Bewegung und Ladezeit gegen das gebaute dist - so, wie es ausgeliefert
// wird (scripts/serve-dist.mjs mit gzip wie nginx). Vorher `yarn build`.
//   yarn test:prueftor                      alle Tor-Tests (Projekt „ladezeit“ läuft allein, ohne parallele Tests)
//   yarn test:prueftor --project=chromium   nur Barrierefreiheit, Kontrast und Bewegung
const port = process.env.PRUEFTOR_PORT || "4173";
const baseURL = `http://127.0.0.1:${port}`;
const reportFile = process.env.PRUEFTOR_REPORT || "test-results/prueftor-report.json";

module.exports = defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  workers: process.env.E2E_WORKERS ? Number(process.env.E2E_WORKERS) : 2,
  outputDir: "test-results/prueftor",
  reporter: [["line"], ["json", { outputFile: reportFile }]],
  use: {
    baseURL,
    // Im gebauten dist meldet sich der Service Worker an; sein Abruf bleibt offen und „networkidle“ käme nie.
    serviceWorkers: "block",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `node scripts/serve-dist.mjs ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      testMatch: PRUEFTOR_SPECS.map((spec) => spec.file).filter((file) => file !== LADEZEIT_SPEC),
      use: { ...devices["Desktop Chrome"] },
    },
    // Die Messung läuft in einem eigenen Aufruf mit einem Worker (ci.yml), damit kein paralleler Test sie bremst.
    { name: "ladezeit", testMatch: [LADEZEIT_SPEC], use: { ...devices["Pixel 5"] } },
  ],
});
