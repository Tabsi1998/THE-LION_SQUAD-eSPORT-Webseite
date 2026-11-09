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

// #2336: im Baum zählt die erreichte Runde - Fabians Beispiel mit erfundenen Namen (9 Teilnehmer, Doppel-K.-o.).
const treeRows = [
  { registration_id: "r1", display_name: "NeonFalke", rank: 1, played: 4, won: 4, lost: 0, reached: "Grand Final", place_path: "Grand Final gewonnen" },
  { registration_id: "r2", display_name: "LunaByte", rank: 2, played: 2, won: 1, lost: 1, reached: "Grand Final", place_path: "im Grand Final" },
  { registration_id: "r3", display_name: "KartKönigin", rank: 3, played: 4, won: 3, lost: 1, reached: "Loser Final", place_path: "im Loser Final raus" },
];

test("Baum: der Weg zum Platz, darunter klein die gewonnenen Spiele, und ein Satz, warum die Siege nicht passen", () => {
  render(<Podium rows={treeRows} registrations={[]} />);
  const second = screen.getByTestId("podium-place-2");
  expect(second).toHaveTextContent("im Grand Final");
  expect(second).toHaveTextContent("1 Spiel gewonnen");
  expect(second).not.toHaveTextContent("Sieg");
  expect(screen.getByTestId("podium-place-1")).toHaveTextContent("Grand Final gewonnen4 Spiele gewonnen");
  const note = screen.getByTestId("podium-note");
  expect(note).toHaveTextContent("erreichte Runde, nicht die Zahl der Siege");
  expect(note).toHaveTextContent("Freilos");
  expect(note).toHaveTextContent("Doppel-K.-o.");
});

test("Baum mit passenden Siegen: Weg ja, Satz nein", () => {
  const ordered = treeRows.map((row, index) => ({ ...row, won: 4 - index }));
  render(<Podium rows={ordered} registrations={[]} />);
  expect(screen.getAllByTestId("podium-path")).toHaveLength(3);
  expect(screen.queryByTestId("podium-note")).toBeNull();
});

test("Formate ohne Baum bleiben, wie sie sind: Liga, Gruppen, FFA-Punkte, Fast Lap - kein Weg, kein Satz", () => {
  const cases = [
    // Liga/Gruppe: Punkte aus der Tabelle, auch wenn ein Besserer weniger Siege hat.
    [{ registration_id: "a", display_name: "Alpha", rank: 1, won: 2, points: 7, score_diff: 5 }, { registration_id: "b", display_name: "Beta", rank: 2, won: 3, points: 6, score_diff: 2 }],
    // FFA: Siege bzw. Punkte, ein Ziel „Finale“ steht da, aber kein Weg.
    [{ registration_id: "a", display_name: "Alpha", rank: 1, won: 1, points: 30, reached: "Finale" }, { registration_id: "b", display_name: "Beta", rank: 2, won: 2, points: 25, reached: "Finale" }],
    // Fast Lap: fertiger Wert.
    [{ registration_id: "a", display_name: "Alpha", rank: 1, value: "1:31.234" }, { registration_id: "b", display_name: "Beta", rank: 2, value: "1:32.100" }],
  ];
  const expected = [["7 Pkt", "6 Pkt"], ["1 Sieg", "2 Siege"], ["1:31.234", "1:32.100"]];
  cases.forEach((rows, index) => {
    const { unmount } = render(<Podium rows={rows} registrations={[]} />);
    expect(screen.getByTestId("podium-place-1").querySelector(".tls-podium__value")).toHaveTextContent(expected[index][0]);
    expect(screen.getByTestId("podium-place-2").querySelector(".tls-podium__value")).toHaveTextContent(expected[index][1]);
    expect(screen.queryByTestId("podium-path")).toBeNull();
    expect(screen.queryByTestId("podium-note")).toBeNull();
    unmount();
  });
});
