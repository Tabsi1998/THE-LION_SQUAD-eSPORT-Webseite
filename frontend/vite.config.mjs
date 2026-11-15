import path from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), {
    name: "tls-release-version",
    apply: "build",
    generateBundle(_options, bundle) {
      const worker = readFileSync(path.resolve(rootDir, "public/service-worker.js"), "utf8");
      const fingerprint = createHash("sha256").update(worker);
      for (const name of Object.keys(bundle).sort()) {
        const item = bundle[name];
        fingerprint.update(name).update(item.type === "chunk" ? item.code : item.source);
      }
      const version = fingerprint.digest("hex").slice(0, 20);
      this.emitFile({ type: "asset", fileName: "service-worker.js", source: worker.replace("__TLS_BUILD_ID__", version) });
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version }) });
    },
  }],
  resolve: {
    alias: { "@": path.resolve(rootDir, "src") },
  },
  server: {
    host: "0.0.0.0",
    port: 3000,
    strictPort: true,
    proxy: {
      "/api": {
        target: process.env.VITE_DEV_BACKEND_URL || "http://127.0.0.1:8001",
        changeOrigin: true,
        ws: true,
      },
    },
  },
  preview: { host: "0.0.0.0", port: 3000, strictPort: true },
  build: {
    sourcemap: false,
    target: "es2022",
    // Manifest für das Budget-Gate (scripts/check-bundle-budget.mjs, #936).
    manifest: true,
    rolldownOptions: {
      output: {
        // Feste Gruppen mit Vorrang (#936): Eine Gruppe zieht ihre Abhängigkeiten mit. Mit dem früheren
        // manualChunks landete React in "charts" und jsx-runtime in "editor", dadurch lud jeder öffentliche
        // Start Editor und Diagramme vorab. React und Radix werden darum zuerst eingesammelt.
        codeSplitting: {
          groups: [
            { name: "react-core", test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 40 },
            { name: "ui-radix", test: /[\\/]node_modules[\\/]@radix-ui[\\/]/, priority: 30 },
            { name: "editor", test: /[\\/]node_modules[\\/](@tiptap[\\/]|prosemirror-)/, priority: 20 },
            { name: "charts", test: /[\\/]node_modules[\\/](recharts[\\/]|d3-)/, priority: 10 },
          ],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    setupFiles: ["./src/setupTests.js"],
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
    coverage: { reporter: ["text", "lcov"] },
  },
});
