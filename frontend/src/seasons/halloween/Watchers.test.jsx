import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Eyes, RareEdge, lookOffset } from "./Watchers";
import { createMotionScheduler, resetMotionScheduler } from "../motion";

// Beobachter (H15): Augen kommen nach der Pause an eine freie dunkle Stelle, blinzeln, schauen zum Zeiger, gehen
// wieder; ohne Budget oder ohne freie Stelle später noch einmal; der Randschatten nur bei freier Randspalte.

beforeEach(() => resetMotionScheduler(createMotionScheduler({ unlimited: true })));
afterAll(() => resetMotionScheduler(null));

let fixture = null;

function box(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
}

afterEach(() => {
  fixture?.remove();
  fixture = null;
  vi.useRealTimers();
});

const wrap = (node) => <MemoryRouter initialEntries={["/"]}>{node}</MemoryRouter>;

test("Augen: nach der Pause an einer freien Stelle, ein- bis zweimal blinzeln, Pupillen zum Zeiger, nach der Zeit wieder weg - und die nächste Pause ist lang", async () => {
  vi.useFakeTimers();
  fixture = document.createElement("div");
  fixture.innerHTML = '<main id="m"></main><form id="f"></form>';
  document.body.appendChild(fixture);
  box(document.getElementById("f"), { left: 0, right: 1024, top: 0, bottom: 300 });
  const probe = () => document.getElementById("m");
  render(wrap(<Eyes active seed={0.3} salt="x" firstDelayMs={[1000, 1000]} pauseMs={[5000, 5000]} showMs={2000} probe={probe} />));
  expect(screen.queryByTestId("halloween-eyes")).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(1100);
  });
  const eyes = screen.getByTestId("halloween-eyes");
  expect(["1", "2"]).toContain(eyes.getAttribute("data-blinks"));
  expect(parseFloat(eyes.style.top)).toBeGreaterThan(300);
  expect(eyes.querySelectorAll(".tls-eyes__eye").length).toBe(2);
  eyes.getBoundingClientRect = () => ({ left: 300, top: 500, width: 0, height: 0, right: 300, bottom: 500 });
  fireEvent.mouseMove(window, { clientX: 520, clientY: 500 });
  await act(async () => {
    vi.advanceTimersByTime(40);
  });
  expect(parseFloat(eyes.style.getPropertyValue("--eye-x"))).toBeGreaterThan(1.5);
  await act(async () => {
    vi.advanceTimersByTime(2100);
  });
  expect(screen.queryByTestId("halloween-eyes")).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(3000);
  });
  expect(screen.queryByTestId("halloween-eyes")).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(2200);
  });
  expect(screen.getByTestId("halloween-eyes")).toBeInTheDocument();
});

test("Augen: ohne freie Stelle oder ohne Budget kommen sie nicht - und probieren es später wieder; inaktiv nie", async () => {
  vi.useFakeTimers();
  fixture = document.createElement("div");
  fixture.innerHTML = '<main id="m"><p id="t">Text</p></main>';
  document.body.appendChild(fixture);
  const busy = () => document.getElementById("t");
  const view = render(wrap(<Eyes active seed={0.3} salt="x" firstDelayMs={[500, 500]} showMs={1000} probe={busy} />));
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
  expect(screen.queryByTestId("halloween-eyes")).toBeNull();
  view.unmount();
  // Planer mit Budget: `eyes` hat 120 s Abklingzeit - der zweite Versuch kurz danach wird abgelehnt und wartet 30 s.
  const clock = { now: 100000 };
  resetMotionScheduler(createMotionScheduler({ now: () => clock.now, initialDelayMs: 0 }));
  const free = () => document.getElementById("m");
  const first = render(wrap(<Eyes active seed={0.3} salt="x" firstDelayMs={[500, 500]} showMs={1000} probe={free} />));
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
  expect(screen.getByTestId("halloween-eyes")).toBeInTheDocument();
  first.unmount();
  clock.now += 5000;
  render(wrap(<Eyes active seed={0.5} salt="y" firstDelayMs={[500, 500]} showMs={1000} probe={free} />));
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
  expect(screen.queryByTestId("halloween-eyes")).toBeNull();
  clock.now += 130000;
  await act(async () => {
    vi.advanceTimersByTime(30100);
  });
  expect(screen.getByTestId("halloween-eyes")).toBeInTheDocument();
  render(wrap(<Eyes active={false} seed={0.7} salt="z" firstDelayMs={[100, 100]} probe={free} />));
  await act(async () => {
    vi.advanceTimersByTime(5000);
  });
  expect(screen.queryAllByTestId("halloween-eyes").length).toBeLessThanOrEqual(1);
});

test("Randschatten: nur bei freier Randspalte, ein bis zwei Sekunden, dann lange Pause; gesperrte Spalte wartet", async () => {
  vi.useFakeTimers();
  fixture = document.createElement("div");
  fixture.innerHTML = '<main id="m"><p id="t">Text</p></main>';
  document.body.appendChild(fixture);
  const free = () => document.getElementById("m");
  render(wrap(<RareEdge active seed={0.3} salt="x" firstDelayMs={[800, 800]} pauseMs={[4000, 4000]} showMs={1500} probe={free} />));
  expect(screen.queryByTestId("halloween-edge")).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(900);
  });
  const edge = screen.getByTestId("halloween-edge");
  expect(["left", "right"]).toContain(edge.getAttribute("data-side"));
  expect(edge.style.top).toMatch(/vh$/);
  await act(async () => {
    vi.advanceTimersByTime(1600);
  });
  expect(screen.queryByTestId("halloween-edge")).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(4100);
  });
  expect(screen.getByTestId("halloween-edge")).toBeInTheDocument();
  fixture.remove();
  fixture = document.createElement("div");
  fixture.innerHTML = '<main id="m2"><p id="t2">Text</p></main>';
  document.body.appendChild(fixture);
  const blocked = () => document.getElementById("t2");
  render(wrap(<RareEdge active seed={0.9} salt="q" firstDelayMs={[300, 300]} showMs={1000} probe={blocked} />));
  await act(async () => {
    vi.advanceTimersByTime(400);
  });
  expect(screen.getAllByTestId("halloween-edge").length).toBeLessThanOrEqual(1);
});

test("Blick zum Zeiger: klein, begrenzt, in Richtung des Zeigers", () => {
  const offset = lookOffset({ x: 400, y: 100 }, { x: 100, y: 100 }, 2);
  expect(offset.x).toBeCloseTo(2, 5);
  expect(offset.y).toBeCloseTo(0, 5);
  const close = lookOffset({ x: 111, y: 100 }, { x: 100, y: 100 }, 2);
  expect(close.x).toBeLessThan(0.2);
});
