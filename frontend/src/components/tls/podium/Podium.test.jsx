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

test("drei gleiche Erste: eine breite Stufe mit allen Namen, keine leeren Stufen; lange Einzelwörter brechen nicht", () => {
  const threeFirst = standings.map((row) => ({ ...row, rank: row.rank <= 3 ? 1 : row.rank }));
  render(<Podium rows={threeFirst} registrations={bracket.registrations} />);
  const steps = screen.getAllByTestId(/^podium-place-/);
  expect(steps.map((step) => step.getAttribute("data-place"))).toEqual(["1"]);
  expect(steps[0].querySelectorAll("[data-podium-entry]")).toHaveLength(3);
  expect(screen.queryByText("–")).toBeNull();
  for (const name of document.querySelectorAll(".tls-podium__name")) {
    if (!/\s/.test(name.textContent)) expect(name.className).toContain("tls-podium__name--word");
  }
});

test("unter dem sichtbaren Bereich (etwa hinter dem Sieger-Moment): nichts versteckt, beim Hereinscrollen nur ein kurzer Gruß", async () => {
  const { act } = await import("@testing-library/react");
  let notify = null;
  window.IntersectionObserver = class { constructor(callback) { notify = callback; } observe() {} disconnect() {} };
  const rect = vi.spyOn(window.Element.prototype, "getBoundingClientRect").mockReturnValue({ top: 5000, bottom: 5400, left: 0, right: 100, width: 100, height: 400 });
  try {
    render(<Podium rows={standings} registrations={bracket.registrations} />);
    expect(screen.getByTestId("podium")).toHaveAttribute("data-play", "idle");
    act(() => notify([{ isIntersecting: true }]));
    expect(screen.getByTestId("podium")).toHaveAttribute("data-play", "late");
  } finally {
    rect.mockRestore();
    delete window.IntersectionObserver;
  }
});
