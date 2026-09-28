import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HangingBats, KIND_WEIGHTS, MIN_DISTANCE, chooseAnchors, flightPath, measureAnchors, pointOn } from "./HangingBats";

// Hängende Fledermäuse (#661, Runde V): Anker sind Menüpunkte (am Fenster), Buchstaben der letzten Zeile einer
// Überschrift, Karten und der Löwe (in der Seite); sie hängen still, ein Klick lässt sie aus dem Bild fliegen.

function rngOf(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

function rectOf(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
}

/** jsdom kennt keine Zeichenrechtecke: ein Range liefert hier je Textknoten feste Kästen pro Zeichen. */
function fakeGlyphs(table) {
  const original = document.createRange;
  document.createRange = () => {
    let node = null;
    let index = 0;
    return {
      setStart(start, offset) {
        node = start;
        index = offset;
      },
      setEnd() {},
      getBoundingClientRect() {
        const spec = table.get(node);
        if (!spec) return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 };
        const left = spec.left + index * spec.advance;
        return { left, right: left + spec.advance, top: spec.top, bottom: spec.bottom, width: spec.advance, height: spec.bottom - spec.top };
      },
    };
  };
  return () => {
    document.createRange = original;
  };
}

/** jsdom hat keinen Canvas: die Schriftmaße kommen aus der Schriftgröße (Oberlänge 0,7, Schriftkasten 0,85). */
function fakeCanvas() {
  const original = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return {
      font: "",
      measureText() {
        const size = parseFloat((this.font.match(/(\d+(?:\.\d+)?)px/) || [0, "16"])[1]);
        return { actualBoundingBoxAscent: size * 0.7, actualBoundingBoxDescent: 0, fontBoundingBoxAscent: size * 0.85 };
      },
    };
  };
  return () => {
    HTMLCanvasElement.prototype.getContext = original;
  };
}

let fixture = null;
let restoreRange = null;
let restoreCanvas = null;

function mountFixture(html) {
  fixture = document.createElement("div");
  fixture.innerHTML = html;
  document.body.appendChild(fixture);
  return fixture;
}

afterEach(() => {
  fixture?.remove();
  fixture = null;
  restoreRange?.();
  restoreRange = null;
  restoreCanvas?.();
  restoreCanvas = null;
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
});

