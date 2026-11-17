import { act, fireEvent, render, screen } from "@testing-library/react";
import { AdminTabBar, hiddenSides } from "./AdminTabBar";

// Reiterleiste der Verwaltung (#2262, Feinschliff): Der Hinweis nennt die Richtung nach dem Scrollstand - rechts, links, beides - und
// verschwindet, wenn alle Reiter Platz haben.

const TABS = [{ key: "a", label: "Überblick" }, { key: "b", label: "Teilnehmer" }, { key: "c", label: "Spielplan" }];

function sized(node, { scrollWidth, clientWidth, scrollLeft }) {
  Object.defineProperty(node, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(node, "clientWidth", { configurable: true, value: clientWidth });
  Object.defineProperty(node, "scrollLeft", { configurable: true, writable: true, value: scrollLeft });
}

test("hiddenSides liest den Scrollstand", () => {
  expect(hiddenSides({ scrollWidth: 300, clientWidth: 300, scrollLeft: 0 })).toEqual({ left: false, right: false });
  expect(hiddenSides({ scrollWidth: 600, clientWidth: 300, scrollLeft: 0 })).toEqual({ left: false, right: true });
  expect(hiddenSides({ scrollWidth: 600, clientWidth: 300, scrollLeft: 150 })).toEqual({ left: true, right: true });
  expect(hiddenSides({ scrollWidth: 600, clientWidth: 300, scrollLeft: 300 })).toEqual({ left: true, right: false });
});

test("der Hinweis folgt dem Scrollen und hat genug Kontrast", () => {
  render(<AdminTabBar tabs={TABS} active="a" onSelect={() => {}} idBase="x" label="Bereiche" testPrefix="probe" />);
  expect(screen.queryByTestId("probe-tabs-hint")).toBeNull();
  const bar = screen.getByTestId("probe-tabs");
  sized(bar, { scrollWidth: 600, clientWidth: 300, scrollLeft: 0 });
  act(() => { fireEvent.scroll(bar); });
  expect(screen.getByTestId("probe-tabs-hint")).toHaveTextContent("weitere Reiter liegen rechts.");
  expect(screen.getByTestId("probe-tabs-hint").className).toContain("text-white/60");
  sized(bar, { scrollWidth: 600, clientWidth: 300, scrollLeft: 150 });
  act(() => { fireEvent.scroll(bar); });
  expect(screen.getByTestId("probe-tabs-hint")).toHaveTextContent("weitere Reiter liegen links und rechts.");
  sized(bar, { scrollWidth: 600, clientWidth: 300, scrollLeft: 300 });
  act(() => { fireEvent.scroll(bar); });
  expect(screen.getByTestId("probe-tabs-hint")).toHaveTextContent("weitere Reiter liegen links.");
  sized(bar, { scrollWidth: 300, clientWidth: 300, scrollLeft: 0 });
  act(() => { fireEvent.scroll(bar); });
  expect(screen.queryByTestId("probe-tabs-hint")).toBeNull();
});
