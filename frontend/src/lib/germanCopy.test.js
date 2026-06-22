const fs = require("fs");
const path = require("path");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set(["build", "coverage", "node_modules"]);
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx"]);

const DISALLOWED_VISIBLE_WORDS = [
  "Uebersicht",
  "uebersicht",
  "Begruendung",
  "begruendung",
  "Loeschen",
  "loeschen",
  "Oeffnen",
  "oeffnen",
  "Waehlen",
  "waehlen",
  "Zurueck",
  "zurueck",
  "Schliessen",
  "schliessen",
  "Groesse",
  "groesse",
  "Hinzufuegen",
  "hinzufuegen",
  "Aendern",
  "aendern",
  "Durchfuehren",
  "durchfuehren",
  "Bestaetigen",
  "bestaetigen",
  "Muessen",
  "muessen",
  "ueberfaellig",
  "gruen",
  "weiss",
  "fuer",
];

function sourceFiles(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) return [];
      return sourceFiles(fullPath);
    }
    if (!entry.isFile()) return [];
    if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) return [];
    if (/\.(test|spec)\.[jt]sx?$/.test(entry.name)) return [];
    return [fullPath];
  });
}

function lineForIndex(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

test("German UI copy uses umlauts instead of ae/oe/ue transliterations", () => {
  const findings = [];
  const pattern = new RegExp(`\\b(${DISALLOWED_VISIBLE_WORDS.join("|")})\\b`, "g");

  for (const file of sourceFiles(SOURCE_ROOT)) {
    const text = fs.readFileSync(file, "utf8");
    for (const match of text.matchAll(pattern)) {
      findings.push(`${path.relative(SOURCE_ROOT, file)}:${lineForIndex(text, match.index)} -> ${match[0]}`);
    }
  }

  expect(findings).toEqual([]);
});
