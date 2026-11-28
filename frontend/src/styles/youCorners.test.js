import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Ecken-Klammern (#1316): Das Zeichen gehört allein dem „du“ (und dem Tastatur-Fokus, buttons.test.js). Diese Wächter
// halten fest, wo „tls-you“ stehen darf, dass es ruhig bleibt (keine Bewegung, kein Schein) und dass TV-Seiten,
// Level-Rahmen und Bühnen-Bilder es nie tragen. Eine neue Stelle für „du“ wird hier eingetragen.

const SRC = path.resolve(__dirname, "..");
const read = (rel) => readFileSync(path.join(SRC, rel), "utf8").replace(/\r\n/g, "\n");
const system = read("styles/system.css");

/** Nur der Abschnitt der Ecken-Klammern - bis zum nächsten Abschnitt (Schrift-Treppe), damit spätere Regeln in
 *  system.css (etwa die Zustands-Schilder mit Puls, #1306) die Wächter hier nicht auslösen. */
function youBlock() {
  const start = system.indexOf("/* Ecken-Klammern (#1316)");
  const end = system.indexOf("/* Schrift-Treppe", start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return system.slice(start, end);
}

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
  // Liest alle Quelldateien - unter voller Last (CI, viele Worker) dauert das länger als die üblichen 5 s.
}, 30_000);

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
  const block = youBlock();
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

test("Tabellenzeilen hängen nicht an `position: relative` auf <tr>: Fläche und Winkel liegen an den Zellen", () => {
  const block = youBlock();
  expect(block).toMatch(/tr\.tls-you::after \{ content: none; \}/);
  expect(block).toMatch(/tr\.tls-you \{ box-shadow: none; \}/);
  const cells = (selector) => block.slice(block.indexOf(`${selector} {`), block.indexOf("}", block.indexOf(`${selector} {`)));
  expect(cells("table tr.tls-you > :nth-child(n)")).toMatch(/background-image: var\(--tls-you-tint\);/);
  expect(cells("table tr.tls-you > :first-child")).toMatch(/background-position: top left, top left, bottom left, bottom left, 0 0;/);
  expect(cells("table tr.tls-you > :last-child")).toMatch(/background-position: top right, top right, bottom right, bottom right, 0 0;/);
  // Am Handy: die letzte Zelle ohne `hidden` trägt die rechten Winkel.
  expect(block).toMatch(/@media \(max-width: 639px\) \{\n {2}table tr\.tls-you > :not\(\.hidden\):not\(:has\(~ :not\(\.hidden\)\)\) \{/);
  // Keine Lage an der Zelle - eine Sticky-Spalte bleibt sticky.
  expect(block).not.toMatch(/tr\.tls-you > [^{]*\{[^}]*(?<!-)position:/);
});

test("Kontrast-Modus: „du“ bekommt einen Rahmen in der Systemfarbe; das Etikett ist eine Pille in gemischter Schreibung", () => {
  const block = youBlock();
  expect(block).toMatch(/@media \(forced-colors: active\) \{\n {2}\.tls-you \{ outline: 2px solid CanvasText; outline-offset: -2px; \}/);
  const tag = block.slice(block.indexOf(".tls-you-tag {"));
  expect(tag).toMatch(/border-radius: 999px;/);
  expect(tag).toMatch(/text-transform: none;/);
  expect(read("index.css")).toMatch(/\.tls-standing-me \{ border-radius: 999px;[^}]*text-transform: none; \}/);
});

test("der Turnierbaum leuchtet für „du“ nicht mehr - die Ecken ersetzen den Leuchtrand", () => {
  expect(read("index.css")).not.toMatch(/\.tls-bracket-node\.is-mine \{/);
});
