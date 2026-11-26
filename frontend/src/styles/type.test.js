import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

// Schrift-Treppe (#1302, #1303, #1304): acht feste Stufen statt vierzig Größen. Dieser Test hält die Werte der Stufen
// fest (styles/system.css).

const SRC = path.join(process.cwd(), "src");
const system = readFileSync(path.join(SRC, "styles/system.css"), "utf8").replace(/\r\n/g, "\n");

function rule(selector, source = system) {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return "";
  return source.slice(start, source.indexOf("}", start));
}

// clamp(min, calc(a + b·vw), max) in px bei einer Bildschirmbreite - so rechnet auch der Browser.
function clampAt(value, width) {
  const match = /clamp\(([\d.]+)rem,\s*calc\(([\d.]+)rem \+ ([\d.]+)vw\),\s*([\d.]+)rem\)/.exec(value);
  if (!match) return Number.parseFloat(value) * (value.endsWith("rem") ? 16 : 1);
  const [, min, base, slope, max] = match.map(Number);
  return Math.min(max * 16, Math.max(min * 16, base * 16 + (slope * width) / 100));
}

function sizeVar(name) {
  const match = new RegExp(`--tls-type-${name}-size: ([^;]+);`).exec(system);
  return match ? match[1] : "";
}

// PC (ab 1440 px) / Handy (390 px) aus #1302 - dazwischen gleitend, darüber wächst nichts mehr.
const STEPS = {
  hero: { pc: 64, phone: 40, weight: 800, family: "stage", upper: true },
  title: { pc: 44, phone: 30, weight: 700, family: "stage", upper: false },
  section: { pc: 24, phone: 20, weight: 800, family: "text", upper: false },
  card: { pc: 19, phone: 17, weight: 700, family: "text", upper: false },
  body: { pc: 17, phone: 16, weight: 400, family: "text", upper: false },
  small: { pc: 14, phone: 14, weight: 500, family: "text", upper: false },
  label: { pc: 12, phone: 12, weight: 700, family: "text", upper: true },
};

describe("die acht Stufen in styles/system.css", () => {
  test.each(Object.entries(STEPS))("tls-type-%s: Größe am PC und am Handy, Schrift, Stärke, Schreibweise", (name, step) => {
    const css = rule(`.tls-type-${name}`);
    expect(css, `.tls-type-${name} fehlt`).not.toBe("");
    expect(css).toContain(`font-size: var(--tls-type-${name}-size);`);
    expect(css).toContain(`font-family: var(--tls-font-${step.family});`);
    expect(css).toContain(`font-weight: ${step.weight};`);
    expect(css).toContain(`text-transform: ${step.upper ? "uppercase" : "none"};`);
    const size = sizeVar(name);
    expect(Math.round(clampAt(size, 1440) * 10) / 10).toBe(step.pc);
    expect(Math.round(clampAt(size, 390) * 10) / 10).toBe(step.phone);
    // Breitbild: wie PC. Handy 360: nie kleiner als bei 390.
    expect(Math.round(clampAt(size, 2560) * 10) / 10).toBe(step.pc);
    expect(Math.round(clampAt(size, 360) * 10) / 10).toBe(step.phone);
    // Kein Sprung bei 768 und 1024 px: der Wert liegt zwischen Handy und PC.
    for (const width of [768, 1024]) {
      expect(clampAt(size, width)).toBeGreaterThanOrEqual(step.phone);
      expect(clampAt(size, width)).toBeLessThanOrEqual(step.pc);
    }
  });

  test("Etikett: leicht gesperrt (0,12 em); Text mit Zeilenabstand 1,6", () => {
    expect(rule(".tls-type-label")).toContain("letter-spacing: 0.12em;");
    expect(rule(".tls-type-body")).toContain("line-height: 1.6;");
  });

  test("Zahl: Rajdhani 700 mit gleich breiten Ziffern, Zeilenhöhe 1 - die Größe kommt von der Stelle", () => {
    const css = rule(".tls-type-num");
    expect(css).toContain("font-family: var(--tls-font-num);");
    expect(css).toContain("font-weight: 700;");
    expect(css).toContain("font-variant-numeric: tabular-nums;");
    expect(css).toContain("line-height: 1;");
    expect(css).not.toContain("font-size");
    // Nach den anderen Stufen: zusammen mit einer Stufe („tls-type-card tls-type-num“) gilt deren Größe, die Schrift
    // aber kommt von hier.
    expect(system.indexOf(".tls-type-num {")).toBeGreaterThan(system.indexOf(".tls-type-label {"));
    expect(system).toMatch(/--tls-font-num: 'Rajdhani'/);
    expect(system).toMatch(/--tls-font-stage: 'Unbounded'/);
    expect(system).toMatch(/--tls-font-text: 'Outfit'/);
  });

  test("die Stufen stehen in @layer components - eine Tailwind-Klasse an einer Stelle gewinnt weiter", () => {
    const layer = system.slice(system.indexOf("@layer components {"));
    for (const name of [...Object.keys(STEPS), "num"]) expect(layer).toContain(`.tls-type-${name} {`);
  });
});

