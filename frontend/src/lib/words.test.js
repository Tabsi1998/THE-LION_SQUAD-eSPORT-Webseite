import { describe, expect, test } from "vitest";
import { AVOID, WORDS, nameWithSubtitle, teamLeadsWord } from "./words";

const fs = require("fs");
const path = require("path");

const SOURCE_ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set(["build", "coverage", "node_modules", "admin"]);
const SOURCE_EXTENSIONS = new Set([".js", ".jsx"]);

// Begründete Ausnahmen: Diese Dateien gehören zur Verwaltung (eigene Wortliste, Idee 66) oder nennen fremde
// Produktnamen („Login Kit“, „Facebook Login“, „Epic Account Services“), die so heißen.
const EXEMPT_FILES = new Set([
  "lib/words.js",
  "lib/adminFaq.js",
  "lib/integrations.js",
  "lib/platformLinks.js",
  "lib/setupGuides.js",
  // Profil → Socials: „Login oder Adresse“ meint den GitHub-Benutzernamen, so heißt er bei GitHub.
  "pages/user/profile/socials.js",
]);

function sourceFiles(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : sourceFiles(fullPath);
    if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) return [];
    if (/\.(test|spec)\.[jt]sx?$/.test(entry.name) || /^Admin/.test(entry.name)) return [];
    return [fullPath];
  });
}

// Kommentare zählen nicht als sichtbarer Text: Block-Kommentare und Zeilen-Kommentare werden vorher entfernt
// (Zeilenumbrüche bleiben, damit die Zeilennummer stimmt). „//“ in Adressen („https://“) bleibt stehen.
function withoutComments(text) {
  const noBlocks = text.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
  return noBlocks
    .split("\n")
    .map((line) => line.replace(/(^|[^:"'`])\/\/.*$/, "$1"))
    .join("\n");
}

function lineForIndex(text, index) {
  return text.slice(0, index).split("\n").length;
}

describe("Wortliste der Website (#1238)", () => {
  test("die Liste nennt die vereinbarten Wörter", () => {
    expect(WORDS.signIn).toBe("Anmelden");
    expect(WORDS.account).toBe("Konto");
    expect(WORDS.achievements).toBe("Erfolge");
    expect(WORDS.joinClub).toBe("Mitglied werden");
  });

  test("sichtbare Texte nehmen das Wort aus der Liste, nicht die Ausweichform", () => {
    const pattern = new RegExp(`\\b(${Object.keys(AVOID).join("|")})\\b`, "g");
    const findings = [];
    for (const file of sourceFiles(SOURCE_ROOT)) {
      const relative = path.relative(SOURCE_ROOT, file).split(path.sep).join("/");
      if (EXEMPT_FILES.has(relative)) continue;
      const text = withoutComments(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
      for (const match of text.matchAll(pattern)) {
        findings.push(`${relative}:${lineForIndex(text, match.index)} „${match[0]}“ -> ${AVOID[match[0]]}`);
      }
    }
    expect(findings).toEqual([]);
  });
});

describe("nameWithSubtitle (#1238)", () => {
  test("hängt den Untertitel an", () => {
    expect(nameWithSubtitle("THE LION SQUAD", "eSports")).toBe("THE LION SQUAD — eSports");
  });

  test("steht der Untertitel schon im Namen, kommt er nicht doppelt", () => {
    expect(nameWithSubtitle("THE LION SQUAD - eSPORTS", "eSPORTS")).toBe("THE LION SQUAD - eSPORTS");
    expect(nameWithSubtitle("THE LION SQUAD - eSPORTS", "esports")).toBe("THE LION SQUAD - eSPORTS");
  });

  test("ohne Untertitel oder ohne Namen bleibt nur das, was da ist", () => {
    expect(nameWithSubtitle("THE LION SQUAD", "")).toBe("THE LION SQUAD");
    expect(nameWithSubtitle("", "eSports")).toBe("eSports");
  });
});

describe("teamLeadsWord (#2542, #2591)", () => {
  test("in der Liga Captains, sonst Teamleitungen - wie die App, nie Team-Captains", () => {
    expect(teamLeadsWord(true)).toBe("Captains");
    expect(teamLeadsWord(false)).toBe("Teamleitungen");
    expect(AVOID["Team-Captains"]).toMatch(/Teamleitungen/);
  });
});
