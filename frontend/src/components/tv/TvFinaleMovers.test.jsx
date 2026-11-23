import { render, screen, within } from "@testing-library/react";
import { TvFinaleMovers } from "./TvFinaleMovers";
import { FINALE_TIMING } from "@/lib/tvFinale";

// Saisonfinale (#1641): je Liga N die Auf- und Absteiger - Spalten, Ziel-Liga, Staffelung und volle Namen. Erfundene Namen.

const LONG = "Die außergewöhnlich lange Teambezeichnung der Probe-Mannschaft Nord-Ost";
const PAGE = {
  label: "Liga 2", step: 2, count: 3, more: 0, rows: [
    { registration_id: "b", name: "Probe Nord", rank: 1, move: "up", target: "Liga 1", staffel: "A" },
    { registration_id: "d", name: LONG, rank: 1, move: "up", target: "Liga 1", staffel: "B" },
    { registration_id: "c", name: "Probe Tief", rank: 4, move: "down", target: "Liga 3", staffel: "A" },
    { registration_id: "e", name: "Probe Raus", rank: 5, move: "out", target: null, staffel: "B" },
  ],
};

test("zwei Spalten mit Pfeil, Platz, Staffel und Ziel-Liga", () => {
  render(<TvFinaleMovers page={PAGE} league="Probe-Liga" season="Season 1" />);
  expect(screen.getByTestId("tv-finale-line")).toHaveTextContent("Saisonfinale · Probe-Liga · Season 1");
  expect(screen.getByTestId("tv-finale-title")).toHaveTextContent("Liga 2 Auf- und Absteiger");
  const up = screen.getByTestId("tv-finale-col-up");
  expect(within(up).getByRole("heading")).toHaveTextContent("Aufstieg");
  expect(within(up).getAllByRole("listitem").map((row) => row.getAttribute("aria-label"))).toEqual([
    "Probe Nord steigt auf in Liga 1", `${LONG} steigt auf in Liga 1`]);
  const down = screen.getByTestId("tv-finale-col-down");
  expect(within(down).getByRole("heading")).toHaveTextContent("Abstieg");
  expect(screen.getByTestId("tv-finale-target-c")).toHaveTextContent("Liga 3");
  expect(screen.getByTestId("tv-finale-target-e")).toHaveTextContent("scheidet aus");
  expect(screen.getByTestId("tv-finale-row-b")).toHaveTextContent("Platz 1 · Staffel A");
  // Der lange Name steht ganz da - kleiner, nie abgeschnitten.
  const name = within(screen.getByTestId("tv-finale-row-d")).getByText(LONG);
  expect(name).toHaveAttribute("data-fit", "tiny");
  expect(within(screen.getByTestId("tv-finale-dots")).getAllByRole("listitem")).toHaveLength(3);
});

test("gestaffelt: jede Zeile später als die davor, über beide Spalten; die Ziel-Liga nach der Zeile, der Schluss zuletzt", () => {
  render(<TvFinaleMovers page={PAGE} />);
  const at = (id) => parseFloat(screen.getByTestId(`tv-finale-row-${id}`).style.getPropertyValue("--tv-finale-at"));
  const target = (id) => parseFloat(screen.getByTestId(`tv-finale-row-${id}`).style.getPropertyValue("--tv-finale-target-at"));
  const order = ["b", "d", "c", "e"].map(at);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(new Set(order).size).toBe(4);
  expect(target("b")).toBeGreaterThan(at("b"));
  const end = parseFloat(screen.getByTestId("tv-finale").style.getPropertyValue("--tv-finale-end"));
  expect(end).toBeGreaterThan(target("e"));
  expect(screen.getByTestId("tv-finale")).toHaveAttribute("data-columns", "2");
});

test("nur Absteiger: eine Spalte, ohne Punkte für eine einzige Liga N", () => {
  render(<TvFinaleMovers page={{ label: "Liga 1", step: 1, count: 1, rows: [PAGE.rows[2]] }} />);
  expect(screen.getByTestId("tv-finale")).toHaveAttribute("data-columns", "1");
  expect(screen.queryByTestId("tv-finale-col-up")).toBeNull();
  expect(screen.queryByTestId("tv-finale-dots")).toBeNull();
});

test("Spaltenköpfe: Verzögerung aus FINALE_TIMING über eine Variable - keine feste Zeit im CSS", () => {
  render(<TvFinaleMovers page={PAGE} />);
  expect(screen.getByTestId("tv-finale").style.getPropertyValue("--tv-finale-head-at")).toBe(`${FINALE_TIMING.head}s`);
});

test("Nr. 235: zwölf Absteiger - acht Zeilen, darunter „und 4 weitere“ in der eigenen Spalte, nach der letzten Zeile", () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({ registration_id: `x${index}`, name: `Probe ${index}`, rank: index + 3,
    move: "down", target: "Liga 3", staffel: null }));
  render(<TvFinaleMovers page={{ label: "Liga 2", step: 1, count: 1, rows }} />);
  const down = screen.getByTestId("tv-finale-col-down");
  expect(within(down).getAllByRole("listitem")).toHaveLength(8);
  const more = within(down).getByTestId("tv-finale-more-down");
  expect(more).toHaveTextContent("und 4 weitere");
  const last = parseFloat(screen.getByTestId("tv-finale-row-x7").style.getPropertyValue("--tv-finale-at"));
  expect(parseFloat(more.style.getPropertyValue("--tv-finale-at"))).toBeGreaterThan(last);
  expect(screen.queryByTestId("tv-finale-more")).toBeNull();
});

test("ohne Liga und Season keine Zeile über dem Titel - die Kopfleiste des TV trägt „Saisonfinale“", () => {
  render(<TvFinaleMovers page={PAGE} />);
  expect(screen.queryByTestId("tv-finale-line")).toBeNull();
});
