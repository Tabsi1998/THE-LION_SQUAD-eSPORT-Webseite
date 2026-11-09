#!/usr/bin/env node
// Schlanker Index für die „?“-Links (#2295): src/hilfe/anker.json = Thema → Schritt-id → Titel, aus src/hilfe/themen.
// HelpLink liest nur diesen Index statt aller Texte. Nach jeder Änderung an Schritten: node scripts/hilfe-anker.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/hilfe");
const out = {};
for (const name of fs.readdirSync(path.join(ROOT, "themen")).filter((file) => file.endsWith(".json")).sort()) {
  const thema = JSON.parse(fs.readFileSync(path.join(ROOT, "themen", name), "utf8"));
  out[thema.slug] = Object.fromEntries(thema.abschnitte.flatMap((abschnitt) => abschnitt.schritte.map((schritt) => [schritt.id, schritt.titel])));
}
fs.writeFileSync(path.join(ROOT, "anker.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`anker.json: ${Object.keys(out).length} Themen`);
