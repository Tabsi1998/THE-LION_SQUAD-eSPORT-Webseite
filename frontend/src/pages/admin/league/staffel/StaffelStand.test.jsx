import { render, screen } from "@testing-library/react";
import { StaffelStand } from "./StaffelStand";

// Stand der Staffel ohne Season-Angaben (#2262): im Spielbetrieb derselbe pulsierende Punkt wie `StaffelStandBadge`, bei reduzierter
// Bewegung statisch (`motion-safe:`).

const staffel = (status) => ({ id: "t1", status, league_context: { season_id: "s1", staffel: "A" } });

test("Spielbetrieb trägt den Live-Punkt, nur mit erlaubter Bewegung pulsierend", () => {
  render(<StaffelStand tournament={staffel("live")} />);
  const dot = screen.getByTestId("staffel-stand-dot");
  expect(dot.className).toContain("motion-safe:animate-pulse");
  expect(dot.className).not.toMatch(/(^|\s)animate-pulse/);
  expect(screen.getByText("Spielbetrieb")).toBeInTheDocument();
});

test("vor dem Start und pausiert ohne Punkt", () => {
  const { unmount } = render(<StaffelStand tournament={staffel("draft")} />);
  expect(screen.queryByTestId("staffel-stand-dot")).toBeNull();
  unmount();
  render(<StaffelStand tournament={staffel("paused")} />);
  expect(screen.queryByTestId("staffel-stand-dot")).toBeNull();
});
