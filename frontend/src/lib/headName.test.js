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
    "src/pages/public/MembersDirectoryPage.jsx": "Vereins&shy;mitglieder</h1>",
    "src/pages/user/NotificationsPage.jsx": "Benachrichti&shy;gungen</span></h1>",
    "src/pages/admin/AdminDashboardPage.jsx": "Kommando&shy;zentrale</h1>",
    "src/pages/admin/AdminClubMemberProfilesPage.jsx": "Vereins&shy;mitglieder</h1>",
    "src/pages/admin/AdminMembersPage.jsx": "Mitglieder&shy;verwaltung</h1>",
    "src/pages/admin/AdminBenefitsPage.jsx": "Mitglieder&shy;vorteile</h1>",
    "src/pages/user/MemberBenefitsPage.jsx": "Mitglieder&shy;vorteile</h1>",
    "src/pages/user/MemberDocumentsPage.jsx": "Vereins&shy;dokumente</h1>",
  };
  for (const [file, heading] of Object.entries(headings)) expect(read(file), file).toContain(heading);
});

test("Handy und Tablet trennen große Überschriften, am Handy wird die große Schrift kleiner", () => {
  const css = read("src/index.css");
  expect(css).toContain("@media (max-width: 1023px) {\n  h1, h2, .font-heading {\n    -webkit-hyphens: auto;\n    hyphens: auto;");
  expect(css).toContain(":is(h1, h2).font-heading:is(.text-4xl, .text-5xl, .text-6xl, .text-7xl, .text-8xl) {\n    font-size: clamp(1.5rem, 7.8vw, 2.25rem);");
  const name = css.slice(css.indexOf(".tls-head-name {"), css.indexOf("}", css.indexOf(".tls-head-name {")));
  expect(name).toContain("overflow-wrap: anywhere;");
  expect(name).toContain("-webkit-line-clamp: 2;");
});