test("Anker: Menüpunkte am Fenster, Buchstaben an ihrer Oberkante in der Seite, Karten an der Oberkante, der Löwe; Kleines und Verstecktes zählt nicht", () => {
  restoreCanvas = fakeCanvas();
  mountFixture('<header><nav><a id="n1">News</a><a id="n2">Events</a><a id="hidden">Menü</a></nav></header><main><h1 id="h1" style="font-size:72px">Ein Rudel.<br><span id="s1">Eine Familie.</span></h1><h2 id="h2" style="font-size:10px">Klein</h2><a id="c1" data-season-anchor="card">Karte eins</a><div id="lion" data-season-anchor="lion"></div></main>');
  rectOf(document.getElementById("n1"), { left: 100, right: 160, top: 20, bottom: 44 });
  rectOf(document.getElementById("n2"), { left: 200, right: 280, top: 20, bottom: 44 });
  rectOf(document.getElementById("hidden"), { left: 0, right: 0, top: 0, bottom: 0 });
  rectOf(document.getElementById("c1"), { left: 40, right: 400, top: 700, bottom: 900 });
  rectOf(document.getElementById("lion"), { left: 600, right: 900, top: 150, bottom: 450 });
  const h1 = document.getElementById("h1");
  const table = new Map();
  table.set(h1.firstChild, { left: 40, advance: 30, top: 200, bottom: 270 });
  table.set(document.getElementById("s1").firstChild, { left: 40, advance: 30, top: 280, bottom: 350 });
  table.set(document.getElementById("h2").firstChild, { left: 40, advance: 6, top: 400, bottom: 410 });
  restoreRange = fakeGlyphs(table);
  Object.defineProperty(window, "scrollY", { value: 500, configurable: true });
  const found = measureAnchors();
  const nav = found.filter((anchor) => anchor.kind === "nav");
  expect(nav.length).toBe(2);
  expect(nav[0]).toMatchObject({ fixed: true, x: 130, y: 46, px: 130, py: 546 });
  const glyphs = found.filter((anchor) => anchor.kind === "glyph");
  // Beide Zeilen: „Ein Rudel.“ (8 Buchstaben) und „Eine Familie.“ (11) - Punkt und Leerzeichen zählen nicht.
  // Hängepunkt: Oberkante des Zeichens = Kastenoberkante + Schriftkasten (0,85 em) - Oberlänge (0,7 em), plus 1 px, plus Scrollstand.
  expect(glyphs.length).toBe(19);
  expect(glyphs.every((anchor) => anchor.fixed === false)).toBe(true);
  expect(glyphs[0].y).toBeCloseTo(200 + 72 * 0.85 - 72 * 0.7 + 1 + 500, 5);
  expect(glyphs[8].y).toBeCloseTo(280 + 72 * 0.85 - 72 * 0.7 + 1 + 500, 5);
  expect(glyphs[0].x).toBe(40 + 15);
  expect(glyphs[0].size).toBe(25);
  // Die kleine Überschrift (Zeichen 7 px hoch) bekommt keine Fledermaus.
  expect(found.filter((anchor) => anchor.element.id === "h2").length).toBe(0);
  const card = found.find((anchor) => anchor.kind === "card");
  expect(card).toMatchObject({ fixed: false, y: 701 + 500, size: 24 });
  expect(card.x).toBeGreaterThan(40 + 360 * 0.2 - 1);
  expect(card.x).toBeLessThan(40 + 360 * 0.8 + 1);
  const lion = found.find((anchor) => anchor.kind === "lion");
  expect(lion).toMatchObject({ x: 600 + 300 * 0.68, y: 150 + 300 * 0.16 + 500 });
  // Nachmessen liefert dieselbe Stelle - und null, sobald der Anker aus der Seite ist.
  expect(card.measure()).toEqual({ x: card.x, y: card.y });
  expect(glyphs[3].measure()).toEqual({ x: glyphs[3].x, y: glyphs[3].y });
  document.getElementById("c1").remove();
  expect(card.measure()).toBeNull();
});

test("Auswahl: erst die Art nach Gewicht, dann der Punkt; nie zwei näher als der Mindestabstand, auch nicht zu schon Besetzten; seeded", () => {
  const candidates = [
    { kind: "nav", px: 0, py: 0 },
    { kind: "nav", px: MIN_DISTANCE - 20, py: 0 },
    { kind: "glyph", px: 500, py: 0 },
    { kind: "card", px: 1000, py: 0 },
  ];
  const chosen = chooseAnchors(candidates, 3, rngOf([0.1, 0.5, 0.9, 0.2, 0.5, 0.8]));
  expect(chosen.length).toBe(3);
  expect(new Set(chosen.map((anchor) => anchor.kind)).size).toBe(3);
  expect(chosen.some((anchor) => anchor.px === 0) && chosen.some((anchor) => anchor.px === MIN_DISTANCE - 20)).toBe(false);
  expect(chooseAnchors(candidates, 3, rngOf([0.1, 0.5, 0.9, 0.2, 0.5, 0.8]))).toEqual(chosen);
  // Ein Menüpunkt ist schon besetzt: der Nachbar daneben kommt nicht mehr, der Rest schon.
  const later = chooseAnchors(candidates, 3, rngOf([0.05, 0.5]), [{ px: 0, py: 0 }]);
  expect(later.every((anchor) => anchor.kind !== "nav")).toBe(true);
  expect(later.length).toBe(2);
  // Das Gewicht entscheidet die Art: mit 0,0 die erste Art im Topf, mit 0,99 die letzte.
  expect(KIND_WEIGHTS.nav).toBeGreaterThan(KIND_WEIGHTS.lion);
  expect(chooseAnchors(candidates, 1, rngOf([0.0, 0.0]))[0].kind).toBe("nav");
  expect(chooseAnchors(candidates, 1, rngOf([0.99, 0.0]))[0].kind).toBe("card");
});

