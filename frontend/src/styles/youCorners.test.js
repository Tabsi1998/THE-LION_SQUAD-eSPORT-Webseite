import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Ecken-Klammern (#1316): Das Zeichen gehört allein dem „du“ (und dem Tastatur-Fokus, buttons.test.js). Diese Wächter
// halten fest, wo „tls-you“ stehen darf, dass es ruhig bleibt (keine Bewegung, kein Schein) und dass TV-Seiten,
// Level-Rahmen und Bühnen-Bilder es nie tragen. Eine neue Stelle für „du“ wird hier eingetragen.

const SRC = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(SRC, rel), "utf8").replace(/\r\n/g, "\n");
const system = read("styles/system.css");

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(jsx?|tsx?)$/.test(name) && !/\.test\.|\.spec\./.test(name) ? [full] : [];
  });
}

// Einsatzorte für „du“ - Rangliste (Turnier, Liga, Fast Lap, Jahreswertung), Turnierbaum und Spielplan,
// Teilnehmerliste, Kalender, Karten in Listen und die Gesichter der Team-Seite.
const PLACES = [
  "components/tls/bracket/BracketCards.jsx",
  "components/tls/tournament/StandingsTable.jsx",
  "pages/public/CalendarPage.jsx",
  "pages/public/EventDetailPage.jsx",
  "pages/public/F1DetailPage.jsx",
  "pages/public/SeasonPage.jsx",
  "pages/public/TournamentDetailPage.jsx",
  "pages/public/TournamentSchedulePage.jsx",
  "pages/public/team/TeamHeader.jsx",
];

test("„tls-you“ steht nur an den eingetragenen Stellen für „du“", () => {
  const found = sourceFiles(SRC)
    .filter((file) => /\btls-you\b/.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
    .sort();
  expect(found).toEqual(PLACES);
});

test("TV-Seiten, Level-Rahmen und Bühne tragen keine Ecken-Klammern", () => {
  const forbidden = [
    ...sourceFiles(path.join(SRC, "pages/display")),
    ...sourceFiles(path.join(SRC, "components/tv")),
    ...sourceFiles(path.join(SRC, "seasons")),
    path.join(SRC, "components/tls/LevelAvatarFrame.jsx"),
    path.join(SRC, "lib/loewenRang.js"),
  ];
  for (const file of forbidden) {
    const text = readFileSync(file, "utf8");
    expect([path.basename(file), /\btls-you\b|--tls-corners/.test(text)]).toEqual([path.basename(file), false]);
  }
  // Der Baum fragt auf dem TV gar nicht erst nach „du“ (die Anzeige-Antwort kann is_mine für die Leitung tragen).
  expect(read("components/tls/BracketTree.jsx")).toMatch(/const mine = isTv \? null : /);
});

test("„du“ ist ruhig: Winkel und Fläche ohne Bewegung und ohne Schein, das Etikett „Du“ in Cyan", () => {
  const block = system.slice(system.indexOf("/* Ecken-Klammern (#1316)"));
  expect(block).toMatch(/--tls-you-fill: inset 0 0 0 100vmax rgb\(var\(--tls-brand-rgb\) \/ 0\.08\);/);
  expect(block).toMatch(/\.tls-you \{ box-shadow: var\(--tls-you-fill\); \}/);
  expect(block).toMatch(/\.tls-you--inset \{ --tls-corner-out: 0px; \}/);
  const corners = block.slice(block.indexOf(".tls-you::after {"), block.indexOf("}", block.indexOf(".tls-you::after {")));
  expect(corners).toMatch(/inset: calc\(-1 \* var\(--tls-corner-out\)\);/);
  expect(corners).toMatch(/pointer-events: none;/);
  expect(corners).toMatch(/background: var\(--tls-corners\);/);
  expect(block).not.toMatch(/animation|transition|drop-shadow|filter:/);
  const tag = block.slice(block.indexOf(".tls-you-tag {"));
  expect(tag).toMatch(/color: var\(--tls-brand\);/);
});

test("der Turnierbaum leuchtet für „du“ nicht mehr - die Ecken ersetzen den Leuchtrand", () => {
  expect(read("index.css")).not.toMatch(/\.tls-bracket-node\.is-mine \{/);
});