// ---------------------------------------------------------------- Wächter (Ratschen-Prinzip)
// Nach dem Umbau (scripts/type-codemod.mjs) ist der Stand die Grundlinie: Jede neue freie Größe, jedes neue Unbounded
// außerhalb von Bühne und Seitentitel, jedes GROSS an einer Überschrift und jeder abgekürzte Countdown lässt den Test
// scheitern. Wer eine Ausnahme braucht, trägt sie unten mit Grund ein. Wer eine Ausnahme abbaut, senkt die Zahl mit.

const TEST_FILE = /\.(test|spec)\.[jt]sx?$/;
const rel = (file) => path.relative(SRC, file).split(path.sep).join("/");

function filesIn(dir, pattern) {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return filesIn(full, pattern);
    return pattern.test(name) && !TEST_FILE.test(name) ? [full] : [];
  });
}

// TV-Seiten behalten ihre Beamer-Größen und Schriften (lib/tvType.js), Druckbögen ihre pt-Größen (styles/printView.css).
const TV_OR_PRINT = /^(pages\/display|components\/tv|pages\/print|components\/tls\/print)\//;
const SOURCES = filesIn(SRC, /\.(jsx?|mjs)$/).filter((file) => !rel(file).startsWith("hilfe/"));

function countIn(files, pattern, skip = TV_OR_PRINT) {
  const found = {};
  for (const file of files) {
    const name = rel(file);
    if (skip.test(name)) continue;
    const hits = (readFileSync(file, "utf8").match(pattern) || []).length;
    if (hits) found[name] = hits;
  }
  return found;
}

// Freie Größen: text-[…px|rem], text-[clamp(…)] und text-4xl und größer. text-xs bis text-3xl sind Tailwind-Werte, die
// mit einer Stufe zusammenfallen - neue Stellen nehmen trotzdem die Stufe (tls-type-*).
const FREE_SIZE = /(?<![\w-])(?:[\w-]+:)*text-(?:\[(?:[\d.]+(?:px|rem)|clamp\([^\]]*\))\]|[4-9]xl)(?![\w-])/g;
const FREE_SIZE_EXCEPTIONS = {
  "components/tls/BottomNav.jsx": 1, // Zähler an Symbolen: die Zahl in der Plakette am Symbol (#1232)
};

test("keine neue freie Schriftgröße - neue Stellen nehmen eine der acht Stufen", () => {
  expect(countIn(SOURCES, FREE_SIZE)).toEqual(FREE_SIZE_EXCEPTIONS);
});

