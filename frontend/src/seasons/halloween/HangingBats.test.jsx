import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HangingBats, MIN_DISTANCE, chooseAnchors, flightPath, measureAnchors, pointOn } from "./HangingBats";

// Hängende Fledermäuse (#661): Anker aus der Seite, seeded Auswahl ohne Gedränge, Klick lässt sie davonfliegen.

function rngOf(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

function rectOf(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
}

let fixture = null;

function mountFixture(html) {
  fixture = document.createElement("div");
  fixture.innerHTML = html;
  document.body.appendChild(fixture);
  return fixture;
}

afterEach(() => {
  fixture?.remove();
  fixture = null;
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  Object.defineProperty(window, "scrollX", { value: 0, configurable: true });
});

test("Anker: Menüpunkt unten mittig, Überschrift rechts oben, Löwe oben - in Seitenkoordinaten; zu Kleines zählt nicht", () => {
  mountFixture('<header><nav><a id="n1">News</a></nav></header><main><h1 id="h1">Titel</h1><h2 id="h2">x</h2><div id="lion" data-season-anchor="lion"></div></main>');
  rectOf(document.getElementById("n1"), { left: 100, right: 160, top: 20, bottom: 44 });
  rectOf(document.getElementById("h1"), { left: 40, right: 400, top: 200, bottom: 260 });
  rectOf(document.getElementById("h2"), { left: 0, right: 10, top: 0, bottom: 5 });
  rectOf(document.getElementById("lion"), { left: 600, right: 900, top: 150, bottom: 450 });
  Object.defineProperty(window, "scrollY", { value: 50, configurable: true });
  const found = measureAnchors();
  expect(found.map((anchor) => anchor.kind)).toEqual(["nav", "heading", "lion"]);
  expect(found[0]).toMatchObject({ x: 130, y: 96 });
  expect(found[1]).toMatchObject({ x: 406, y: 252 });
  expect(found[2]).toMatchObject({ x: 804, y: 248 });
});

test("Auswahl: seeded, nie zwei näher als der Mindestabstand", () => {
  const candidates = [{ x: 0, y: 0 }, { x: MIN_DISTANCE - 20, y: 0 }, { x: 500, y: 0 }, { x: 1000, y: 0 }];
  const chosen = chooseAnchors(candidates, 3, rngOf([0.1, 0.5, 0.9]));
  expect(chosen.length).toBe(3);
  expect(chosen.some((anchor) => anchor.x === 0) && chosen.some((anchor) => anchor.x === MIN_DISTANCE - 20)).toBe(false);
  expect(chooseAnchors(candidates, 3, rngOf([0.1, 0.5, 0.9]))).toEqual(chosen);
  expect(chooseAnchors(candidates, 1, rngOf([0.3])).length).toBe(1);
});

test("Flugbahn: beginnt am Hängepunkt, geht erst hoch, endet weit weg", () => {
  const path = flightPath({ x: 300, y: 400 }, rngOf([0.7, 0.5, 0.2, 0.5, 0.5]));
  expect(pointOn(path, 0)).toEqual({ x: 300, y: 400 });
  expect(pointOn(path, 1)).toEqual(path.p3);
  expect(Math.abs(path.p3.x - 300)).toBeGreaterThanOrEqual(500);
  expect(path.p1.y).toBeLessThan(400);
  expect(path.p3.y).toBeGreaterThan(400);
  expect(path.facing).toBe(1);
  const up = flightPath({ x: 300, y: 400 }, rngOf([0.2, 0.5, 0.9, 0.5, 0.5]));
  expect(up.p3.y).toBeLessThan(400);
  expect(up.facing).toBe(-1);
});

test("Hängende Fledermäuse erscheinen nach der Messung; ein Klick lässt eine davonfliegen, danach ist sie weg", async () => {
  vi.useFakeTimers();
  mountFixture('<main><h1 id="h1">Titel</h1><h2 id="h2">Zweite</h2><h2 id="h3">Dritte</h2></main>');
  rectOf(document.getElementById("h1"), { left: 40, right: 400, top: 200, bottom: 260 });
  rectOf(document.getElementById("h2"), { left: 40, right: 300, top: 700, bottom: 740 });
  rectOf(document.getElementById("h3"), { left: 40, right: 300, top: 1400, bottom: 1440 });
  render(<MemoryRouter initialEntries={["/news"]}><HangingBats count={2} seed={0.3} salt="x" flightMs={60} /></MemoryRouter>);
  expect(screen.queryAllByTestId("halloween-bat-hanging").length).toBe(0);
  await act(async () => {
    vi.advanceTimersByTime(450);
  });
  expect(screen.getAllByTestId("halloween-bat-hanging").length).toBe(2);
  vi.useRealTimers();
  fireEvent.click(screen.getAllByTestId("halloween-bat-hanging")[0]);
  expect(screen.getAllByTestId("halloween-bat-hanging").length).toBe(1);
  expect(screen.getByTestId("halloween-bat-flying")).toBeInTheDocument();
  await act(() => new Promise((resolve) => setTimeout(resolve, 160)));
  expect(screen.queryByTestId("halloween-bat-flying")).toBeNull();
  expect(screen.getAllByTestId("halloween-bat-hanging").length).toBe(1);
});

test("ohne Anzahl nichts", () => {
  render(<MemoryRouter><HangingBats count={0} seed={0.3} salt="x" /></MemoryRouter>);
  expect(screen.queryByTestId("halloween-hanging-bats")).toBeNull();
});
