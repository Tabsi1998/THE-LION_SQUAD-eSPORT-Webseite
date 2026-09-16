#!/usr/bin/env node
// „Was ist neu“ (#249): schreibt den Changelog-Abschnitt der aktuellen Version
// nach src/whatsnew.json, damit die App ihn ohne Server zeigen kann.
//
//   node scripts/whats-new.cjs          schreibt die Datei
//   node scripts/whats-new.cjs --check  prüft nur, ob sie aktuell ist (Preflight)
const fs = require("fs");
const path = require("path");
const { changelogSection } = require("./release-version.cjs");

const root = path.resolve(__dirname, "..");
const TARGET = path.join(root, "src", "whatsnew.json");

/** Die Punkte des Abschnitts: ohne „- “, ohne „Mobile:“-Präfix, ohne Issue-Nummern am Ende. */
function whatsNewEntries(changelog, version) {
  const section = changelogSection(changelog, version);
  if (!section) return [];
  return section
    .split(/\r?\n/)
    .filter((line) => /^\s*-\s+/.test(line))
    .map((line) => line
      .replace(/^\s*-\s*/, "")
      .replace(/^(Mobile|App):\s*/i, "")
      .replace(/\s*\((#\d+(,\s*#\d+)*)\)\s*\.?$/, ".")
      .replace(/\.\.$/, ".")
      .trim())
    .filter(Boolean);
}

function sectionDate(changelog, version) {
  const escaped = String(version).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(changelog || "").match(new RegExp(`^## ${escaped} - (\\d{4}-\\d{2}-\\d{2})`, "m"));
  return match ? match[1] : "";
}

function buildWhatsNew({ changelog, version, build }) {
  return { version, build, date: sectionDate(changelog, version), items: whatsNewEntries(changelog, version) };
}

function currentWhatsNew() {
  const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
  const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
  return buildWhatsNew({ changelog, version: String(app.expo?.version || ""), build: Number(app.expo?.android?.versionCode || 0) });
}

function serialize(entry) {
  return `${JSON.stringify(entry, null, 2)}\n`;
}

function main() {
  const entry = currentWhatsNew();
  const expected = serialize(entry);
  if (process.argv.includes("--check")) {
    const actual = fs.existsSync(TARGET) ? fs.readFileSync(TARGET, "utf8").replace(/\r\n/g, "\n") : "";
    if (actual !== expected) {
      console.error("src/whatsnew.json ist nicht aktuell. Bitte `npm run whatsnew` ausführen und die Datei einchecken.");
      process.exit(1);
    }
    console.log(`src/whatsnew.json passt zu ${entry.version} (Build ${entry.build}, ${entry.items.length} Punkte).`);
    return;
  }
  if (!entry.items.length) {
    console.error(`CHANGELOG.md hat keine Punkte für ${entry.version}.`);
    process.exit(1);
  }
  fs.writeFileSync(TARGET, expected);
  console.log(`src/whatsnew.json geschrieben: ${entry.version} (Build ${entry.build}), ${entry.items.length} Punkte.`);
}

module.exports = { whatsNewEntries, buildWhatsNew, sectionDate };

if (require.main === module) main();
