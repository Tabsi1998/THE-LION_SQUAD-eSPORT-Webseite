import { act, fireEvent, render, screen } from "@testing-library/react";
import { FREED_SIGNAL, Graveyard, ghostDrift } from "./graveyard";
import { createMotionScheduler, resetMotionScheduler } from "../motion";
import { outboxSize, signalCount } from "../signals";

// Bewegungsbudget (H11): in diesen Tests darf alles sofort - der Planer selbst hat seine eigenen Tests.
beforeEach(() => resetMotionScheduler(createMotionScheduler({ unlimited: true })));
afterAll(() => resetMotionScheduler(null));

// Mini-Friedhof (#662): Gräber stehen auf dem Strich über dem Impressum, ein Klick lässt einen Geist aufsteigen,
// je Grab höchstens einer je Sperrzeit; ohne Strich oder ohne Gräber nichts.

let fixture = null;

afterEach(() => {
  fixture?.remove();
  fixture = null;
});

function footerWithLine(offsetTop = 300) {
  fixture?.remove();
  fixture = document.createElement("div");
  fixture.innerHTML = '<footer style="position:relative"><div data-season-line="footer"></div></footer>';
  document.body.appendChild(fixture);
  Object.defineProperty(document.querySelector("[data-season-line]"), "offsetTop", { value: offsetTop, configurable: true });
}

test("Gräber auf dem Strich, Geist beim Klick, Sperre je Grab, Geister verschwinden wieder", async () => {
  footerWithLine(300);
  const graves = [{ x: 0.1, size: 20, tilt: 3 }, { x: 0.3, size: 18, tilt: -2 }];
  render(<Graveyard graves={graves} salt="s" ghostMs={60} cooldownMs={1000} />);
  expect(screen.getByTestId("halloween-graveyard").style.top).toBe("300px");
  const stones = screen.getAllByTestId("halloween-grave");
  expect(stones.length).toBe(2);
  expect(stones[0].style.left).toBe("10%");
  expect(stones[1].style.getPropertyValue("--tilt")).toBe("-2deg");
  fireEvent.click(stones[0]);
  expect(screen.getAllByTestId("halloween-ghost").length).toBe(1);
  fireEvent.click(stones[0]);
  expect(screen.getAllByTestId("halloween-ghost").length).toBe(1);
  fireEvent.click(stones[1]);
  expect(screen.getAllByTestId("halloween-ghost").length).toBe(2);
  expect(screen.getAllByTestId("halloween-ghost")[0].style.getPropertyValue("--dur")).toBe("60ms");
  await act(() => new Promise((resolve) => setTimeout(resolve, 170)));
  expect(screen.queryAllByTestId("halloween-ghost").length).toBe(0);
});

test("ohne Gräber oder ohne Strich bleibt es leer", () => {
  footerWithLine(200);
  const empty = render(<Graveyard graves={[]} salt="s" />);
  expect(screen.queryByTestId("halloween-graveyard")).toBeNull();
  empty.unmount();
  fixture.remove();
  fixture = null;
  render(<Graveyard graves={[{ x: 0.1, size: 20, tilt: 0 }]} salt="s" />);
  expect(screen.queryByTestId("halloween-graveyard")).toBeNull();
});

test("Geister treiben meist nach oben, ein wenig zur Seite", () => {
  const straight = ghostDrift(() => 0.5);
  expect(straight.dy).toBeLessThan(-250);
  expect(Math.abs(straight.dx)).toBeLessThan(1);
  const aside = ghostDrift(() => 0.9);
  expect(aside.dx).toBeGreaterThan(50);
  expect(aside.dy).toBeLessThan(0);
});

test("Fundstücke (#678): jeder befreite Geist zählt - ein Klick in der Sperrzeit nicht", () => {
  localStorage.clear();
  footerWithLine(300);
  render(<Graveyard graves={[{ x: 0.1, size: 20, tilt: 3 }, { x: 0.3, size: 18, tilt: -2 }]} salt="s" ghostMs={60} cooldownMs={1000} />);
  const stones = screen.getAllByTestId("halloween-grave");
  fireEvent.click(stones[0]);
  fireEvent.click(stones[0]);
  expect(signalCount(FREED_SIGNAL)).toBe(1);
  fireEvent.click(stones[1]);
  expect(signalCount(FREED_SIGNAL)).toBe(2);
  expect(outboxSize()).toBe(2);
  expect(FREED_SIGNAL).toBe("halloween_ghosts_freed");
  localStorage.clear();
});
