import { renderRulesSection } from "./leagueRules";
import TABLE from "../../e2e/fixtures/allowed-tabelle.json";
import BY_WEAPON from "../../e2e/fixtures/allowed-je-waffe.json";

// Erlaubte Ausrüstung im Regelwerk (#2305, layout 5): so, wie der Server den Baustein ausliefert (Fixture aus dem echten Server-Code),
// macht `markdownLite` daraus je Kategorie mit Waffen eine Tabelle, an der `rules.css` sie erkennt: Kopf mit Marke (th > u), je Waffe
// Bild · Name · Ausnahmen, je Slot eine Marke (u). Eine Fassung mit layout 4 bleibt bei den Karten. Erfundene Namen.

function annex(markdown) {
  const root = document.createElement("div");
  root.innerHTML = renderRulesSection(markdown);
  return root;
}

const rowOf = (root, name) => [...root.querySelectorAll("tr")].find((row) => row.textContent.includes(name));

test("layout 5: eine Tabelle je Kategorie mit Waffen, Ausnahmen je Slot, „nur erlaubt“ an der langen Zeile", () => {
  const root = annex(TABLE.block_md);
  const tables = [...root.querySelectorAll(".prose-cms-table")].filter((node) => node.querySelector("th > u"));
  expect(tables).toHaveLength(1);
  expect([...tables[0].querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["Bild", "Waffe", "Aufsätze"]);

  const sniper = rowOf(root, "Falke 50").querySelectorAll("td");
  expect(sniper[0].querySelector("img").getAttribute("alt")).toBe("Ausrüstung");
  expect(sniper[1].querySelector("u").textContent).toBe("Falke 50 Präzisionsgewehr mit langem Namen");
  expect(sniper[2].firstElementChild.tagName).toBe("EM");
  expect(sniper[2].firstElementChild.textContent).toBe("nur erlaubt:");
  const slots = [...sniper[2].querySelectorAll(":scope > u")].map((slot) => slot.textContent);
  expect(slots).toEqual(["Mündung: Schalldämpfer leicht", "Lauf: Präzisionslauf 30 Zoll",
    "Optik: Zielfernrohr 12x Variabel (nur in Suchen & Zerstören), Zielfernrohr 8x", "Schaft: Schwerer Schaft",
    "Magazin: Erweitertes Magazin", "Unterlauf: Zweibein"]);
  expect(sniper[2].querySelector("u > em").textContent).toBe("Mündung:");

  const habicht = rowOf(root, "Habicht 7").querySelectorAll("td");
  expect(habicht[0].querySelector("img")).toBeNull();
  expect([...habicht[2].querySelectorAll(":scope > strong")].map((lead) => lead.textContent)).toEqual(["gesperrt:", "eingeschränkt:"]);
  expect(habicht[2].textContent).toContain("Optik: Thermalvisier (nicht in Suchen & Zerstören)");
  expect(rowOf(root, "Blitz 9").querySelectorAll("td")[2].innerHTML).toBe("<em>alle passenden Aufsätze erlaubt</em>");

  // Kopf einer Waffenklasse: zweite Zelle ohne Waffen-Namen (u), mit Symbol in der ersten.
  const klass = rowOf(root, "Schrotflinte").querySelectorAll("td");
  expect(klass[1].querySelector("u")).toBeNull();
  expect(klass[1].textContent).toBe("Schrotflinte · nicht erlaubt (Bö, Hagel)");
  expect(klass[0].querySelector("img").getAttribute("alt")).toBe("Klassen-Symbol");
  expect(root.textContent).toContain("An keiner Waffe erlaubt: Kompensator");
  expect(root.textContent).not.toContain("\\");
  // Die übrige Ausrüstung bleibt Karten.
  expect(root.querySelectorAll("ul > li > u")).toHaveLength(1);
});

test("layout 4 bleibt bei den Karten mit dem Satz je Waffe", () => {
  const root = annex(BY_WEAPON.block_md);
  expect(root.querySelector("th > u")).toBeNull();
  expect(root.textContent).toContain("alle passenden Aufsätze erlaubt, außer:");
  expect(root.querySelectorAll("ul > li > u").length).toBeGreaterThan(3);
});