// CSS der Bausteine: nichts unter 12 px (#1232). Kleine Punkte mit fester Breite (Zähler an Symbolen) und SVG-Grafiken
// rechnen anders und stehen hier mit Grund. Fabians Entscheidung vom 26.11.: Auch Saison-Deko, Adventkalender und
// Zeremonien haben Text ab 12 px - nur reine Schmuckzeichen ohne Text dürfen kleiner sein (gezählt, mit Grund).
// Ausgenommen sind nur die TV-Seiten (Beamer-Größen) und der Druck (pt).
const CSS_SKIP = /^(components\/tv\/|styles\/printView\.css)/;
const CSS_TINY = /font-size:\s*(?:(?:[0-9]|1[01])(?:\.\d+)?px|0?\.(?:[0-6]\d*|7[0-4]\d*)rem)\s*[;}]/g;
const CSS_TINY_EXCEPTIONS = {
  "components/tls/league/leagueBadge.css": 4, // Saisonverlauf als SVG-Grafik (fill) - Größe in Einheiten der Grafik
  "components/tls/series/racingLeague.css": 2, // Kürzel des Laufs (S, R, HR) und Plätze gutgemacht - feste Höhe unter dem Rennen
  "index.css": 2, // Formpunkte S/U/N der Tabelle in einem 16-px-Kästchen (am Handy 13 px)
};

test("CSS: keine Schrift unter 12 px - außer kleinen Punkten und Grafiken mit Grund", () => {
  expect(countIn(filesIn(SRC, /\.css$/), CSS_TINY, CSS_SKIP)).toEqual(CSS_TINY_EXCEPTIONS);
});

// Unbounded nur für Bühne und Seitentitel (Fabians Variante B): font-heading steht nur noch an begründeten Stellen.
const HEADING_FONT = /(?<![\w-])font-heading(?![\w-])/g;
const HEADING_FONT_EXCEPTIONS = {
  "components/tls/BracketTree.jsx": 2, // derselbe Baum auf dem TV (tv-t-head): Beamer-Schrift wie die übrigen TV-Seiten
  // Der Moment (Platz, Belohnung, Saisonende) ist die Bühne des Augenblicks - Titel in der Vereinsschrift (.tls-placement__title).
  "components/tls/podium/PlacementMoment.jsx": 1,
  "components/tls/rewards/RewardMoment.jsx": 1,
  "components/tls/league/moment/SeasonMoment.jsx": 1,
};

test("Unbounded (font-heading) nur auf Bühne und Seitentitel - sonst tls-type-*", () => {
  expect(countIn(SOURCES, HEADING_FONT)).toEqual(HEADING_FONT_EXCEPTIONS);
});

/** Die öffnenden Tags eines Elements (bis zum `>`, das nicht in {…} oder in Anführungszeichen steht). */
function openingTags(text, pattern) {
  const tags = [];
  for (const match of text.matchAll(pattern)) {
    let depth = 0;
    let quote = "";
    let index = match.index + match[0].length;
    for (; index < text.length; index += 1) {
      const char = text[index];
      if (quote) {
        if (char === quote && text[index - 1] !== "\\") quote = "";
        continue;
      }
      if (char === '"' || char === "'" || char === "`") quote = char;
      else if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      else if (char === ">" && depth === 0) break;
    }
    tags.push(text.slice(match.index, index + 1));
  }
  return tags;
}

test("Großbuchstaben nur für Kurzes (#1303): kein uppercase an h1-h3 und an Kartentiteln (tls-card__title)", () => {
  const found = [];
  for (const file of SOURCES) {
    const name = rel(file);
    if (TV_OR_PRINT.test(name)) continue;
    const text = readFileSync(file, "utf8");
    const tags = [...openingTags(text, /<h[1-3](?=[\s>])/g), ...openingTags(text, /<[A-Za-z][\w.]*(?=[^<>]*tls-card__title)/g)];
    for (const tag of tags) {
      if (/(?<![\w-])uppercase(?![\w-])/.test(tag) && /className/.test(tag)) found.push(`${name}: ${tag.slice(0, 90)}`);
    }
  }
  expect(found).toEqual([]);
});

