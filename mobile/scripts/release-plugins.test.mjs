import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

// Release-Build (#917): R8 und das Kürzen der Ressourcen sind an, und das Manifest sperrt die Ausrichtung nicht
// mehr - beides beanstandete die Play Console bei Build 85.

const require = createRequire(import.meta.url);
const optimization = require("../plugins/withReleaseOptimization.js");
const appJson = JSON.parse(readFileSync(new URL("../app.json", import.meta.url), "utf8"));

test("das Plugin schaltet R8 und das Kürzen der Ressourcen ein - auch wenn die Vorlage die Schalter auf false hat", () => {
  const properties = [
    { type: "comment", value: "aus der Vorlage" },
    { type: "property", key: "android.enableMinifyInReleaseBuilds", value: "false" },
    { type: "property", key: "android.enablePngCrunchInReleaseBuilds", value: "true" },
  ];
  const result = optimization.applySettings(properties);
  const value = (key) => result.find((item) => item.type === "property" && item.key === key)?.value;
  assert.equal(value("android.enableMinifyInReleaseBuilds"), "true");
  assert.equal(value("android.enableShrinkResourcesInReleaseBuilds"), "true");
  assert.equal(value("android.enablePngCrunchInReleaseBuilds"), "true", "fremde Schalter bleiben");
  assert.equal(result.filter((item) => item.key === "android.enableMinifyInReleaseBuilds").length, 1, "kein doppelter Eintrag");
});

test("app.json bindet das Plugin ein und sperrt die Ausrichtung nicht im Manifest", () => {
  assert.ok(appJson.expo.plugins.includes("./plugins/withReleaseOptimization.js"));
  assert.equal(appJson.expo.orientation, "default");
});
