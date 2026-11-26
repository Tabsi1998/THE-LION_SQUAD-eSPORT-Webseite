import fs from "fs";
import path from "path";

// Wächter „keine Wege, die es nicht mehr gibt“ (#2059): seit Mein Bereich gibt es kein Zahnrad und keine Seite
// „Einstellungen“ mehr. Was die App sagt, nennt die Gruppen von Mein Bereich (Datenschutz, Benachrichtigungen, Konto &
// Sicherheit …). Kommentare zählen nicht, nur was im Quelltext steht - Texte, Hinweise, Fehlermeldungen.

const SRC = path.resolve(__dirname, "..");

function quellen(dir: string): string[] {
  return fs.readdirSync(path.join(SRC, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return quellen(relative);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [relative] : [];
  });
}

/** Ohne Kommentare - Block-Kommentare (auch in JSX) und Zeilen-Kommentare, nicht aber „https://“ in Adressen. */
export function ohneKommentare(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

// Was es nicht mehr gibt - mit dem Weg, der jetzt gilt.
const ALT: Array<[RegExp, string]> = [
  [/Einstellungen\s*→/, "Mein Bereich → <Gruppe>"],
  [/Zahnrad/, "Mein Bereich"],
  [/in den Einstellungen (unter|„|bei)/, "unter Mein Bereich → <Gruppe>"],
  [/unter „Einstellungen“/, "unter Mein Bereich → <Gruppe>"],
  [/im Profil unter (?!„Nur für dich“)/, "unter Mein Bereich → <Gruppe>"],
  [/(?<!Bereich → )Profil\s*→/, "Mein Bereich → Profil → …"],
  [/Profil-Tab|im Tab Profil/, "Tab Mein Bereich"],
];

test("ohneKommentare lässt Adressen und Texte stehen", () => {
  expect(ohneKommentare("const a = \"https://x\"; // weg\n/* auch weg */ b")).toBe("const a = \"https://x\"; \n               b");
});

test("die App nennt keine Wege, die es seit Mein Bereich nicht mehr gibt", () => {
  const funde: string[] = [];
  for (const file of quellen(".")) {
    const lines = ohneKommentare(fs.readFileSync(path.join(SRC, file), "utf8")).split("\n");
    lines.forEach((line, index) => {
      for (const [muster, statt] of ALT) {
        if (muster.test(line)) funde.push(`${file}:${index + 1} ${String(line.match(muster)?.[0])} → ${statt}`);
      }
    });
  }
  expect(funde).toEqual([]);
});
