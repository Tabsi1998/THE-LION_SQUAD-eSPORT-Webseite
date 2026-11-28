import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Wächter (#1307): Ein Datum steht auf der ganzen Seite in einer Form - „Sa 23. Mai · 18:00“, „heute 18:00“, „vor 12 Min.“.
// Die Form kommt aus lib/datetime.js (formatWhen, formatRange, formatAgo, formatClock, formatMonth, formatWeekday und das
// amtliche formatOfficialDate für Rechnung, Ausweis und Rechtstexte). Seiten bauen kein Datum selbst zusammen: keine
// eigenen viennaDate/viennaDateTime/viennaTime-Aufrufe, kein „${tag}.${monat}.“, kein split("-").reverse().join("."),
// kein padStart-Datum mit Punkten und kein „· 18:00 Uhr“. Eingabefelder (GermanDateField, datetime-local) sind davon frei.

const root = path.resolve(__dirname, "..");

// Wer die Wien-Helfer selbst rufen darf - mit Grund.
const DIRECT_ALLOWED = {
  "lib/datetime.js": "die Hilfen selbst",
  "lib/vienna.js": "Wiener Zeit, Grundlage der Hilfen",
  "components/tls/DisplayStatusBanner.jsx": "TV-Status mit Sekunden („Aktualisiert 18:00:05“) - eine Uhr, kein Datum",
  "components/tls/AppErrorBoundary.jsx": "technische Angaben für Admins mit Sekunden (Fehlerbericht zum Kopieren)",
  "lib/slotSource.js": "„geplant ca. 11.10. 14:20“ - dieselben Fälle wie die App (slotSource.cases.json), zieht mit dem App-Teil um",
};

// Selbst gebaute Datumsformen, die bleiben dürfen - mit Grund.
const BUILT_ALLOWED = {
  "lib/datetime.js": "die Hilfen selbst",
  "lib/matchdayPaste.js": "Fehlermeldung zur eingefügten Eingabe - nennt das Datum so, wie es getippt wurde",
  "pages/admin/AdminDashboardPage.jsx": "Achse im Diagramm: fünf Zeichen je Tag („24.11.“)",
};

// Auch als Wert weitergereicht (`exitLine(row, viennaDate)`) - Importzeilen und Kommentare zählen nicht.
const DIRECT = /^(?!\s*(?:import\b|\/\/|\*|\/\*)).*\bvienna(?:Date|DateTime|Time)\b/m;
const BUILT = [
  { name: "Tag und Monat aus Platzhaltern („${tag}.${monat}.“)", pattern: /\$\{[^{}]+\}\.\$\{[^{}]+\}\./ },
  { name: "ISO-Tag umgedreht („split(\"-\").reverse().join(\".\")“)", pattern: /split\(\s*["']-["']\s*\)\s*\.reverse\(\)\s*\.join\(\s*["']\.["']\s*\)/ },
  { name: "padStart-Datum mit Punkt", pattern: /get(?:UTC)?(?:Date|Month)\(\)[^;\n]*padStart\(2,\s*["']0["']\)\}?\./ },
  { name: "„Uhr“ hinter Tag und Uhrzeit", pattern: /format(?:When|DateTime)\([^()]*(?:\([^()]*\)[^()]*)*\)\}?\s*Uhr\b/ },
  { name: "Datumsmuster wie „dd.MM.“", pattern: /["'`][^"'`\n]*\bdd\.MM\b/ },
];

const sources = [];
(function collect(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (/\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) sources.push(full);
  }
})(root);
const rel = (file) => path.relative(root, file).split(path.sep).join("/");
const contents = new Map(sources.map((file) => [rel(file), fs.readFileSync(file, "utf8")]));

// Nur Aufrufe der Wien-Helfer zählen - eine eigene Funktion gleichen Namens (seasons/easter/plan.js) nicht.
const importsVienna = (text) => /from ["'](?:@\/lib\/vienna|\.\/vienna|\.\.\/lib\/vienna)["']/.test(text);

describe("Gegenprobe: die Muster erkennen, was sie sollen", () => {
  it("melden selbst gebaute Formen", () => {
    expect("return `${weekday} ${date}.${month}., ${clock}`;").toMatch(BUILT[0].pattern);
    expect("return `${match[3]}.${match[2]}.${match[1]}`;").toMatch(BUILT[0].pattern);
    expect('day.split("-").reverse().join(".")').toMatch(BUILT[1].pattern);
    expect('`${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`').toMatch(BUILT[2].pattern);
    expect("`${formatWhen(value)} Uhr`").toMatch(BUILT[3].pattern);
    expect("{formatDateTime(row.at)} Uhr").toMatch(BUILT[3].pattern);
    expect('format(value, "dd.MM.yyyy")').toMatch(BUILT[4].pattern);
    expect("viennaDateTime(value, WHEN)").toMatch(DIRECT);
    expect("const text = exitLine(row, viennaDate);").toMatch(DIRECT);
    expect('import { viennaDate } from "@/lib/vienna";').not.toMatch(DIRECT);
    expect("// mit viennaDateTime gerechnet").not.toMatch(DIRECT);
  });

  it("lassen Zahlen, Zeiten und Pfade in Ruhe", () => {
    const harmless = [
      "`Stand: ${rank}.${of}`",
      "`${ref.collection}.${ref.field}`",
      "`${minutes}:${String(seconds).padStart(2, \"0\")}.${String(millis).padStart(3, \"0\")}`",
      "`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, \"0\")}`",
      "`Antreten bis ${formatClock(call.report_by)} Uhr`",
      "`${base || \"qr-code\"}.${extension}`",
    ];
    for (const line of harmless) for (const { pattern } of BUILT) expect(line).not.toMatch(pattern);
    expect("formatWhen(value)").not.toMatch(DIRECT);
  });
});

describe("keine eigenen Datumsformen in src/", () => {
  it("die Wien-Helfer ruft nur lib/datetime.js - Seiten nehmen formatWhen & Co.", () => {
    const direct = [...contents].filter(([file, text]) => !DIRECT_ALLOWED[file] && importsVienna(text) && DIRECT.test(text)).map(([file]) => file);
    expect(direct, "formatWhen, formatRange, formatAgo, formatClock, formatMonth oder formatWeekday aus @/lib/datetime nehmen").toEqual([]);
  });

  it("kein Datum aus Einzelteilen zusammengesetzt", () => {
    const built = [];
    for (const [file, text] of contents) {
      if (BUILT_ALLOWED[file]) continue;
      for (const { name, pattern } of BUILT) if (pattern.test(text)) built.push(`${file}: ${name}`);
    }
    expect(built, "die Form kommt aus lib/datetime.js").toEqual([]);
  });

  it("die Ausnahmen gibt es noch - sonst gehören sie aus der Liste", () => {
    for (const file of [...Object.keys(DIRECT_ALLOWED), ...Object.keys(BUILT_ALLOWED)]) expect(contents.has(file), file).toBe(true);
  });
});
