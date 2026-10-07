import { act, render, screen } from "@testing-library/react";
import { TvTreeContext, TvTreeNode } from "./TvTreeNode";
import { decide, find, heatDoubleElimination, singleElimination, start } from "../../../e2e/fixtures/tvBrackets.mjs";
import { finderFor } from "@/lib/slotSource";
import { buildPodiumMap } from "@/lib/bracketPodium";

// Die Karte im Turnierbaum am TV (#1116, #1117, #1119): Station und Spielzeit sekundengenau, ein Platz, auf den gerade
// jemand zufährt, zeigt noch, wer kommt; der goldene Weg; weiter / Loser Bracket / raus als Farbe der Zeile.

function renderNode(bracket, key, tree = {}) {
  const match = find(bracket, key);
  const regMap = new Map(bracket.registrations.map((reg) => [reg.id, reg]));
  const value = {
    matches: bracket.matches_v2,
    hiddenSlots: new Set(),
    landing: new Set(),
    goldCards: new Set(),
    goldRows: new Set(),
    finished: false,
    lastStageId: null,
    isTable: () => false,
    ...tree,
  };
  return render(
    <TvTreeContext.Provider value={value}>
      <TvTreeNode match={match} regMap={regMap} podiumMap={buildPodiumMap(bracket.matches_v2, bracket.stages)} findMatch={finderFor(bracket.matches_v2)(match)} />
    </TvTreeContext.Provider>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

test("ein laufendes Spiel zeigt groß Station und Spielzeit - sekundengenau aus der Startzeit", () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-10T14:32:34+02:00"));
  const bracket = singleElimination(8);
  start(bracket, "A", { station: "PC 3", startedAt: "2026-10-10T14:20:00+02:00" });
  renderNode(bracket, "A");
  expect(screen.getByTestId("tv-match-m-A")).toHaveAttribute("data-live", "1");
  expect(screen.getByTestId("tv-match-m-A").className).toContain("tv-node--live");
  expect(screen.getByTestId("tv-spot-m-A")).toHaveTextContent("PC 3·12:34");
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(screen.getByTestId("tv-spot-clock-m-A")).toHaveTextContent("12:35");
});

test("nach dem Turnier atmet nichts mehr - auch kein „Live“", () => {
  const bracket = singleElimination(8);
  start(bracket, "A");
  renderNode(bracket, "A", { finished: true });
  expect(screen.queryByTestId("tv-spot-m-A")).not.toBeInTheDocument();
  expect(screen.getByTestId("tv-match-m-A").className).not.toContain("tv-node--live");
});

test("ein Platz, auf den gerade jemand zufährt, zeigt noch, wer kommt - danach den Namen", () => {
  const bracket = singleElimination(8);
  decide(bracket, "A");
  const { unmount } = renderNode(bracket, "E", { hiddenSlots: new Set(["m-E:0"]) });
  const slot = screen.getByTestId("tv-match-m-E").querySelector("[data-tv-slot='m-E:0']");
  expect(slot).toHaveTextContent("Sieger aus A");
  expect(slot).not.toHaveTextContent("NeonFalke");
  unmount();
  renderNode(bracket, "E", { landing: new Set(["m-E:0"]) });
  const landed = screen.getByTestId("tv-match-m-E").querySelector("[data-tv-slot='m-E:0']");
  expect(landed).toHaveTextContent("NeonFalke");
  expect(landed.className).toContain("tv-row--land");
});

test("Durchgang nach dem Ergebnis: nach Platz sortiert, Weiterkommer blau, Loser Bracket gedämpft rot", () => {
  const bracket = heatDoubleElimination();
  decide(bracket, "A", ["r5", "r8", "r1", "r4"]);
  renderNode(bracket, "A");
  const rows = [...screen.getByTestId("tv-match-m-A").querySelectorAll("[data-tv-slot]")];
  expect(rows.map((row) => row.getAttribute("data-tv-reg"))).toEqual(["r5", "r8", "r1", "r4"]);
  expect(rows.map((row) => row.getAttribute("data-outcome"))).toEqual(["win", "win", "drop", "drop"]);
  expect(rows[0].className).toContain("tv-row--q");
  expect(rows[2].className).toContain("tv-row--drop");
  expect(screen.getByTestId("tv-match-m-A")).toHaveTextContent("4 Spieler · 2 kommen weiter");
});

test("im Duell: wer ausscheidet, wird blasser; der goldene Weg leuchtet in der Zeile des Siegers", () => {
  const bracket = singleElimination(8);
  decide(bracket, "A");
  renderNode(bracket, "A", { goldCards: new Set(["m-A"]), goldRows: new Set(["m-A:r1"]) });
  const card = screen.getByTestId("tv-match-m-A");
  expect(card.className).toContain("tv-node--gold");
  expect(card.querySelector("[data-tv-reg='r1']").className).toContain("tv-row--gold");
  expect(card.querySelector("[data-tv-reg='r8']").className).toContain("tv-row--out");
});
