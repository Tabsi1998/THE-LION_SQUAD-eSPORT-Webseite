import { assignEggs, cornersFor, type PerchInfo } from "./placement";
import type { HuntEgg } from "./api";

// Wo die Eier eines Screens liegen (#647): „Karte N“ von oben nach unten, reihum bei weniger Karten; der Held ist die
// Begrüßungskarte, „Kopf“ die oberste Karte; je Ecke ein Ei; verteilte Eier bleiben, solange ihre Karte da ist.

function egg(no: number, spot: HuntEgg["spot"], pattern: HuntEgg["pattern"] = "dots"): HuntEgg {
  return { egg_no: no, token: `${no}.t`, spot, pattern, found: false };
}

function perch(id: string, y: number, kind: PerchInfo["kind"] = "card", x = 16): PerchInfo {
  return { id, kind, rect: { x, y, width: 360, height: 100 } };
}

const PERCHES = [perch("c3", 520), perch("hero", 60, "hero"), perch("c1", 180), perch("c2", 300)];

test("die gewünschte Ecke zuerst", () => {
  expect(cornersFor("top-left")).toEqual(["tl", "br", "bl", "tr"]);
  expect(cornersFor()).toEqual(["br", "bl", "tr", "tl"]);
});

test("Karte N von oben, reihum; Held und Kopf; je Ecke ein Ei", () => {
  const spots = assignEggs([
    egg(1, { kind: "card", index: 0, place: "top-right" }),
    egg(2, { kind: "card", index: 4, place: "bottom-left" }),
    egg(3, { kind: "hero", place: "bottom-right" }),
    egg(4, { kind: "header", place: "top-left" }),
    egg(5, { kind: "card", index: 0, place: "top-right" }),
  ], PERCHES);
  const byEgg = Object.fromEntries(spots.map((spot) => [spot.egg.egg_no, `${spot.perchId}:${spot.corner}`]));
  expect(byEgg[1]).toBe("c1:tr");
  // Index 4 bei drei Karten: reihum die zweite.
  expect(byEgg[2]).toBe("c2:bl");
  expect(byEgg[3]).toBe("hero:br");
  // Kopf = die oberste Karte überhaupt (der Held).
  expect(byEgg[4]).toBe("hero:tl");
  // Die Ecke ist belegt - das Ei nimmt die nächste derselben Karte.
  expect(byEgg[5]).toBe("c1:br");
});

test("verteilte Eier bleiben, solange ihre Karte da ist - nur Eier ohne Karte werden neu verteilt", () => {
  const eggs = [egg(1, { kind: "card", index: 0, place: "top-right" }), egg(2, { kind: "card", index: 1, place: "top-right" })];
  const first = assignEggs(eggs, PERCHES);
  // Gescrollt: alle Karten weiter oben, eine ist weg (ausgeblendete Liste) - Ei 1 bleibt, Ei 2 sucht neu.
  const moved = [perch("hero", -200, "hero"), perch("c1", -80), perch("c3", 260)];
  const again = assignEggs(eggs, moved, first);
  expect(again.find((spot) => spot.egg.egg_no === 1)).toMatchObject({ perchId: "c1", corner: "tr" });
  expect(again.find((spot) => spot.egg.egg_no === 2)?.perchId).toBe("c3");
  // Ein gefundenes Ei fällt weg.
  expect(assignEggs([eggs[1]], PERCHES, first).map((spot) => spot.egg.egg_no)).toEqual([2]);
});

test("ohne Karten liegt nichts; ohne Held nimmt das Held-Ei eine Karte", () => {
  expect(assignEggs([egg(1, { kind: "card" })], [])).toEqual([]);
  const spots = assignEggs([egg(1, { kind: "hero", place: "top-left" })], [perch("c1", 100)]);
  expect(spots[0]).toMatchObject({ perchId: "c1", corner: "tl" });
});
