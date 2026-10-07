import { render, screen } from "@testing-library/react";
import { MEMBERSHIP_STEPS, StepBar, eventStep, eventSteps, tournamentStep, tournamentSteps } from "./StepBar";

// Schritt-Anzeige (#1081): zeigt immer den echten Stand, die Schritte davor gelten als erledigt, Vorleseprogramme
// hören „Schritt x von y“.

test("zeigt erledigte, aktuellen und offene Schritte und spricht den Stand aus", () => {
  render(<StepBar steps={MEMBERSHIP_STEPS} current={1} />);
  const bar = screen.getByTestId("step-bar");
  expect(bar).toHaveAttribute("aria-label", "Schritt 2 von 4: Antrag");
  const items = bar.querySelectorAll("li");
  expect([...items].map((item) => item.dataset.state)).toEqual(["done", "current", "open", "open"]);
  expect(items[1]).toHaveAttribute("aria-current", "step");
  expect(items[0]).not.toHaveAttribute("aria-current");
  expect(bar).toHaveTextContent("Konto");
  expect(bar).toHaveTextContent("Mitglied");
});

test("hält den Stand in den Grenzen und fällt ohne Schritte weg", () => {
  const { container, rerender } = render(<StepBar steps={MEMBERSHIP_STEPS} current={9} />);
  expect(screen.getByTestId("step-bar")).toHaveAttribute("aria-label", "Schritt 4 von 4: Mitglied");
  rerender(<StepBar steps={[]} current={0} />);
  expect(container.querySelector("[data-testid='step-bar']")).toBeNull();
});

// Turnier- und Event-Anmeldung (#1081): die Schritte richten sich nach Kosten und Check-in, der Stand nach der echten
// Anmeldung - auch nach „Zurück“, weil nichts davon im Browser gemerkt wird.
test("Turnier: Schritte nach Kosten und Check-in, Stand aus der Anmeldung", () => {
  const plain = tournamentSteps({});
  expect(plain.map((step) => step.label)).toEqual(["Anmeldung", "Freigabe", "Turnier"]);
  const full = tournamentSteps({ offer: { positions: [{ key: "start" }] }, check_in_from: "2099-10-04T17:00:00+00:00" });
  expect(full.map((step) => step.label)).toEqual(["Anmeldung", "Freigabe", "Startgeld", "Check-in", "Turnier"]);
  expect(tournamentStep(full, null)).toBe(0);
  expect(tournamentStep(full, { status: "pending" })).toBe(1);
  expect(tournamentStep(full, { status: "approved", price: { total_cents: 1000, billing_status: "pending" } })).toBe(2);
  expect(tournamentStep(full, { status: "approved", price: { total_cents: 1000, billing_status: "paid" } })).toBe(3);
  expect(tournamentStep(full, { status: "checked_in" })).toBe(4);
  expect(tournamentStep(plain, { status: "approved" })).toBe(2);
  expect(tournamentStep(full, { status: "rejected" })).toBe(-1);
  // Warteliste heißt so; ein Preis von null zählt nicht als Kosten.
  expect(tournamentSteps({}, { status: "waitlist" })[1].label).toBe("Warteliste");
  expect(tournamentSteps({ offer: { positions: [{ key: "start" }] } }, { status: "approved", price: { total_cents: 0 } }).map((step) => step.key)).not.toContain("payment");
});

test("Event: nur mit Kosten eine Leiste - Anmeldung, Bezahlen, Dabei", () => {
  expect(eventSteps({}, null)).toEqual([]);
  const steps = eventSteps({ offer: { positions: [{ key: "ticket" }] } }, null);
  expect(steps.map((step) => step.label)).toEqual(["Anmeldung", "Bezahlen", "Dabei"]);
  expect(eventStep(steps, null)).toBe(0);
  expect(eventStep(steps, { status: "waitlist" })).toBe(0);
  expect(eventStep(steps, { status: "registered", price: { total_cents: 1500, billing_status: "pending" } })).toBe(1);
  expect(eventStep(steps, { status: "registered", price: { total_cents: 1500, billing_status: "paid" } })).toBe(2);
  expect(eventStep(steps, { status: "checked_in" })).toBe(2);
  expect(eventStep(steps, { status: "cancelled" })).toBe(-1);
});

test("zu schmal für alle Namen: nur der aktuelle Schritt mit Zähler, nichts abgeschnitten", () => {
  const realRange = document.createRange;
  const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const RealObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  let textWidth = 50;
  document.createRange = () => ({ selectNodeContents() {}, getBoundingClientRect: () => ({ width: textWidth }) });
  Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 60 });
  try {
    const { unmount } = render(<StepBar steps={tournamentSteps({})} current={1} testId="breit" />);
    expect(screen.getByTestId("breit")).not.toHaveAttribute("data-compact");
    unmount();
    textWidth = 80;
    render(<StepBar steps={tournamentSteps({})} current={1} testId="schmal" />);
    const bar = screen.getByTestId("schmal");
    expect(bar).toHaveAttribute("data-compact");
    expect(bar.querySelector("[data-state='current']")).toHaveTextContent("2/3 · Freigabe");
    expect(bar).toHaveAttribute("aria-label", "Schritt 2 von 3: Freigabe");
  } finally {
    document.createRange = realRange;
    if (realWidth) Object.defineProperty(HTMLElement.prototype, "clientWidth", realWidth);
    globalThis.ResizeObserver = RealObserver;
  }
});
