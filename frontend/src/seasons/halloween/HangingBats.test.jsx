import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { HangingBats, KIND_WEIGHTS, MIN_DISTANCE, chooseAnchors, flightPath, measureAnchors, pointOn } from "./HangingBats";
import { createMotionScheduler, resetMotionScheduler } from "../motion";

// Bewegungsbudget (H11): in diesen Tests darf alles sofort - der Planer selbst hat seine eigenen Tests.
beforeEach(() => resetMotionScheduler(createMotionScheduler({ unlimited: true })));
afterAll(() => resetMotionScheduler(null));

// Fledermäuse (#661, Halloween IV H7–H9): Plätze an echten Kanten (perches.js), Lebenszustände (batLife.js) - hier
// die Anzeige: Menü-Fledermäuse am Fenster, die anderen in der Seite, Klick scheucht, Rückkehr auf freie Plätze,
// Reaktionen auf Zeiger und Scrollen; Touch bleibt ruhig.

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

/** Kopfzeile mit Menü; ohne `header` ist sie zu flach für eigene Plätze - dann gibt es nur die Menüpunkte. */
function mountNav(ids = ["n1", "n2", "n3"], { header = false } = {}) {
  const links = ids.map((id) => `<a id="${id}">${id}</a>`).join("");
  mountFixture(`<header id="head" style="position: sticky"><nav>${links}</nav></header><main><div id="late"></div></main>`);
  rectOf(document.getElementById("head"), { left: 0, right: 1200, top: 0, bottom: header ? 64 : 24 });
  ids.forEach((id, index) => rectOf(document.getElementById(id), { left: 100 + index * 200, right: 160 + index * 200, top: 20, bottom: 44 }));
}

function states() {
  return screen.queryAllByTestId("halloween-bat-hanging").map((bat) => bat.getAttribute("data-state"));
}

afterEach(() => {
  fixture?.remove();
  fixture = null;
  Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  delete window.matchMedia;
  vi.useRealTimers();
});

test("Anker (H7): Menüpunkte am Fenster, Karten mit Ecken und Unterkante, der Löwe - keine Buchstaben mehr; die alte Signatur mit Zonenliste gilt weiter", () => {
  mountFixture('<header id="head" style="position: sticky"><nav><a id="n1">News</a><a id="n2">Events</a><a id="hidden">Menü</a></nav></header><main><h1 id="h1" style="font-size:72px">Ein Rudel.</h1><a id="c1" data-season-anchor="card">Karte eins</a><div id="lion" data-season-anchor="lion"></div></main>');
  rectOf(document.getElementById("head"), { left: 0, right: 1200, top: 0, bottom: 64 });
  rectOf(document.getElementById("n1"), { left: 100, right: 160, top: 20, bottom: 44 });
  rectOf(document.getElementById("n2"), { left: 200, right: 280, top: 20, bottom: 44 });
  rectOf(document.getElementById("hidden"), { left: 0, right: 0, top: 0, bottom: 0 });
  rectOf(document.getElementById("h1"), { left: 40, right: 640, top: 200, bottom: 270 });
  rectOf(document.getElementById("c1"), { left: 40, right: 400, top: 700, bottom: 900 });
  rectOf(document.getElementById("lion"), { left: 600, right: 900, top: 150, bottom: 450 });
  Object.defineProperty(window, "scrollY", { value: 500, configurable: true });
  const found = measureAnchors();
  const nav = found.filter((anchor) => anchor.kind === "nav");
  expect(nav.length).toBe(2);
  expect(nav[0]).toMatchObject({ fixed: true, x: 130, y: 46, px: 130, py: 546 });
  expect(found.some((anchor) => anchor.kind === "glyph" || anchor.element.id === "h1")).toBe(false);
  const corners = found.filter((anchor) => anchor.kind === "card" && anchor.pose === "sit");
  expect(corners.length).toBe(2);
  expect(corners[0]).toMatchObject({ fixed: false, y: 700 + 500, size: 22 });
  const under = found.find((anchor) => anchor.kind === "card" && anchor.pose === "hang");
  expect(under).toMatchObject({ x: 220, y: 899 + 500, size: 24 });
  const lion = found.find((anchor) => anchor.kind === "lion");
  expect(lion).toMatchObject({ x: 600 + 300 * 0.68, y: 150 + 300 * 0.16 + 500, pose: "hang" });
  expect(under.measure()).toEqual({ x: under.x, y: under.y });
  document.getElementById("c1").remove();
  expect(under.measure()).toBeNull();
  expect(measureAnchors(document, window, []).filter((anchor) => anchor.kind === "nav").length).toBe(2);
});

