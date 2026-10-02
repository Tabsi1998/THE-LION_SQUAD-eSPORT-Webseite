import React from "react";
import { StyleSheet } from "react-native";
import { act, render, screen } from "@testing-library/react-native";
import { initialFlakes, poolLayout, stepFlakes } from "./SnowField";
import { dropAngle, initialDrops, rainLayout, stepDrops } from "./RainField";
import { reportScroll, seasonScroll, seasonScrollProps } from "./scroll";

// Die Felder (#642, #771): feste Plätze je Tiefe; wie viele schneien oder regnen, sagt die Zahl - weniger lässt die
// übrigen zu Ende fallen, mehr lässt sie oben neu hereinfallen. Die Rechnung je Bild läuft ohne Reanimated testbar.

const SIZE = { width: 390, height: 844 };
const BASE = { factor: 0.6, sign: 1 };

test("Plätze: hinten zuerst, je Tiefe so viele, wie es höchstens geben kann", () => {
  const slots = poolLayout({ back: 2, mid: 1, front: 1 });
  expect(slots).toEqual([{ depth: "back", rank: 0 }, { depth: "back", rank: 1 }, { depth: "mid", rank: 0 }, { depth: "front", rank: 0 }]);
  expect(rainLayout({ back: 0, mid: 2, front: 0 }).map((slot) => slot.depth)).toEqual(["mid", "mid"]);
});

test("Start: im ganzen Bild verteilt, aus dem Seed - Plätze über der Zahl warten unsichtbar", () => {
  const slots = poolLayout({ back: 3, mid: 2, front: 1 });
  const flakes = initialFlakes(slots, { back: 2, mid: 2, front: 0 }, SIZE, "seed");
  expect(flakes.filter((flake) => !flake.done)).toHaveLength(4);
  expect(flakes[2].done).toBe(true);
  expect(flakes[5].done).toBe(true);
  expect(initialFlakes(slots, { back: 2, mid: 2, front: 0 }, SIZE, "seed")).toEqual(flakes);
  expect(flakes.every((flake) => flake.y >= 0 && flake.y <= SIZE.height)).toBe(true);
});

test("weniger Schnee: die Überzähligen fallen zu Ende; mehr Schnee: sie kommen oben neu herein", () => {
  const slots = poolLayout({ back: 2, mid: 0, front: 0 });
  const flakes = initialFlakes(slots, { back: 2, mid: 0, front: 0 }, SIZE, "x");
  stepFlakes(flakes, slots, { back: 1, mid: 0, front: 0 }, 0.016, 1, BASE, null, SIZE, 0, () => 0.5);
  expect(flakes[0].leaving).toBe(false);
  expect(flakes[1].leaving).toBe(true);
  flakes[1].y = SIZE.height + 50;
  stepFlakes(flakes, slots, { back: 1, mid: 0, front: 0 }, 0.016, 1, BASE, null, SIZE, 0, () => 0.5);
  expect(flakes[1].done).toBe(true);
  const y = flakes[1].y;
  stepFlakes(flakes, slots, { back: 1, mid: 0, front: 0 }, 0.016, 1, BASE, null, SIZE, 0, () => 0.5);
  expect(flakes[1].y).toBe(y);
  stepFlakes(flakes, slots, { back: 2, mid: 0, front: 0 }, 0.016, 1, BASE, null, SIZE, 0, () => 0.5);
  expect(flakes[1].done).toBe(false);
  expect(flakes[1].y).toBeLessThan(0);
});

test("Scrollen schiebt die Flocken: vorne ganz, hinten weniger - ohne Scrollen nur Fallen und Wind", () => {
  const slots = poolLayout({ back: 1, mid: 0, front: 1 });
  const a = initialFlakes(slots, { back: 1, mid: 0, front: 1 }, SIZE, "s");
  const b = initialFlakes(slots, { back: 1, mid: 0, front: 1 }, SIZE, "s");
  a.forEach((flake) => (flake.y = 400));
  b.forEach((flake) => (flake.y = 400));
  stepFlakes(a, slots, { back: 1, mid: 0, front: 1 }, 0, 1, BASE, null, SIZE, 0, () => 0.5);
  stepFlakes(b, slots, { back: 1, mid: 0, front: 1 }, 0, 1, BASE, null, SIZE, 100, () => 0.5);
  expect(a[1].y - b[1].y).toBeCloseTo(100);
  expect(a[0].y - b[0].y).toBeCloseTo(55);
});

test("Regen: gleiche Regeln für die Tropfen, und der Strich steht schräg gegen den Wind", () => {
  const slots = rainLayout({ back: 1, mid: 1, front: 1 });
  const drops = initialDrops(slots, { back: 1, mid: 1, front: 0 }, SIZE, "r");
  expect(drops[2].done).toBe(true);
  const windX = stepDrops(drops, slots, { back: 1, mid: 1, front: 0 }, 0.016, 1, BASE, null, SIZE, 0, () => 0.5);
  expect(windX).toBeGreaterThan(0);
  expect(dropAngle(drops[0], windX)).toBeLessThan(0);
  expect(dropAngle(drops[0], -windX)).toBeGreaterThan(0);
  expect(dropAngle(drops[0], 0)).toBeCloseTo(0);
});

test("die Scroll-Quelle: ein Screen meldet seine Position, die Felder lesen sie mit dem Namen des Screens", () => {
  reportScroll("Dashboard", 240);
  expect(seasonScroll()?.value).toEqual({ screen: "Dashboard", y: 240 });
  reportScroll("Profile", Number.NaN);
  expect(seasonScroll()?.value).toEqual({ screen: "Profile", y: 0 });
  // Je Screen immer dieselben Eigenschaften - die ScrollView rendert deshalb nicht neu.
  const props = seasonScrollProps("NewsList");
  expect(seasonScrollProps("NewsList")).toBe(props);
  expect(props.scrollEventThrottle).toBe(32);
  props.onScroll({ nativeEvent: { contentOffset: { x: 0, y: 512 } } } as never);
  expect(seasonScroll()?.value).toEqual({ screen: "NewsList", y: 512 });
});

test("das Schneefeld zeichnet je Platz eine Flocke; ein Bild bewegt die gebrauchten, die anderen bleiben unsichtbar", async () => {
  const { SnowField } = require("./SnowField");
  const { __frameCallbacks } = require("react-native-reanimated");
  await render(<SnowField capacity={{ back: 2, mid: 1, front: 1 }} counts={{ back: 1, mid: 1, front: 0 }} wind={BASE} size={SIZE} seed="feld" running scroll={null} />);
  expect(screen.getByTestId("snow-field")).toBeTruthy();
  expect(screen.getAllByTestId(/^snow-flake-\d+$/)).toHaveLength(4);
  // Platz 1 (hinten, zweiter) ist über der Zahl: unsichtbar; Platz 0 schneit.
  expect(StyleSheet.flatten(screen.getByTestId("snow-flake-1").props.style).opacity).toBe(0);
  expect(StyleSheet.flatten(screen.getByTestId("snow-flake-0").props.style).opacity).toBeGreaterThan(0);
  expect(__frameCallbacks.size).toBe(1);
  await act(async () => {
    __frameCallbacks.forEach(({ callback }: { callback: (info: { timeSincePreviousFrame: number }) => void }) => callback({ timeSincePreviousFrame: 16 }));
  });
  await screen.unmount();
  expect(__frameCallbacks.size).toBe(0);
});
