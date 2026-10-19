import fs from "fs";
import path from "path";
import { BRONZE_SECTIONS, FINAL_SECTIONS, LOSER_SECTIONS, MAIN_SECTIONS, sectionKind } from "./bracketSections";

// Abschnittsnamen (#1633): dieselben Listen wie Server, Web und TV (frontend/src/lib/bracketSections.json, aus
// services/round_labels.py) - wird dort ein Name ergänzt, schlägt dieser Test an.
const SHARED = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../frontend/src/lib/bracketSections.json"), "utf8"));

test("die Listen sind 1:1 die des Servers", () => {
  expect([...MAIN_SECTIONS].sort()).toEqual([...SHARED.main].sort());
  expect([...LOSER_SECTIONS].sort()).toEqual([...SHARED.loser].sort());
  expect([...FINAL_SECTIONS].sort()).toEqual([...SHARED.final].sort());
  expect([...BRONZE_SECTIONS].sort()).toEqual([...SHARED.bronze].sort());
});

test("„FINAL“ ist das Grand Final, „BR“ das Spiel um Platz 3 - auch mit Leerraum und Großbuchstaben", () => {
  expect(["FINAL", " Grand Final ", "GF", "grand_final"].map(sectionKind)).toEqual(Array(4).fill("grand_final"));
  expect(["BR", "Spiel um Platz 3", "bronze"].map(sectionKind)).toEqual(Array(3).fill("bronze"));
  expect(["LB", "Lower_Bracket", "looser"].map(sectionKind)).toEqual(Array(3).fill("loser"));
  expect(["WB", "", undefined, "group_a", "round_robin"].map(sectionKind)).toEqual(["main", "main", "main", "group", "group"]);
});
