import { render, screen } from "@testing-library/react";
import fixture from "../../../../e2e/fixtures/tableScheduleGenerated.json";

// Podest (#1339): Treppchen mit Platz 1 in der Mitte und höher, Metall nur an Kante und Ziffer; Bewegung genau einmal,
// mit „Bewegung reduzieren“ steht alles still. Daten aus dem echten Generator.

let reduced = false;
vi.mock("@/lib/motion", async (importOriginal) => ({ ...(await importOriginal()), motionAllowed: () => !reduced }));
const { Podium } = await import("./Podium");

const { standings, bracket } = fixture.finished;

beforeEach(() => { reduced = false; });

test("drei Stufen: 2 links, 1 in der Mitte mit Krone, 3 rechts - mit Namen und Wert", () => {
  render(<Podium rows={standings} registrations={bracket.registrations} />);
  const steps = screen.getAllByTestId(/^podium-place-/);
  expect(steps.map((step) => step.getAttribute("data-place"))).toEqual(["2", "1", "3"]);
  expect(screen.getByTestId("podium-crown")).toBeInTheDocument();
  for (const row of standings.filter((r) => r.rank <= 3)) expect(screen.getByText(row.display_name)).toBeInTheDocument();
  expect(screen.getByRole("list", { name: "Podest" })).toBeInTheDocument();
});

test("Gleichstand auf Platz 3 steht nebeneinander, ein fehlender Platz zeigt „–“", () => {
  const tied = standings.map((row) => (row.rank === 4 ? { ...row, rank: 3 } : row));
  const { unmount } = render(<Podium rows={tied} registrations={bracket.registrations} />);
  expect(screen.getByTestId("podium-place-3").querySelectorAll("[data-podium-entry]")).toHaveLength(2);
  unmount();
  render(<Podium rows={standings.filter((row) => row.rank <= 2)} registrations={bracket.registrations} />);
  expect(screen.getByTestId("podium-place-3")).toHaveTextContent("–");
});

test("bewegt sich einmal beim Erscheinen - mit „Bewegung reduzieren“ gar nicht", () => {
  const { unmount } = render(<Podium rows={standings} registrations={bracket.registrations} />);
  expect(screen.getByTestId("podium")).toHaveAttribute("data-play");
  unmount();
  reduced = true;
  render(<Podium rows={standings} registrations={bracket.registrations} />);
  expect(screen.getByTestId("podium")).not.toHaveAttribute("data-play");
});

test("ohne Plätze kein Podest", () => {
  const { container } = render(<Podium rows={[]} registrations={[]} />);
  expect(container).toBeEmptyDOMElement();
});
