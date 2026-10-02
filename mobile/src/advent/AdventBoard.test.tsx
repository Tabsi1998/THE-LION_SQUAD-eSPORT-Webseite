import React from "react";
import { Animated, StyleSheet } from "react-native";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import { AdventBoard } from "./AdventBoard";
import { bandInsets, leafTint, radii } from "./DoorTile";
import { cellOf, doorVariant, hingeAt, type Calendar, type Door } from "./doors";

// Das Brett des Adventkalenders in der App (#641, #732, #642): 24 Türchen in der Anordnung des Servers; verschlossen
// rüttelt es nur, offen geht es auf, geöffnet zeigt es seinen Inhalt - und was noch zu ist, verrät nichts.

jest.mock("../lib/api", () => ({ resolveMediaUrl: (value?: string | null) => (value ? `https://lionsquad.at${value}` : "") }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
const mockScene = jest.fn((year: number, _options?: unknown) => `<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#0a1230"/><text>${year}</text></svg>`);
jest.mock("./scene", () => ({ sceneSvg: (year: number, options?: unknown) => mockScene(year, options) }));

const ORDER = [8, 22, 9, 14, 5, 13, 17, 12, 2, 18, 6, 16, 19, 7, 10, 3, 24, 23, 11, 15, 21, 4, 1, 20];

function calendar({ today = 12, opened = [1, 2], extra = {} }: { today?: number; opened?: number[]; extra?: Partial<Calendar> } = {}): Calendar {
  const doors: Door[] = [];
  for (let day = 1; day <= 24; day += 1) {
    const state = day > today ? "locked" : opened.includes(day) ? "opened" : "available";
    const door: Door = { day, opens_at: `2026-12-${String(day).padStart(2, "0")}T06:00:00+01:00`, seed: 7919 * day + 13, state };
    if (state === "opened") door.content = { kind: day === 2 ? "quiz" : "text", title: `Inhalt ${day}`, body: "Text", media_url: null, link: null };
    doors.push(door);
  }
  return { active: true, year: 2026, order: ORDER, doors, catch_up: today > 24, newest_door: Math.min(24, today), opened: opened.length, total: 24, ...extra };
}

async function setup({ width = 360, busyDay = null, still = false, ...options }: { width?: number; busyDay?: number | null; still?: boolean; today?: number; opened?: number[]; extra?: Partial<Calendar> } = {}) {
  const handlers = { onOpen: jest.fn(), onShow: jest.fn(), onLocked: jest.fn() };
  const view = await render(<AdventBoard calendar={calendar(options)} busyDay={busyDay} still={still} {...handlers} />);
  await fireEvent(screen.getByTestId("advent-board"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width, height: 0 } } });
  return { ...handlers, ...view };
}

function styleOf(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style) as Record<string, unknown>;
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

test("24 Türchen in der Anordnung des Servers, mit dem Bild des Jahres", async () => {
  await setup();
  expect(screen.getByLabelText("Adventkalender 2026: 24 Türchen")).toBeTruthy();
  expect(screen.getByTestId("advent-scene")).toBeTruthy();
  // Das Bild der App kommt ohne Weichzeichner - dasselbe Bild wie im Web, nur ohne Filter.
  expect(mockScene).toHaveBeenCalledWith(2026, { filters: false });
  const cells = screen.getAllByTestId(/^advent-door-\d+$/);
  expect(cells.map((cell) => Number(String(cell.props.testID).split("-")[2]))).toEqual(ORDER);
});

test("vor dem Messen steht nur der Rahmen - kein Türchen in falscher Größe", async () => {
  const handlers = { onOpen: jest.fn(), onShow: jest.fn(), onLocked: jest.fn() };
  await render(<AdventBoard calendar={calendar()} {...handlers} />);
  expect(screen.getByTestId("advent-frame")).toBeTruthy();
  expect(screen.queryAllByTestId(/^advent-door-\d+$/)).toHaveLength(0);
  expect(screen.queryByTestId("advent-scene")).toBeNull();
});