test("Flugbahn: beginnt am Hängepunkt, geht erst hoch, endet unter dem Fenster oder über dem Rand - im Rahmen der Seite", () => {
  const view = { top: 500, bottom: 1300, width: 1200 };
  const down = flightPath({ x: 300, y: 560 }, rngOf([0.7, 0.5, 0.2, 0.5, 0.5]), view);
  expect(pointOn(down, 0)).toEqual({ x: 300, y: 560 });
  expect(pointOn(down, 1)).toEqual(down.p3);
  expect(down.p1.y).toBeLessThan(560);
  expect(down.p3.y).toBeGreaterThan(1300);
  expect(down.facing).toBe(1);
  const up = flightPath({ x: 300, y: 560 }, rngOf([0.2, 0.5, 0.9, 0.5, 0.5]), view);
  expect(up.p3.y).toBeLessThan(500);
  expect(up.facing).toBe(-1);
});

test("Fledermäuse hängen still, Menü-Fledermäuse am Fenster, die anderen in der Seite; ein Klick lässt eine davonfliegen; Karten, die später kommen, werden nachbesetzt", async () => {
  vi.useFakeTimers();
  restoreCanvas = fakeCanvas();
  mountFixture('<header><nav><a id="n1">News</a><a id="n2">Events</a><a id="n3">Kontakt</a></nav></header><main><h1 id="h1" style="font-size:40px">Rudel</h1><div id="late"></div></main>');
  rectOf(document.getElementById("n1"), { left: 100, right: 160, top: 20, bottom: 44 });
  rectOf(document.getElementById("n2"), { left: 300, right: 380, top: 20, bottom: 44 });
  rectOf(document.getElementById("n3"), { left: 500, right: 580, top: 20, bottom: 44 });
  const table = new Map();
  table.set(document.getElementById("h1").firstChild, { left: 100, advance: 40, top: 300, bottom: 380 });
  restoreRange = fakeGlyphs(table);
  render(<MemoryRouter initialEntries={["/news"]}><HangingBats count={3} seed={0.3} salt="x" flightMs={60} /></MemoryRouter>);
  expect(screen.queryAllByTestId("halloween-bat-hanging").length).toBe(0);
  await act(async () => {
    vi.advanceTimersByTime(450);
  });
  const hanging = screen.getAllByTestId("halloween-bat-hanging");
  expect(hanging.length).toBe(3);
  expect(hanging.every((bat) => !/sway|twitch/.test(bat.className))).toBe(true);
  const kinds = hanging.map((bat) => bat.getAttribute("data-kind"));
  expect(kinds.filter((kind) => kind === "nav").length).toBeGreaterThanOrEqual(1);
  expect(kinds.filter((kind) => kind === "glyph").length).toBeGreaterThanOrEqual(1);
  const fixed = screen.getByTestId("halloween-hanging-bats-fixed");
  const page = screen.getByTestId("halloween-hanging-bats");
  expect(fixed.className).toContain("tls-hbats--fixed");
  expect(page.className).toContain("tls-hbats--page");
  expect(fixed.querySelectorAll("[data-kind='nav']").length).toBe(kinds.filter((kind) => kind === "nav").length);
  expect(page.querySelectorAll("[data-kind='glyph']").length).toBe(kinds.filter((kind) => kind === "glyph").length);
  const glyphBat = page.querySelector("[data-kind='glyph']");
  // Oberkante des Zeichens: 300 + 40 · 0,85 - 40 · 0,7 + 1 = 307
  expect(glyphBat.style.transform).toMatch(/, 307\.0px\)$/);
  vi.useRealTimers();
  fireEvent.click(hanging[0]);
  expect(screen.getAllByTestId("halloween-bat-hanging").length).toBe(2);
  expect(screen.getByTestId("halloween-bat-flying")).toBeInTheDocument();
  await act(() => new Promise((resolve) => setTimeout(resolve, 160)));
  expect(screen.queryByTestId("halloween-bat-flying")).toBeNull();
  expect(screen.getAllByTestId("halloween-bat-hanging").length).toBe(2);
});

