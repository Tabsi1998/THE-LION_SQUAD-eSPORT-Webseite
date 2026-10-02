import { hashString } from "../rng";
import { BOOT_COLORS, BOOT_MIN_HEIGHT, BOOT_PATHS, BOOT_RIGHT, BOOT_SIZE, BOOT_VIEWBOX, FUR, FUR_BAND, TREATS, USED_TILT, bootFit, cardFor, leafPath } from "./boot";

// Der Nikolausstiefel (X3, #736): dieselbe Form wie in der App (derselbe Fingerabdruck in
// mobile/src/seasons/nikolaus/boot.test.ts), und was die Karte über dem Stiefel sagt.

const SHAPE_PARITY = 102233374;

test("Parität mit der App: derselbe Stiefel", () => {
  expect(hashString(JSON.stringify({ BOOT_VIEWBOX, BOOT_PATHS, BOOT_COLORS, FUR_BAND, FUR, TREATS, USED_TILT }))).toBe(SHAPE_PARITY);
});

test("Form: der Inhalt schaut oben heraus, der Stiefel steht unten auf der Linie, das Fell deckt den Rand", () => {
  expect(BOOT_VIEWBOX.y).toBeLessThan(TREATS.voucher.y);
  expect(BOOT_VIEWBOX.y + BOOT_VIEWBOX.height).toBeGreaterThanOrEqual(68.2);
  expect(BOOT_SIZE.width / BOOT_SIZE.height).toBeCloseTo(BOOT_VIEWBOX.width / BOOT_VIEWBOX.height, 2);
  const left = Math.min(...FUR.map(([x, , r]) => x - r));
  const right = Math.max(...FUR.map(([x, , r]) => x + r));
  expect(left).toBeLessThan(13);
  expect(right).toBeGreaterThan(46);
  expect(leafPath({ cx: 25.5, cy: 8.6 })).toBe("M 26 3.8 q 2.6 -2.4 4.6 -0.6 q -2.4 1.6 -4.6 0.6 z");
  expect(USED_TILT.angle).toBeLessThan(0);
});

test("Platz: am PC frei vom Knopf rechts unten und groß, auf dem Handy so hoch, wie über der Linie Platz ist", () => {
  expect(bootFit({ line: null })).toEqual({ right: BOOT_RIGHT.wide, height: BOOT_SIZE.height, width: BOOT_SIZE.width });
  const pcLine = { top: 900, right: 1440, left: 0, bottom: 901, width: 1440, height: 1 };
  const column = { left: 1088, right: 1388, top: 700, bottom: 744, width: 300, height: 44 };
  expect(bootFit({ line: pcLine, blockers: [column], viewportWidth: 1440 })).toEqual({ right: 96, height: 75, width: 60 });
  // Handy: die Social-Leiste endet 49 px über der Linie - der Stiefel wird kleiner, statt sie zu verdecken.
  const phoneLine = { top: 900, right: 390, left: 0, bottom: 901, width: 390, height: 1 };
  const icon = { left: 300, right: 344, top: 807, bottom: 851, width: 44, height: 44 };
  const below = { left: 0, right: 390, top: 905, bottom: 925, width: 390, height: 20 };
  expect(bootFit({ line: phoneLine, blockers: [icon, below], viewportWidth: 390 })).toEqual({ right: BOOT_RIGHT.narrow, height: 43, width: 34 });
  const tight = { ...icon, bottom: 890, top: 846 };
  expect(bootFit({ line: phoneLine, blockers: [tight], viewportWidth: 390 }).height).toBe(BOOT_MIN_HEIGHT);
  const aside = { ...icon, left: 10, right: 60 };
  expect(bootFit({ line: phoneLine, blockers: [aside], viewportWidth: 390 }).height).toBe(BOOT_SIZE.height);
});

test("Karte: neuer Sticker, derselbe noch einmal, leerer Stiefel, ohne Anmeldung, nicht heute, klemmt", () => {
  const sticker = { id: "fluent-ogre", name: "Krampus", pack_name: "Vom Nikolaus", url: "/api/stickers/files/fluent/ogre.png" };
  expect(cardFor({ result: { new: true, sticker }, greeting: "Der Nikolaus war da" })).toEqual({ kind: "new", title: "Der Nikolaus war da", text: "Neu in deinen Stickern – im Chat unter „Vom Nikolaus“.", sticker });
  expect(cardFor({ result: { new: false, sticker } })).toMatchObject({ kind: "again", title: "Der Nikolaus war da", text: expect.stringContaining("heuer gebracht") });
  expect(cardFor({ result: { new: false, sticker: null } })).toMatchObject({ kind: "empty", sticker: null });
  expect(cardFor({ reason: "guest" })).toMatchObject({ kind: "guest", text: expect.stringContaining("angemeldet") });
  expect(cardFor({ reason: "closed" })).toMatchObject({ kind: "closed", title: "Der Nikolaus kommt am 6. Dezember" });
  expect(cardFor({ reason: "error" })).toMatchObject({ kind: "error", text: expect.stringContaining("klemmt") });
  expect(cardFor()).toMatchObject({ kind: "error" });
});
