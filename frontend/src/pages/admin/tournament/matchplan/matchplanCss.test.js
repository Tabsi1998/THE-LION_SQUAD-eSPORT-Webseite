import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Wächter (#2511): Das CSS des Matchplans (Verwaltung: Turnier bearbeiten, Stationen, Spielwochen der Staffel-Seite)
// liegt in matchplan.css statt im Start-CSS. Damit nichts ungestylt aufblitzt, importiert jede Datei, die mp-Klassen
// zeichnet, die Datei selbst - das CSS kommt dann mit ihrem Chunk, bevor die Seite zeichnet. Im gebauten Start-CSS
// prüft dasselbe scripts/check-bundle-budget.mjs (pageCssProblems).

const SRC = path.resolve(__dirname, "../../../..");
const read = (rel) => readFileSync(path.join(SRC, rel), "utf8").replace(/\r\n/g, "\n");
const ohneKommentare = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "");
const MP_RULE = /\.mp(?:-[\w-]+)?(?=[\s{,:.[>+~)])/;
// Eine mp-Klasse im Quelltext: "mp", "mp-…" als Wort in einem String (className, Vorlagen, Listen).
const MP_CLASS = /["'`\s]mp(?:-[a-z][\w-]*)?(?=["'`\s])/;

function quellDateien(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return quellDateien(full);
    return /\.(js|jsx)$/.test(name) && !/\.test\.|\.spec\./.test(name) ? [full] : [];
  });
}

test("das Start-CSS (index.css mit system.css, fonts.css, App.css) enthält keine Matchplan-Regel", () => {
  for (const rel of ["index.css", "styles/system.css", "fonts.css", "App.css"]) {
    expect(ohneKommentare(read(rel)).match(MP_RULE)?.[0] ?? null, rel).toBeNull();
  }
});

test("matchplan.css trägt die Regeln des Matchplans und der Spielwochen", () => {
  const css = ohneKommentare(read("pages/admin/tournament/matchplan/matchplan.css"));
  for (const selector of [".mp {", ".mp-card {", ".mp-timeline {", ".mp-agenda {", ".mp-btn--touch {", ".mp-week {", "@keyframes mp-conflict"]) {
    expect(css, selector).toContain(selector);
  }
});

test("jede Datei mit mp-Klassen importiert matchplan.css selbst", () => {
  const ohneImport = [];
  for (const file of quellDateien(SRC)) {
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    // Ein bloßes "mp" ist auch ein Kürzel in Tabellen-Köpfen (lib/resultPaste.js) - gezählt werden nur Dateien mit mp-Klassen.
    if (!MP_CLASS.test(text) || !/["'`\s]mp-[a-z]/.test(text)) continue;
    if (!/^import "[^"]*\/matchplan\.css";$/m.test(text)) ohneImport.push(path.relative(SRC, file).split(path.sep).join("/"));
  }
  expect(ohneImport).toEqual([]);
});
