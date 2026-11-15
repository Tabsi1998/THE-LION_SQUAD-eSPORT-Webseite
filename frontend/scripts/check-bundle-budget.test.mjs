// Selbsttest des Budget-Gates (#936): node --test scripts/check-bundle-budget.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { FORBIDDEN_STARTUP_CHUNKS, collectStartup, gzipSize, parseBudgets } from "./check-bundle-budget.mjs";

const manifest = {
  "index.html": { file: "assets/index-a.js", name: "index", isEntry: true, imports: ["_react-core.js", "_api.js"], dynamicImports: ["src/pages/Admin.jsx"], css: ["assets/index-a.css"] },
  "_react-core.js": { file: "assets/react-core-b.js", name: "react-core" },
  "_api.js": { file: "assets/api-c.js", name: "api", imports: ["_react-core.js", "_motion.js"] },
  "_motion.js": { file: "assets/motion-d.js", name: "motion", css: ["assets/motion-d.css"] },
  "src/pages/Admin.jsx": { file: "assets/Admin-e.js", name: "Admin", isDynamicEntry: true, imports: ["_editor.js"] },
  "_editor.js": { file: "assets/editor-f.js", name: "editor" },
};

test("zählt den Einstieg und alle statischen Importe transitiv, jede Datei einmal", () => {
  const { js, css } = collectStartup(manifest);
  assert.deepEqual(js.map((item) => item.file).sort(), ["assets/api-c.js", "assets/index-a.js", "assets/motion-d.js", "assets/react-core-b.js"]);
  assert.deepEqual(css.sort(), ["assets/index-a.css", "assets/motion-d.css"]);
});

test("nachgeladene Seiten und ihre Abhängigkeiten zählen nicht", () => {
  const { js } = collectStartup(manifest);
  assert.ok(!js.some((item) => item.name === "Admin" || item.name === "editor"));
});

test("ein kaputtes Manifest fällt auf statt still weniger zu zählen", () => {
  assert.throws(() => collectStartup({ "index.html": { file: "a.js", imports: ["_fehlt.js"] } }), /unbekannten Eintrag/);
  assert.throws(() => collectStartup({}), /keinen Einstieg/);
});

test("liest die Grenzwerte aus PERFORMANCE_BUDGETS.md", () => {
  const markdown = "Text\n<!-- budget:startup-js-gzip 300000 -->\n- etwas\n<!-- budget:startup-css-gzip 62000 -->";
  assert.deepEqual(parseBudgets(markdown), { "startup-js-gzip": 300000, "startup-css-gzip": 62000 });
});

test("gzip mit fester Stufe ist reproduzierbar", () => {
  const buffer = Buffer.from("export const a = 1;\n".repeat(200));
  assert.equal(gzipSize(buffer), gzipSize(Buffer.from(buffer)));
  assert.ok(gzipSize(buffer) < buffer.length);
});

test("Editor, Diagramme, PDF und QR stehen auf der Sperrliste für den Start", () => {
  for (const name of ["editor", "charts", "pdf", "jsQR"]) assert.ok(FORBIDDEN_STARTUP_CHUNKS.includes(name));
});
