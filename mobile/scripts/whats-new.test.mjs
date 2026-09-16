import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildWhatsNew, whatsNewEntries, sectionDate } = require("./whats-new.cjs");

const changelog = `# Changelog

## 0.5.0-beta - 2026-09-17

- Mobile: Nach einem Update zeigt die App einmal, was neu ist (#249).
- Mobile: Update aus der App heraus (#250, #249).
- Kein Präfix, keine Nummer

## 0.4.1-beta - 2026-09-16

- Mobile: Bilder im Chat (#238).
`;

test("die Punkte der Version kommen ohne Präfix und Issue-Nummern", () => {
  assert.deepEqual(whatsNewEntries(changelog, "0.5.0-beta"), [
    "Nach einem Update zeigt die App einmal, was neu ist.",
    "Update aus der App heraus.",
    "Kein Präfix, keine Nummer",
  ]);
  assert.deepEqual(whatsNewEntries(changelog, "0.4.1-beta"), ["Bilder im Chat."]);
  assert.deepEqual(whatsNewEntries(changelog, "9.9.9"), []);
});

test("Datum und Build kommen mit", () => {
  assert.equal(sectionDate(changelog, "0.5.0-beta"), "2026-09-17");
  const entry = buildWhatsNew({ changelog, version: "0.5.0-beta", build: 63 });
  assert.equal(entry.build, 63);
  assert.equal(entry.items.length, 3);
});
