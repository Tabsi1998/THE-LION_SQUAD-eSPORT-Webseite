import js from "@eslint/js";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importPlugin from "eslint-plugin-import";

// Globals are listed explicitly instead of pulling in the `globals` package, so
// the lint setup depends only on packages this project declares itself.
const browserGlobals = {
  window: "readonly",
  document: "readonly",
  navigator: "readonly",
  location: "readonly",
  history: "readonly",
  localStorage: "readonly",
  sessionStorage: "readonly",
  fetch: "readonly",
  Headers: "readonly",
  Request: "readonly",
  Response: "readonly",
  FormData: "readonly",
  File: "readonly",
  FileReader: "readonly",
  Blob: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  AbortController: "readonly",
  AbortSignal: "readonly",
  EventSource: "readonly",
  CSS: "readonly",
  Image: "readonly",
  Audio: "readonly",
  Event: "readonly",
  CustomEvent: "readonly",
  MutationObserver: "readonly",
  IntersectionObserver: "readonly",
  ResizeObserver: "readonly",
  MediaRecorder: "readonly",
  DataTransfer: "readonly",
  HTMLElement: "readonly",
  HTMLCanvasElement: "readonly",
  HTMLImageElement: "readonly",
  Node: "readonly",
  getComputedStyle: "readonly",
  matchMedia: "readonly",
  requestAnimationFrame: "readonly",
  cancelAnimationFrame: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  queueMicrotask: "readonly",
  structuredClone: "readonly",
  atob: "readonly",
  btoa: "readonly",
  crypto: "readonly",
  console: "readonly",
  alert: "readonly",
  confirm: "readonly",
  performance: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  PublicKeyCredential: "readonly",
  ClipboardItem: "readonly",
  DOMParser: "readonly",
  XMLHttpRequest: "readonly",
  WebSocket: "readonly",
  Intl: "readonly",
  process: "readonly",
};

const nodeGlobals = {
  process: "readonly",
  console: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  module: "writable",
  require: "readonly",
  exports: "writable",
  Buffer: "readonly",
  AbortSignal: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  URL: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  fetch: "readonly",
};

const vitestGlobals = {
  describe: "readonly",
  it: "readonly",
  test: "readonly",
  expect: "readonly",
  vi: "readonly",
  beforeAll: "readonly",
  afterAll: "readonly",
  beforeEach: "readonly",
  afterEach: "readonly",
};

const serviceWorkerGlobals = {
  self: "readonly",
  caches: "readonly",
  clients: "readonly",
  fetch: "readonly",
  Response: "readonly",
  Request: "readonly",
  URL: "readonly",
  console: "readonly",
  skipWaiting: "readonly",
};

export default [
  {
    ignores: [
      "dist/**",
      "build/**",
      "coverage/**",
      "node_modules/**",
      "playwright-report/**",
      "test-results/**",
      "src/components/ui/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{js,jsx,mjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: browserGlobals,
    },
    plugins: {
      react,
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
      import: importPlugin,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,

      // The app runs on the new JSX transform, so React need not be in scope.
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
      // Prop types are not used in this codebase.
      "react/prop-types": "off",
      // Escaped entities are noisy in German copy with apostrophes and quotes.
      "react/no-unescaped-entities": "off",
      // Labels here often carry a title and a hint (label > span > strong); the default depth of 2 misses that text
      // (#937). The rule otherwise stays as recommended.
      "jsx-a11y/label-has-associated-control": ["error", { depth: 3 }],

      "no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
        // `const { status, ...rest } = payload` is the codebase's way of
        // dropping a field before sending it.
        ignoreRestSiblings: true,
      }],
      // `catch {}` is used deliberately where a failed optional step must not
      // interrupt the surrounding flow.
      "no-empty": ["error", { allowEmptyCatch: true }],
      "import/no-unresolved": "off",
      "import/named": "off",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["warn", "smart"],
    },
  },
  {
    files: ["**/*.test.{js,jsx}", "src/setupTests.js"],
    languageOptions: { globals: { ...browserGlobals, ...nodeGlobals, ...vitestGlobals } },
  },
  {
    files: ["e2e/**/*.js", "scripts/**/*.js", "*.config.{js,mjs,cjs}", "*.cjs"],
    languageOptions: { sourceType: "commonjs", globals: nodeGlobals },
    rules: { "no-console": "off" },
  },
  {
    files: ["scripts/**/*.mjs", "vite.config.mjs", "eslint.config.mjs"],
    languageOptions: { sourceType: "module", globals: nodeGlobals },
    rules: { "no-console": "off" },
  },
  {
    files: ["public/service-worker.js"],
    languageOptions: { sourceType: "script", globals: serviceWorkerGlobals },
  },
];
