import { readFileSync } from "node:fs";
import path from "node:path";
import { LONG_HEAD_NAME, headNameClass, isLongHeadName } from "@/lib/headName";

// Lange Überschriften und Namen am Handy (#1218): Namen im Profilkopf höchstens zweizeilig, lange Namen eine Stufe
// kleiner; feste lange Wörter in Überschriften tragen eine weiche Trennstelle, große Überschriften trennen am Handy.

const root = path.resolve(__dirname, "../..");
const read = (file) => readFileSync(path.join(root, file), "utf8").replace(/\r\n/g, "\n");

test("ab 16 Zeichen gilt ein Name als lang - Leerzeichen am Rand zählen nicht", () => {
  expect(LONG_HEAD_NAME).toBe(16);
  expect(isLongHeadName("PixelPanther")).toBe(false);
  expect(isLongHeadName("Nachtfalke1234567")).toBe(true);
  expect(isLongHeadName("  KurzerName  ")).toBe(false);
  expect(isLongHeadName("x".repeat(15))).toBe(false);
  expect(isLongHeadName("x".repeat(16))).toBe(true);
  expect(isLongHeadName(null)).toBe(false);
  expect(headNameClass("PixelPanther")).toBe("tls-head-name");
  expect(headNameClass("NachtfalkeDerSuperliga24")).toBe("tls-head-name tls-head-name--long");
});

test("feste lange Wörter in den Überschriften tragen eine weiche Trennstelle", () => {
  const headings = {
    "src/pages/public/MembersDirectoryPage.jsx": "Vereins&shy;mitglieder</ShortCaps></h1>",
    "src/pages/user/NotificationsPage.jsx": "Benachrichti&shy;gungen</ShortCaps></span></h1>",
    "src/pages/admin/AdminDashboardPage.jsx": "Kommando&shy;zentrale</ShortCaps></h1>",
    "src/pages/admin/AdminBenefitsPage.jsx": "Mitglieder&shy;vorteile</ShortCaps></h1>",
    // Seit „Mein Bereich“ (#2059) setzt der Rahmen die Überschrift - die Trennstelle steht bei den Gruppen und Seiten.
    "src/lib/meinBereich.js": 'heading: "Mitglieder\\u00ADvorteile"',
    "src/lib/meinBereich.js ": 'heading: "Vereins\\u00ADdokumente"',
    "src/lib/meinBereich.js  ": 'heading: "Benachrichti\\u00ADgungen"',
    "src/pages/user/meinBereich/GruppenSeiten.jsx": "title={meta.heading || meta.label}",
  };
  for (const [file, heading] of Object.entries(headings)) expect(read(file.trim()), file).toContain(heading);
});

test("Handy und Tablet trennen große Überschriften, am Handy wird die große Schrift kleiner", () => {
  const css = read("src/index.css");
  expect(css).toContain("@media (max-width: 1023px) {\n  h1, h2, .font-heading, .tls-type-hero, .tls-type-title {\n    -webkit-hyphens: auto;\n    hyphens: auto;");
  // Seit der Schrift-Treppe (#1302) gilt das für den Seitentitel: ein GROSSES Wort mit 14 Buchstaben passt bei 360 px.
  expect(css).toContain(".tls-type-title {\n    font-size: clamp(1.5rem, 7.8vw, var(--tls-type-title-size));");
  expect(css).toContain("\n.tls-type-title.tls-head-name--long {\n  font-size: clamp(1.375rem, 6.4vw, 1.875rem);");
  const name = css.slice(css.indexOf(".tls-head-name {"), css.indexOf("}", css.indexOf(".tls-head-name {")));
  expect(name).toContain("overflow-wrap: anywhere;");
  expect(name).toContain("-webkit-line-clamp: 2;");
});