test("Auswahl: erst die Art nach Gewicht, dann der Punkt; nie zwei näher als der Mindestabstand, auch nicht zu schon Besetzten; seeded", () => {
  const candidates = [
    { kind: "nav", px: 0, py: 0 },
    { kind: "nav", px: MIN_DISTANCE - 20, py: 0 },
    { kind: "image", px: 500, py: 0 },
    { kind: "card", px: 1000, py: 0 },
  ];
  const chosen = chooseAnchors(candidates, 3, rngOf([0.1, 0.5, 0.9, 0.2, 0.5, 0.8]));
  expect(chosen.length).toBe(3);
  expect(new Set(chosen.map((anchor) => anchor.kind)).size).toBe(3);
  expect(chosen.some((anchor) => anchor.px === 0) && chosen.some((anchor) => anchor.px === MIN_DISTANCE - 20)).toBe(false);
  expect(chooseAnchors(candidates, 3, rngOf([0.1, 0.5, 0.9, 0.2, 0.5, 0.8]))).toEqual(chosen);
  const later = chooseAnchors(candidates, 3, rngOf([0.05, 0.5]), [{ px: 0, py: 0 }]);
  expect(later.every((anchor) => anchor.kind !== "nav")).toBe(true);
  expect(later.length).toBe(2);
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

test("Fledermäuse ruhen auf ihren Plätzen (Menü am Fenster, Karte in der Seite); ein Klick: Start, Flug aus dem Bild, weg - und später Anflug auf einen freien Platz (H8)", async () => {
  vi.useFakeTimers();
  mountNav(["n1", "n2", "n3"], { header: true });
  const card = document.createElement("a");
  card.setAttribute("data-season-anchor", "card");
  card.textContent = "Karte";
  rectOf(card, { left: 40, right: 400, top: 700, bottom: 900 });
  document.getElementById("late").appendChild(card);
  render(<MemoryRouter initialEntries={["/news"]}><HangingBats count={3} seed={0.3} salt="x" timeScale={20} /></MemoryRouter>);
  expect(screen.queryAllByTestId("halloween-bat-hanging").length).toBe(0);
  await act(async () => {
    vi.advanceTimersByTime(450);
  });
  const hanging = screen.getAllByTestId("halloween-bat-hanging");
  expect(hanging.length).toBe(3);
  expect(states()).toEqual(["perched", "perched", "perched"]);
  expect(hanging.every((bat) => !/sway|twitch/.test(bat.className))).toBe(true);
  const kinds = hanging.map((bat) => bat.getAttribute("data-kind"));
  expect(kinds.every((kind) => ["nav", "header", "card"].includes(kind))).toBe(true);
  const fixed = screen.getByTestId("halloween-hanging-bats-fixed");
  expect(fixed.className).toContain("tls-hbats--fixed");
  expect(fixed.querySelectorAll("[data-kind='nav'], [data-kind='header']").length).toBe(kinds.filter((kind) => kind !== "card").length);
  hanging.forEach((bat) => {
    const kind = bat.getAttribute("data-kind");
    if (kind === "nav" || kind === "header") expect(bat.getAttribute("data-pose")).toBe("hang");
    if (bat.getAttribute("data-pose") === "sit") expect(bat.className).toContain("tls-hbat--sitting");
    expect(["sleepy", "skittish", "roamer", "curious"]).toContain(bat.getAttribute("data-temperament"));
  });
  // Klick: erst der Start am Platz (eigene Phase), dann der Flug als eigene Figur, dann weg.
  fireEvent.click(hanging[0]);
  expect(states()).toContain("takeoff");
  expect(screen.queryByTestId("halloween-bat-flying")).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(48);
  });
  expect(screen.getAllByTestId("halloween-bat-hanging").length).toBe(2);
  const flying = screen.getByTestId("halloween-bat-flying");
  expect(flying.getAttribute("data-state")).toBe("flying");
  expect(flying.style.transform).toMatch(/rotate\(-?\d+(\.\d+)?deg\)/);
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
  expect(screen.queryByTestId("halloween-bat-flying")).toBeNull();
  expect(screen.getAllByTestId("halloween-bat-hanging").length).toBe(2);
  // Nach der Pause kommt sie von außerhalb zurück: Anflug, Landung, Setzen, Ruhe - auf einem freien Platz.
  await act(async () => {
    vi.advanceTimersByTime(6000);
  });
  expect(screen.queryByTestId("halloween-bat-flying")).toBeNull();
  expect(screen.getAllByTestId("halloween-bat-hanging").length).toBe(3);
  expect(states()).toEqual(["perched", "perched", "perched"]);
  const keys = screen.getAllByTestId("halloween-bat-hanging").map((bat) => `${bat.getAttribute("data-kind")}:${bat.style.transform}`);
  expect(new Set(keys).size).toBe(3);
});

