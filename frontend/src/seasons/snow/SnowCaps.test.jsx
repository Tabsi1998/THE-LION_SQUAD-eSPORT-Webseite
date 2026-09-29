import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { SnowCaps, capYields } from "./SnowCaps";
import { INSET } from "./caps";

// Schneehauben (S7, W3): auf Karten im Fenster, nicht im Formular (Ruhezone), je Stück der Kante ein eigenes SVG mit
// Stufe; unter einem geöffneten Dialog weicht die Haube aus; Aufräumen beim Verlassen.

function box(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
}

let fixture = null;

function mountFixture(html) {
  fixture?.remove();
  fixture = document.createElement("div");
  fixture.innerHTML = html;
  document.body.appendChild(fixture);
  return fixture;
}

afterEach(() => {
  vi.useRealTimers();
  fixture?.remove();
  fixture = null;
});

test("Hauben auf Karten im Fenster, nicht im Formular; Stufe; unter einem Dialog weicht die erste aus; beim Verlassen weg", async () => {
  vi.useFakeTimers();
  mountFixture(`<main><a id="c1" data-season-anchor="card">Eins</a><a id="c2" data-season-anchor="card">Zwei</a><form id="f"><a id="c3" data-season-anchor="card">Drei</a></form></main>`);
  box(document.getElementById("c1"), { left: 40, right: 400, top: 100, bottom: 300 });
  box(document.getElementById("c2"), { left: 500, right: 900, top: 100, bottom: 300 });
  box(document.getElementById("f"), { left: 0, right: 1000, top: 350, bottom: 500 });
  box(document.getElementById("c3"), { left: 40, right: 400, top: 360, bottom: 480 });
  const { unmount } = render(<MemoryRouter initialEntries={["/"]}><SnowCaps stage={2} tempC={-3} salt="2026" max={10} /></MemoryRouter>);
  expect(screen.queryAllByTestId("snow-cap")).toHaveLength(0);
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  const caps = screen.getAllByTestId("snow-cap");
  expect(caps).toHaveLength(2);
  expect(screen.getByTestId("snow-caps").getAttribute("data-level")).toBe("2");
  expect(caps[0].getAttribute("data-kind")).toBe("card");
  expect(caps[0].style.transform).toContain(`translate(${40 + INSET}`);
  expect(caps[0].querySelector("path").getAttribute("d")).toMatch(/^M 0/);
  expect(caps.every((cap) => !cap.getAttribute("data-yield"))).toBe(true);
  // Ein Dialog über der ersten Karte: sie weicht aus, die zweite bleibt.
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  fixture.appendChild(dialog);
  box(dialog, { left: 0, right: 450, top: 40, bottom: 400 });
  await act(async () => {
    vi.advanceTimersByTime(1200);
  });
  const after = screen.getAllByTestId("snow-cap");
  expect(after[0].getAttribute("data-yield")).toBe("1");
  expect(after[1].getAttribute("data-yield")).toBeNull();
  unmount();
  expect(screen.queryAllByTestId("snow-cap")).toHaveLength(0);
});

test("Tauwetter senkt die Stufe; ohne Obergrenze nichts", async () => {
  vi.useFakeTimers();
  mountFixture(`<main><a id="c1" data-season-anchor="card">Eins</a></main>`);
  box(document.getElementById("c1"), { left: 40, right: 400, top: 100, bottom: 300 });
  render(<MemoryRouter initialEntries={["/"]}><SnowCaps stage={3} tempC={5} salt="2026" max={10} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  expect(screen.getByTestId("snow-caps").getAttribute("data-level")).toBe("2");
  render(<MemoryRouter initialEntries={["/"]}><SnowCaps stage={3} salt="2026" max={0} /></MemoryRouter>);
  await act(async () => {
    vi.advanceTimersByTime(500);
  });
  expect(screen.getAllByTestId("snow-caps")).toHaveLength(1);
  const zones = [{ left: 0, top: 0, right: 500, bottom: 500, viewLeft: 0, viewTop: 0, viewRight: 500, viewBottom: 500, overlay: true }];
  expect(capYields({ x: 40, y: 100, width: 360 }, zones)).toBe(true);
  expect(capYields({ x: 40, y: 100, width: 360 }, [{ ...zones[0], overlay: false }])).toBe(false);
  expect(capYields({ x: 600, y: 100, width: 360 }, zones)).toBe(false);
});
