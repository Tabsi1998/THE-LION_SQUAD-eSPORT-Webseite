// Selbsttest des Budget-Gates (#936): node --test scripts/check-bundle-budget.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  FORBIDDEN_STARTUP_CHUNKS, REQUIRED_LIGHT_ROUTES, collectStartup, gzipSize, heavyRouteProblems, judge, parseBudgets, parseGoals,
} from "./check-bundle-budget.mjs";

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

test("liest Grenzen und Ziele getrennt aus PERFORMANCE_BUDGETS.md", () => {
  const markdown = "Text\n<!-- budget:startup-js-gzip 305000 -->\n<!-- goal:startup-js-gzip 300000 -->\n- etwas\n<!-- budget:startup-css-gzip 63000 -->";
  assert.deepEqual(parseBudgets(markdown), { "startup-js-gzip": 305000, "startup-css-gzip": 63000 });
  assert.deepEqual(parseGoals(markdown), { "startup-js-gzip": 300000 });
});

test("über dem Ziel nur Warnung, über der Grenze Fehler", () => {
  assert.equal(judge(299_000, 305_000, 300_000), "ok");
  assert.equal(judge(300_001, 305_000, 300_000), "warn");
  assert.equal(judge(305_000, 305_000, 300_000), "warn");
  assert.equal(judge(305_001, 305_000, 300_000), "fail");
  assert.equal(judge(62_000, 63_000, undefined), "ok");
});

test("die echte PERFORMANCE_BUDGETS.md: JS-Grenze 305.000 mit Ziel 300.000, CSS-Grenze 63.000", () => {
  const markdown = readFileSync(new URL("../PERFORMANCE_BUDGETS.md", import.meta.url), "utf8");
  assert.equal(parseBudgets(markdown)["startup-js-gzip"], 305000);
  assert.equal(parseGoals(markdown)["startup-js-gzip"], 300000);
  assert.equal(parseBudgets(markdown)["startup-css-gzip"], 63000);
});

test("gzip mit fester Stufe ist reproduzierbar", () => {
  const buffer = Buffer.from("export const a = 1;\n".repeat(200));
  assert.equal(gzipSize(buffer), gzipSize(Buffer.from(buffer)));
  assert.ok(gzipSize(buffer) < buffer.length);
});

const routes = (overrides = {}) => ({
  "src/pages/public/RegisterPage.jsx": { file: "assets/RegisterPage-1.js", isDynamicEntry: true, imports: ["_utils.js"] },
  "src/pages/public/EventsPage.jsx": { file: "assets/EventsPage-2.js", isDynamicEntry: true },
  "src/pages/admin/AdminNewsEditPage.jsx": { file: "assets/AdminNewsEditPage-3.js", isDynamicEntry: true, imports: ["_editor.js"] },
  "_utils.js": { file: "assets/utils-4.js", name: "utils" },
  "_editor.js": { file: "assets/editor-5.js", name: "editor" },
  "_charts.js": { file: "assets/charts-6.js", name: "charts", imports: ["_editor.js"] },
  ...overrides,
});
const light = { required: ["src/pages/public/RegisterPage.jsx"] };

test("öffentliche Seiten ohne schwere Chunks: keine Meldung, Admin-Seiten mit Editor sind erlaubt", () => {
  assert.deepEqual(heavyRouteProblems(routes(), light), []);
});

test("eine öffentliche Seite, die über eine Kleinigkeit an charts und damit an editor hängt, fällt auf", () => {
  const manifest = routes({ "_utils.js": { file: "assets/utils-4.js", name: "utils", imports: ["_charts.js"] } });
  const problems = heavyRouteProblems(manifest, light);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /RegisterPage\.jsx lädt charts, editor statisch mit/);
});

test("auch Pflicht-Seiten außerhalb von src/pages/public werden geprüft, eine fehlende Pflicht-Seite meldet sich", () => {
  const manifest = routes({
    "src/pages/user/ProfilePage.jsx": { file: "assets/ProfilePage-7.js", isDynamicEntry: true, imports: ["_editor.js"] },
  });
  const problems = heavyRouteProblems(manifest, { required: ["src/pages/user/ProfilePage.jsx", "src/pages/public/Weg.jsx"] });
  assert.ok(problems.some((line) => /ProfilePage\.jsx lädt editor/.test(line)));
  assert.ok(problems.some((line) => /Weg\.jsx fehlt im Manifest/.test(line)));
});

test("vite.config: gemeinsam genutzte Bibliotheken kommen nach vendor-shared, nicht in editor oder charts", async () => {
  const { sharedWithHeavy } = await import("../vite.config.mjs");
  const nm = (name) => `C:/app/node_modules/${name}`;
  const ctx = (importers) => ({ getModuleInfo: () => ({ importers }) });
  // clsx: von recharts und von src/lib/utils.js importiert
  assert.equal(sharedWithHeavy(nm("clsx/dist/clsx.mjs"), ctx([nm("recharts/es6/util.js"), "C:/app/src/lib/utils.js"])), "vendor-shared");
  // use-sync-external-store: von Tiptap und recharts importiert
  assert.equal(sharedWithHeavy(nm("use-sync-external-store/shim/with-selector.js"), ctx([nm("@tiptap/react/dist/index.js"), nm("recharts/es6/state/hooks.js")])), "vendor-shared");
  // nur vom Editor genutzt: bleibt beim Editor; nur vom übrigen Code: kein eigener Chunk
  assert.equal(sharedWithHeavy(nm("linkifyjs/dist/linkify.mjs"), ctx([nm("@tiptap/extension-link/dist/index.js")])), null);
  assert.equal(sharedWithHeavy(nm("axios/index.js"), ctx(["C:/app/src/lib/api.js"])), null);
  // immer und reselect brauchen nur die Diagramme (über @reduxjs/toolkit): sie bleiben bei "charts"
  for (const lib of ["immer/dist/immer.mjs", "reselect/dist/reselect.mjs"]) {
    assert.equal(sharedWithHeavy(nm(lib), ctx([nm("recharts/es6/state/store.js"), nm("@reduxjs/toolkit/dist/redux-toolkit.modern.mjs")])), null, lib);
  }
  assert.equal(sharedWithHeavy(nm("@tiptap/core/dist/index.js"), ctx(["C:/app/src/x.jsx", nm("@tiptap/react/dist/index.js")])), null);
  assert.equal(sharedWithHeavy("C:/app/src/lib/utils.js", ctx([nm("recharts/es6/util.js"), "C:/app/src/a.jsx"])), null);
});

test("die Pflicht-Seiten aus #936 stehen in der Liste", () => {
  for (const page of ["RegisterPage", "MembershipApplyPage", "ProfilePage", "EventsPage", "TournamentsPage"]) {
    assert.ok(REQUIRED_LIGHT_ROUTES.some((route) => route.endsWith(`/${page}.jsx`)), page);
  }
});

test("Editor, Diagramme, PDF und QR stehen auf der Sperrliste für den Start", () => {
  for (const name of ["editor", "charts", "pdf", "jsQR"]) assert.ok(FORBIDDEN_STARTUP_CHUNKS.includes(name));
});