test("Nachbesetzen: erst nur das Menü, die Karte kommt später dazu - und ein verschwundener Platz lässt seine Fledermaus gehen", async () => {
  vi.useFakeTimers();
  mountNav(["n1"]);
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

test("ohne Anzahl oder ohne Plätze nichts", async () => {
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

test("Ruhezonen (H10): kein Platz in Formularen, Dialogen oder markierten Bereichen", () => {
  mountFixture('<header><nav><a id="n1">News</a><a id="n2">Events</a></nav></header><main><div id="quiet" data-season-quiet></div><form id="f"><a id="c1" data-season-anchor="card">Karte im Formular</a></form><a id="c2" data-season-anchor="card">Freie Karte</a></main>');
  rectOf(document.getElementById("n1"), { left: 100, right: 160, top: 20, bottom: 44 });
  rectOf(document.getElementById("n2"), { left: 300, right: 380, top: 20, bottom: 44 });
  rectOf(document.getElementById("quiet"), { left: 80, right: 180, top: 0, bottom: 60 });
  rectOf(document.getElementById("f"), { left: 0, right: 500, top: 600, bottom: 900 });
  rectOf(document.getElementById("c1"), { left: 40, right: 400, top: 650, bottom: 850 });
  rectOf(document.getElementById("c2"), { left: 40, right: 400, top: 1000, bottom: 1200 });
  const found = measureAnchors();
  expect(found.filter((anchor) => anchor.kind === "nav").map((anchor) => anchor.element.id)).toEqual(["n2"]);
  expect([...new Set(found.filter((anchor) => anchor.kind === "card").map((anchor) => anchor.element.id))]).toEqual(["c2"]);
  expect(measureAnchors(document, window, []).filter((anchor) => anchor.kind === "nav").length).toBe(2);
});

test("Ausweichen (H10): öffnet sich ein Dialog über einer Fledermaus, wird sie unsichtbar - und kommt zurück", async () => {
  vi.useFakeTimers();
  mountNav(["n1"]);
  render(<MemoryRouter initialEntries={["/"]}><HangingBats count={1} seed={0.3} salt="x" /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(450);
  });
  const bat = screen.getByTestId("halloween-bat-hanging");
  expect(bat.getAttribute("data-yield")).toBeNull();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  rectOf(dialog, { left: 60, right: 300, top: 0, bottom: 200 });
  document.body.appendChild(dialog);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(screen.getByTestId("halloween-bat-hanging").getAttribute("data-yield")).toBe("1");
  expect(screen.getByTestId("halloween-bat-hanging").className).toContain("tls-hbat--yield");
  dialog.remove();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(300);
  });
  expect(screen.getByTestId("halloween-bat-hanging").getAttribute("data-yield")).toBeNull();
});

test("Nähe (H9): der Zeiger in der Nähe macht aufmerksam, ganz nah fliegt sie - nicht bei jedem Mousemove, nicht auf Touch", async () => {
  vi.useFakeTimers();
  mountNav(["n1"]);
  render(<MemoryRouter initialEntries={["/"]}><HangingBats count={1} seed={0.3} salt="x" temperament="curious" reactionRng={() => 0} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(450);
  });
  expect(states()).toEqual(["perched"]);
  // 120 px entfernt (Alarmradius 200, Fluchtradius 55): aufmerksam, dann wieder Ruhe.
  fireEvent.mouseMove(window, { clientX: 250, clientY: 57 });
  await act(async () => {
    vi.advanceTimersByTime(200);
  });
  expect(states()).toEqual(["alert"]);
  expect(screen.getByTestId("halloween-bat-hanging").className).toContain("tls-hbat--alert");
  await act(async () => {
    vi.advanceTimersByTime(2500);
  });
  expect(states()).toEqual(["perched"]);
  // Direkt daneben: Start und Flug.
  fireEvent.mouseMove(window, { clientX: 134, clientY: 60 });
  await act(async () => {
    vi.advanceTimersByTime(200);
  });
  expect(states()).toEqual(["takeoff"]);
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
  expect(screen.queryAllByTestId("halloween-bat-hanging").length).toBe(0);
  expect(screen.getByTestId("halloween-bat-flying")).toBeInTheDocument();
});

test("Touch (H9): ohne feinen Zeiger keine Nähe-Reaktion", async () => {
  vi.useFakeTimers();
  window.matchMedia = (query) => ({ matches: query.includes("coarse"), media: query, addEventListener() {}, removeEventListener() {} });
  mountNav(["n1"]);
  render(<MemoryRouter initialEntries={["/"]}><HangingBats count={1} seed={0.3} salt="x" temperament="curious" reactionRng={() => 0} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(450);
  });
  fireEvent.mouseMove(window, { clientX: 134, clientY: 60 });
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
  expect(states()).toEqual(["perched"]);
});

test("Scrollen (H9): erst ein schneller Ruck über mindestens 100 ms schreckt eine sichtbare Fledermaus auf; ein einzelner Radschritt nicht", async () => {
  vi.useFakeTimers();
  mountNav(["n1"]);
  render(<MemoryRouter initialEntries={["/"]}><HangingBats count={1} seed={0.3} salt="x" reactionRng={() => 0} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(450);
  });
  const scrollTo = async (y, wait) => {
    Object.defineProperty(window, "scrollY", { value: y, configurable: true });
    fireEvent.scroll(window);
    await act(async () => {
      vi.advanceTimersByTime(wait);
    });
  };
  // Ein Radschritt: 100 px in 16 ms - zu kurz, um als schnelles Scrollen zu gelten.
  await scrollTo(0, 16);
  await scrollTo(100, 100);
  expect(states()).toEqual(["perched"]);
  // Ein Ruck: 3000 px innerhalb von 150 ms.
  await scrollTo(100, 50);
  await scrollTo(1500, 100);
  await scrollTo(3100, 50);
  expect(states()).toEqual(["takeoff"]);
});