test("Spalten je Breite: 3 am Handy, 4 und 6 am Tablet - nichts ragt über den Rand", async () => {
  for (const [width, columns] of [[360, 3], [700, 4], [1000, 6]] as const) {
    const view = await setup({ width });
    const size = width / columns;
    expect(styleOf("advent-board").height).toBeCloseTo(size * (24 / columns), 5);
    for (const day of [1, 12, 24]) expect(styleOf(`advent-door-${day}`)).toMatchObject({ width: size, height: size });
    await view.unmount();
  }
});

test("Zustände: verschlossen, offen, geöffnet - und das heutige trägt sein Schild", async () => {
  await setup();
  expect(screen.getByLabelText("Türchen 12 öffnen – das heutige")).toBeTruthy();
  expect(screen.getByLabelText("Türchen 11 öffnen")).toBeTruthy();
  expect(screen.getByLabelText("Türchen 20 – öffnet sich am 20. Dezember, 6 Uhr")).toBeTruthy();
  expect(screen.getByLabelText("Türchen 2 – geöffnet: Inhalt 2")).toBeTruthy();
  expect(screen.getAllByTestId("advent-today")).toHaveLength(1);
  expect(within(screen.getByTestId("advent-door-12")).getByText("HEUTE")).toBeTruthy();
  // Licht im Spalt nur dort, wo ein Türchen aufgehen darf.
  expect(screen.getAllByTestId(/^advent-halo-\d+$/)).toHaveLength(10);
  expect(screen.queryByTestId("advent-halo-2")).toBeNull();
  expect(screen.queryByTestId("advent-halo-20")).toBeNull();
});

test("nur geöffnete Türchen zeigen etwas von ihrem Inhalt", async () => {
  await setup();
  expect(screen.getAllByTestId("advent-niche-preview")).toHaveLength(2);
  expect(within(screen.getByTestId("advent-door-2")).getByText("Inhalt 2")).toBeTruthy();
  for (const day of [11, 12, 20, 24]) {
    const cell = within(screen.getByTestId(`advent-door-${day}`));
    expect(cell.queryByTestId("advent-niche-preview")).toBeNull();
    expect(cell.queryByText(/Inhalt/)).toBeNull();
    // Die Zahl des Tages steht auf dem Schildchen - und auf der Rückseite des Flügels.
    expect(cell.getAllByText(String(day)).length).toBeGreaterThanOrEqual(2);
  }
});

test("beim Nachholen gibt es kein heutiges Türchen", async () => {
  await setup({ today: 30, opened: [1] });
  expect(screen.queryByTestId("advent-today")).toBeNull();
  expect(screen.getByLabelText("Türchen 24 öffnen")).toBeTruthy();
});

test("Tippen: offen geht auf, geöffnet zeigt, verschlossen sagt, wann es so weit ist", async () => {
  const { onOpen, onShow, onLocked } = await setup();
  await fireEvent.press(screen.getByTestId("advent-door-button-12"));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ day: 12, state: "available" }));
  await fireEvent.press(screen.getByTestId("advent-door-button-2"));
  expect(onShow).toHaveBeenCalledWith(expect.objectContaining({ day: 2, state: "opened" }));
  await fireEvent.press(screen.getByTestId("advent-door-button-20"));
  expect(onLocked).toHaveBeenCalledWith(expect.objectContaining({ day: 20, state: "locked" }));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onShow).toHaveBeenCalledTimes(1);
  expect(onLocked).toHaveBeenCalledTimes(1);
});

test("während ein Türchen aufgeht, öffnet kein zweites", async () => {
  const { onOpen, onShow, onLocked } = await setup({ busyDay: 12 });
  await fireEvent.press(screen.getByTestId("advent-door-button-11"));
  await fireEvent.press(screen.getByTestId("advent-door-button-12"));
  expect(onOpen).not.toHaveBeenCalled();
  // Ansehen und Nachfragen gehen weiter.
  await fireEvent.press(screen.getByTestId("advent-door-button-2"));
  await fireEvent.press(screen.getByTestId("advent-door-button-20"));
  expect(onShow).toHaveBeenCalledTimes(1);
  expect(onLocked).toHaveBeenCalledTimes(1);
});