test("jede Fledermaus für sich: die zweite anklicken, während die erste fliegt, lässt die erste nicht von vorn beginnen", async () => {
  vi.useFakeTimers();
  restoreCanvas = fakeCanvas();
  mountFixture('<header><nav><a id="n1">News</a><a id="n2">Events</a><a id="n3">Kontakt</a></nav></header>');
  rectOf(document.getElementById("n1"), { left: 100, right: 160, top: 20, bottom: 44 });
  rectOf(document.getElementById("n2"), { left: 300, right: 380, top: 20, bottom: 44 });
  rectOf(document.getElementById("n3"), { left: 500, right: 580, top: 20, bottom: 44 });
  render(<MemoryRouter initialEntries={["/news"]}><HangingBats count={3} seed={0.3} salt="x" flightMs={300} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(450);
  });
  vi.useRealTimers();
  const hanging = screen.getAllByTestId("halloween-bat-hanging");
  expect(hanging.length).toBe(3);
  fireEvent.click(hanging[0]);
  await act(() => new Promise((resolve) => setTimeout(resolve, 150)));
  fireEvent.click(hanging[1]);
  expect(screen.getAllByTestId("halloween-bat-flying").length).toBe(2);
  // Nach weiteren 220 ms (370 ms seit dem ersten Klick) ist die erste weg - hätte ihr Flug neu begonnen, flöge sie noch.
  await act(() => new Promise((resolve) => setTimeout(resolve, 220)));
  expect(screen.getAllByTestId("halloween-bat-flying").length).toBe(1);
  expect(screen.getAllByTestId("halloween-bat-hanging").length).toBe(1);
  await act(() => new Promise((resolve) => setTimeout(resolve, 200)));
  expect(screen.queryByTestId("halloween-bat-flying")).toBeNull();
  expect(screen.getAllByTestId("halloween-bat-hanging").length).toBe(1);
});

test("Nachbesetzen: erst nur das Menü, die Karte kommt später dazu - und ein verschwundener Anker nimmt seine Fledermaus mit", async () => {
  vi.useFakeTimers();
  mountFixture('<header><nav><a id="n1">News</a></nav></header><main><div id="late"></div></main>');
  rectOf(document.getElementById("n1"), { left: 100, right: 160, top: 20, bottom: 44 });
  render(<MemoryRouter initialEntries={["/"]}><HangingBats count={2} seed={0.3} salt="x" /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(450);
  });
  expect(screen.getAllByTestId("halloween-bat-hanging").length).toBe(1);
  const card = document.createElement("a");
  card.setAttribute("data-season-anchor", "card");
  card.textContent = "Karte";
  rectOf(card, { left: 40, right: 400, top: 700, bottom: 900 });
  document.getElementById("late").appendChild(card);
  await act(async () => {
    vi.advanceTimersByTime(1200);
  });
  expect(screen.getAllByTestId("halloween-bat-hanging").length).toBe(2);
  expect(screen.getByTestId("halloween-hanging-bats").querySelector("[data-kind='card']")).not.toBeNull();
  card.remove();
  await act(async () => {
    vi.advanceTimersByTime(2100);
  });
  expect(screen.getAllByTestId("halloween-bat-hanging").length).toBe(1);
  expect(screen.queryByTestId("halloween-hanging-bats")).toBeNull();
});

test("ohne Anzahl oder ohne Anker nichts", async () => {
  render(<MemoryRouter><HangingBats count={0} seed={0.3} salt="x" /></MemoryRouter>);
  expect(screen.queryByTestId("halloween-hanging-bats")).toBeNull();
  vi.useFakeTimers();
  render(<MemoryRouter><HangingBats count={2} seed={0.3} salt="x" /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(4000);
  });
  expect(screen.queryByTestId("halloween-hanging-bats")).toBeNull();
  expect(screen.queryByTestId("halloween-hanging-bats-fixed")).toBeNull();
});
