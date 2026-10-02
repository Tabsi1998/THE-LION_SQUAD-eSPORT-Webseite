import { hashString } from "../rng";
import { BOOT_COLORS, BOOT_PATHS, BOOT_VIEWBOX, FUR, FUR_BAND, TREATS, USED_TILT, bootWidth, cardFor, leafPath } from "./boot";

// Der Nikolausstiefel in der App (X3 #736): derselbe Stiefel wie im Web - derselbe Fingerabdruck steht in
// frontend/src/seasons/nikolaus/boot.test.js -, dieselben Sätze auf der Karte.

/** Derselbe Fingerabdruck wie im Web: weicht eine Seite ab, wird die andere rot. */
export const SHAPE_PARITY = 102233374;

test("Parität mit dem Web: derselbe Stiefel", () => {
  expect(hashString(JSON.stringify({ BOOT_VIEWBOX, BOOT_PATHS, BOOT_COLORS, FUR_BAND, FUR, TREATS, USED_TILT }))).toBe(SHAPE_PARITY);
});

test("Größe aus der Höhe, Blatt an der Mandarine", () => {
  expect(bootWidth(80)).toBe(64);
  expect(bootWidth(58)).toBe(46);
  expect(leafPath(TREATS.tangerine.full)).toBe("M 26 3.8 q 2.6 -2.4 4.6 -0.6 q -2.4 1.6 -4.6 0.6 z");
});

test("Karte: dieselben Sätze wie im Web", () => {
  const sticker = { id: "fluent-ogre", name: "Krampus", pack_name: "Vom Nikolaus", url: "/api/stickers/files/fluent/ogre.png" };
  expect(cardFor({ result: { new: true, sticker }, greeting: "Der Nikolaus war da" })).toEqual({ kind: "new", title: "Der Nikolaus war da", text: "Neu in deinen Stickern – im Chat unter „Vom Nikolaus“.", sticker });
  expect(cardFor({ result: { new: false, sticker } }).text).toBe("Den hat dir der Nikolaus heuer gebracht – im Chat unter „Vom Nikolaus“.");
  expect(cardFor({ result: { new: false, sticker: null } })).toMatchObject({ kind: "empty", text: "Schönen Nikolaustag!" });
  expect(cardFor({ reason: "guest" }).text).toBe("Wer angemeldet ist, findet im Stiefel einen Sticker.");
  expect(cardFor({ reason: "closed" }).title).toBe("Der Nikolaus kommt am 6. Dezember");
  expect(cardFor({ reason: "error" }).text).toContain("klemmt");
});
