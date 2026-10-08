// Platzprüfung (#1295): Rechteck-Rechnung, Sperren je Karte und das Urteil „frei / belegt / nicht messbar“.

const room = require("./room");

beforeEach(() => room.resetRoom());

const card = { x: 20, y: 200, width: 320, height: 120 };

test("Überschneiden: Berühren zählt nicht, der Rand schon; leere Rechtecke sperren nie", () => {
  expect(room.overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
  expect(room.overlaps({ x: 0, y: 0, width: 10, height: 10 }, { x: 11, y: 0, width: 10, height: 10 }, 2)).toBe(true);
  expect(room.boxFree({ x: 0, y: 0, width: 10, height: 10 }, [{ x: 5, y: 5, width: 0, height: 0 }])).toBe(true);
  expect(room.boxFree({ x: 0, y: 0, width: 10, height: 10 }, [{ x: 5, y: 5, width: 4, height: 4 }])).toBe(false);
  expect(room.contains(card, { x: 30, y: 210, width: 50, height: 20 })).toBe(true);
  expect(room.contains({ x: 30, y: 210, width: 50, height: 20 }, card)).toBe(false);
});

test("Kästen: Band an der Unterkante (ragt hinaus), Streifen über der Oberkante, Netz in der Ecke, Fledermaus auf der Ecke", () => {
  expect(room.bandBox(card, room.HANG_BAND, 18)).toEqual({ x: 20, y: 310, width: 320, height: 18 });
  expect(room.topBox(card, 20)).toEqual({ x: 20, y: 180, width: 320, height: 20 });
  expect(room.cornerBox(card, "tl", 60, 62)).toEqual({ x: 20, y: 200, width: 60, height: 62 });
  expect(room.cornerBox(card, "tr", 60, 62)).toEqual({ x: 280, y: 200, width: 60, height: 62 });
  expect(room.batBox(card, "tl", 20, 23)).toEqual({ x: 32, y: 178, width: 20, height: 23 });
  expect(room.batBox(card, "tr", 20, 23)).toEqual({ x: 308, y: 178, width: 20, height: 23 });
  expect(room.batBox(card, "bottom", 22, 34)).toEqual({ x: 169, y: 319, width: 22, height: 34 });
});

test("Sperren je Karte und Nutzung: melden, abfragen, beim Verlassen vergessen - Zuhörer erfahren es", () => {
  const heard = jest.fn();
  const stop = room.subscribeRoom(heard);
  room.markBlocked("a", "chain");
  room.markBlocked("a", "chain");
  expect(heard).toHaveBeenCalledTimes(1);
  expect(room.isBlocked("a", "chain")).toBe(true);
  expect(room.isBlocked("a", "web:tl")).toBe(false);
  room.forgetBlocked("a");
  expect(room.isBlocked("a", "chain")).toBe(false);
  expect(heard).toHaveBeenCalledTimes(2);
  stop();
});

test("Melde-Schalter: aus, an, Zuhörer hören den Wechsel einmal", () => {
  const heard = jest.fn();
  const stop = room.subscribeRoomProbe(heard);
  expect(room.roomProbeOn()).toBe(false);
  room.setRoomProbe(true);
  room.setRoomProbe(true);
  expect(room.roomProbeOn()).toBe(true);
  expect(heard).toHaveBeenCalledTimes(1);
  stop();
});

test("Was sperrt: Schrift und Knöpfe überall, fremde Karten - nicht die eigene Karte und keine umschließende", async () => {
  room.registerRoom({ id: "t1", screen: "VereinHub", card: "join", kind: "text", measure: async () => [{ x: 34, y: 214, width: 120, height: 14 }] });
  room.registerRoom({ id: "own", screen: "VereinHub", card: "join", kind: "card", measure: async () => [card] });
  room.registerRoom({ id: "outer", screen: "VereinHub", card: null, kind: "card", measure: async () => [{ x: 0, y: 100, width: 360, height: 400 }] });
  room.registerRoom({ id: "next", screen: "VereinHub", card: null, kind: "card", measure: async () => [{ x: 20, y: 336, width: 320, height: 80 }] });
  room.registerRoom({ id: "other-screen", screen: "Dashboard", card: null, kind: "text", measure: async () => [{ x: 0, y: 0, width: 999, height: 999 }] });
  room.registerRoom({ id: "gone", screen: "VereinHub", card: null, kind: "control", measure: async () => null });
  const rects = await room.blockersFor("VereinHub", "join", card);
  expect(rects).toEqual([{ x: 34, y: 214, width: 120, height: 14 }, { x: 20, y: 336, width: 320, height: 80 }]);
});

test("Urteil: frei, belegt oder nicht messbar (dann bleibt die Deko)", async () => {
  room.registerRoom({ id: "title", screen: "VereinHub", card: null, kind: "text", measure: async () => [{ x: 20, y: 176, width: 90, height: 16 }] });
  const measure = async () => card;
  // Sitzend links oben über „VOM VEREIN“: belegt; rechts oben: frei.
  expect(await room.checkRoom("VereinHub", "club", measure, (rect: typeof card) => [room.batBox(rect, "tl", 20, 23)])).toBe(false);
  expect(await room.checkRoom("VereinHub", "club", measure, (rect: typeof card) => [room.batBox(rect, "tr", 20, 23)])).toBe(true);
  expect(await room.checkRoom("VereinHub", "club", async () => null, () => [card])).toBeNull();
  expect(await room.checkRoom("VereinHub", "club", measure, () => [])).toBe(true);
});