// Namen werden nie umgeschrieben (#1303): <ShortCaps> um einen berechneten Wert nur, wo der Wert ein fester Seitentitel
// aus dem Code ist - nie um Namen, Titel aus Daten (Liga, Serie, Runde) oder Eingaben („Jo gegen Max“ würde GROSS).
const SHORT_CAPS_DYNAMIC = /<ShortCaps>\{[^}]+\}<\/ShortCaps>/g;
const SHORT_CAPS_FIXED = {
  "advent/AdventCalendarPanel.jsx": 1, // feste Sätze („Bald ist es so weit“)
  "components/tls/AdminForm.jsx": 1, // „Neues Event“, „Event bearbeiten“ - aus den Formularen
  "pages/public/LegalPages.jsx": 1, // „Impressum“, „Datenschutz“, „Nutzungsbedingungen“
  "pages/public/PasswordRecoveryPage.jsx": 1, // „Passwort vergessen“ und die übrigen Schritte
  "pages/user/meinBereich/BereichSeite.jsx": 1, // Gruppen von „Mein Bereich“ aus lib/meinBereich.js
};

test("ShortCaps nie um Namen oder Titel aus Daten - nur um feste Seitentitel", () => {
  expect(countIn(SOURCES, SHORT_CAPS_DYNAMIC)).toEqual(SHORT_CAPS_FIXED);
});

// Zahlen bleiben in Rajdhani (#1304): Stellen mit der Zahlen-Schrift (tls-type-num, NumText, das alte font-display)
// werden nicht weniger. Steht neben einer Zahl ein Wort, bekommt die Zahl ihr eigenes <span className="tls-type-num">
// oder <NumText> - die Stelle verliert die Zahlen-Schrift nicht (das Umbau-Skript meldet solche Stellen).
const NUMBER_FONT = /(?<![\w-])(?:tls-type-num|font-display)(?![\w-])|<NumText\b/g;
const NUMBER_FONT_BASELINE = 234; // nach dem Umbau und den Nachbesserungen aus der Prüfung (vorher 225) - nur nach oben anpassen

test("die Zahlen-Schrift wird nicht weniger - Zahlen neben Wörtern bekommen tls-type-num oder NumText", () => {
  const total = Object.values(countIn(SOURCES, NUMBER_FONT)).reduce((sum, count) => sum + count, 0);
  expect(total, `${total} Stellen mit Zahlen-Schrift, mindestens ${NUMBER_FONT_BASELINE} - neue Zahlen nehmen tls-type-num`).toBeGreaterThanOrEqual(NUMBER_FONT_BASELINE);
});

// Dauern ausgeschrieben (#1304): „154 Tage 16 Std.“, nie „154T 16h“ oder „3 T.“ - lib/datetime formatDuration.
const SHORT_UNIT = /\$\{[^{}`]+\}\s?(?:T|Tg|d|h|H)\.?(?=[\s`"'])|(?<![\w-])\d+\s?(?:T|Tg)\.\s/g;

test("keine abgekürzten Countdowns und Dauern („154T 16h“) - formatDuration schreibt sie aus", () => {
  expect(countIn(SOURCES, SHORT_UNIT, /^$/)).toEqual({});
});

test("der Wächter selbst: erkennt neue Stellen", () => {
  expect('<span className="text-[10px] uppercase">'.match(FREE_SIZE)).toHaveLength(1);
  expect('<p className="md:text-5xl">'.match(FREE_SIZE)).toHaveLength(1);
  expect('<p className="text-[#FFD700] text-xs text-3xl">'.match(FREE_SIZE)).toBeNull();
  expect(".x { font-size: 11px; }".match(CSS_TINY)).toHaveLength(1);
  expect(".x { font-size: 0.68rem; }".match(CSS_TINY)).toHaveLength(1);
  expect(".x { font-size: 12px; } .y { font-size: 0.75rem; }".match(CSS_TINY)).toBeNull();
  expect(openingTags('<h2 className={`a ${b ? "uppercase" : ""}`} onClick={() => x > 1}>Titel</h2>', /<h[1-3](?=[\s>])/g)[0]).toContain("uppercase");
  expect("`noch ${days}T ${hours}h`".match(SHORT_UNIT)).toHaveLength(2);
  expect("`${day}T${clock}`".match(SHORT_UNIT)).toBeNull();
  expect('"154 T. 16 Std."'.match(SHORT_UNIT)).toHaveLength(1);
});