test("jedes Türchen trägt seine Eigenheiten - am Rand mit dem Scharnier nach innen", async () => {
  await setup();
  const origins: Record<string, string> = { left: "left center", right: "right center", top: "center top" };
  for (const [index, day] of ORDER.entries()) {
    const variant = doorVariant(7919 * day + 13);
    const cell = cellOf(index, 3);
    const hinge = hingeAt(variant.hinge, cell, 3);
    if (hinge === "double") {
      expect(styleOf(`advent-leaf-${day}-a-front`).transformOrigin).toBe("left center");
      expect(styleOf(`advent-leaf-${day}-b-front`).transformOrigin).toBe("right center");
      expect(styleOf(`advent-leaf-${day}-b-back`).transformOrigin).toBe("right center");
      expect(cell.col).toBe(1);
    } else {
      expect(styleOf(`advent-leaf-${day}-single-front`).transformOrigin).toBe(origins[hinge]);
      expect(styleOf(`advent-leaf-${day}-single-back`).transformOrigin).toBe(origins[hinge]);
      if (cell.col === 0) expect(hinge).not.toBe("left");
      if (cell.col === 2) expect(hinge).not.toBe("right");
      if (cell.row === 0) expect(hinge).not.toBe("top");
    }
  }
});

test("Form und Farbe des Flügels", () => {
  expect(radii("rect", 100)).toEqual({ borderTopLeftRadius: 7, borderBottomLeftRadius: 7, borderTopRightRadius: 7, borderBottomRightRadius: 7 });
  expect(radii("arch", 100)).toEqual({ borderTopLeftRadius: 42, borderBottomLeftRadius: 7, borderTopRightRadius: 42, borderBottomRightRadius: 7 });
  expect(radii("round", 100)).toEqual({ borderTopLeftRadius: 50, borderBottomLeftRadius: 50, borderTopRightRadius: 50, borderBottomRightRadius: 50 });
  // Zwei Flügel: die Mitte bleibt gerade, damit die Flügel aneinander schließen.
  expect(radii("arch", 100, "a")).toEqual({ borderTopLeftRadius: 42, borderBottomLeftRadius: 7, borderTopRightRadius: 0, borderBottomRightRadius: 0 });
  expect(radii("arch", 100, "b")).toEqual({ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderTopRightRadius: 42, borderBottomRightRadius: 7 });
  // Oben Nachtblau, unten Schnee - wie das Bild an dieser Stelle.
  expect([0, 3, 5, 6, 7].map((row) => leafTint(row, 8))).toEqual(["#101c42", "#101c42", "#1b2a58", "#8fa3cf", "#8fa3cf"]);
  expect(leafTint(0, 1)).toBe("#101c42");
});

test("der Flügel hat zwei Seiten: vorne durchsichtig bis Papier, hinten cremefarben mit der Zahl", async () => {
  await setup();
  const front = styleOf("advent-leaf-2-single-front");
  const back = styleOf("advent-leaf-2-single-back");
  expect(front.backfaceVisibility).toBe("hidden");
  expect(back.backfaceVisibility).toBe("hidden");
  expect(back.backgroundColor).toBe("#e6dab8");
  // Beide Seiten drehen sich einzeln um das Scharnier, die Rückseite um 180 Grad versetzt - Türchen 2 steht offen.
  const variant = doorVariant(7919 * 2 + 13);
  const hinge = hingeAt(variant.hinge, cellOf(ORDER.indexOf(2), 3), 3);
  const axis = hinge === "top" ? "rotateX" : "rotateY";
  const sign = hinge === "left" ? -1 : 1;
  expect(front.transform).toEqual([{ perspective: 800 }, { [axis]: `${sign * variant.angle}deg` }]);
  expect(back.transform).toEqual([{ perspective: 800 }, { [axis]: `${180 + sign * variant.angle}deg` }]);
  // Ein verschlossenes Türchen: vorne gerade, hinten abgewandt.
  const closedFront = (styleOf("advent-leaf-20-single-front").transform as Array<Record<string, string>>)[1];
  const closedBack = (styleOf("advent-leaf-20-single-back").transform as Array<Record<string, string>>)[1];
  expect(Object.values(closedFront)).toEqual(["0deg"]);
  expect(Object.values(closedBack)).toEqual(["180deg"]);
  expect(within(screen.getByTestId("advent-leaf-2-single-back")).getByText("2")).toBeTruthy();
});

