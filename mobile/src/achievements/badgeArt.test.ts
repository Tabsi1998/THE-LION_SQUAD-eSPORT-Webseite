import fs from "fs";
import { ALIASES, MATERIAL_LOOKS, MOTIFS } from "./badgeArt.generated";
import { lookFor, materialColor, materialName, rankNotches, resolveArt } from "./badgeArt";

// Erfolge II (E13, #623): die Abzeichen-Kunst der App kommt aus dem Web und wird nicht von Hand gepflegt.
// Der Test baut die Daten frisch aus den Web-Dateien und vergleicht - ein neues Motiv im Web, ohne die App
// neu zu erzeugen, fällt hier auf (Abhilfe: `npm run sync:badge-art`).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { build, OUT } = require("../../scripts/sync-badge-art");

test("die erzeugte Datei passt zu den Motiven, Verwandten und Materialien des Webs", () => {
  const current = fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
  expect(current).toBe(build());
});

test("mindestens 140 Motive, jeder Verwandte zeigt auf ein Motiv, neun Materialien", () => {
  expect(Object.keys(MOTIFS).length).toBeGreaterThanOrEqual(140);
  for (const target of Object.values(ALIASES)) expect(MOTIFS[target]).toBeTruthy();
  expect(Object.keys(MATERIAL_LOOKS)).toEqual(["wood", "iron", "bronze", "silver", "gold", "platinum", "diamond", "legendary", "hidden"]);
  // Motive bestehen nur aus Elementen, die die App zeichnen kann.
  const tags = new Set(Object.values(MOTIFS).flat().map(([tag]) => tag));
  expect([...tags].sort()).toEqual(["circle", "ellipse", "path", "rect"]);
});

test("Motiv, Material und Kerben folgen denselben Regeln wie im Web", () => {
  expect(resolveArt("crossed-swords")).toBe("crossed-swords");
  expect(resolveArt("megaphone")).toBe("speech-wave");
  expect(resolveArt("gibt-es-nicht")).toBeNull();
  expect(lookFor("diamond").name).toBe("Diamant");
  expect(lookFor(null, 5).key).toBe("legendary");
  expect(lookFor(null, 5, { negative: true }).key).toBe("hidden");
  expect(lookFor(undefined, 2).key).toBe("silver");
  expect(rankNotches(4, "silver")).toBe(4);
  expect(rankNotches(undefined, "gold")).toBe(5);
  expect(rankNotches(undefined, "legendary")).toBe(0);
  expect(materialName({ material: "wood" })).toBe("Holz");
  expect(materialName({ level: 3 })).toBe("Gold");
  expect(materialName({ material_name: "Sonder" })).toBe("Sonder");
  expect(materialColor({ material: "platinum" })).toBe("#29B6E8");
});