test("das Titelband über einem Bild rückt in runden Nischen nach innen", async () => {
  expect(bandInsets("rect", 100)).toEqual({ left: 0, right: 0, bottom: 0 });
  expect(bandInsets("arch", 100)).toEqual({ left: 0, right: 0, bottom: 0 });
  expect(bandInsets("round", 100)).toEqual({ left: 16, right: 16, bottom: 14, borderRadius: 6 });
  const base = calendar();
  const doors = (base.doors || []).map((door) => (door.day === 1 ? { ...door, content: { kind: "image", title: "Winter im Dorf", media_url: "/api/static/uploads/winter.png" } } : door));
  await setup({ extra: { doors } });
  const band = styleOf("advent-niche-band");
  const shape = doorVariant(7919 + 13).shape;
  expect(band.position).toBe("absolute");
  if (shape === "round") expect(band.left).toBeGreaterThan(0);
  else expect(band.left).toBe(0);
});

test("fehlt dem Server ein Türchen, bleibt der Platz leer statt zu brechen", async () => {
  const base = calendar();
  await setup({ extra: { doors: (base.doors || []).filter((door) => door.day !== 9) } });
  expect(screen.getAllByTestId(/^advent-door-\d+$/)).toHaveLength(23);
  expect(screen.queryByTestId("advent-door-9")).toBeNull();
  expect(screen.getByTestId("advent-door-8")).toBeTruthy();
});

test("öffnet sich ein Türchen, schwingt der Flügel - bei „Bewegung reduzieren“ steht er sofort offen", async () => {
  const timing = jest.spyOn(Animated, "timing");
  const handlers = { onOpen: jest.fn(), onShow: jest.fn(), onLocked: jest.fn() };
  const first = await render(<AdventBoard calendar={calendar({ today: 1, opened: [] })} {...handlers} />);
  await fireEvent(screen.getByTestId("advent-board"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 0 } } });
  timing.mockClear();
  await first.rerender(<AdventBoard calendar={calendar({ today: 1, opened: [1] })} {...handlers} />);
  const swings = timing.mock.calls.filter(([, config]) => (config as { duration?: number }).duration === doorVariant(7919 + 13).swing);
  expect(swings).toHaveLength(1);
  expect(screen.getByLabelText("Türchen 1 – geöffnet: Inhalt 1")).toBeTruthy();
  await first.unmount();

  const second = await render(<AdventBoard calendar={calendar({ today: 2, opened: [] })} still {...handlers} />);
  await fireEvent(screen.getByTestId("advent-board"), "layout", { nativeEvent: { layout: { x: 0, y: 0, width: 360, height: 0 } } });
  timing.mockClear();
  await second.rerender(<AdventBoard calendar={calendar({ today: 2, opened: [1] })} still {...handlers} />);
  // Nichts schwingt, nichts pulsiert, und auch das verschlossene Türchen rüttelt nicht.
  await fireEvent.press(screen.getByTestId("advent-door-button-20"));
  expect(timing).not.toHaveBeenCalled();
  expect(handlers.onLocked).toHaveBeenCalledTimes(1);
});
