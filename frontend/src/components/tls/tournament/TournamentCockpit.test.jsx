import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { cockpitProblems } from "@/lib/tournamentCockpit";
import { TournamentCockpit } from "./TournamentCockpit";

// Turnier-Cockpit (#1653): Probleme als Links zum Fall, Stationen mit denselben Knöpfen wie im Reiter „Stationen“
// (Aufrufen, Starten, Freigeben mit Rückfrage, Defekt), Bewegung nur ohne „Bewegung reduzieren“. Namen erfunden.

vi.mock("@/seasons/SeasonContext", () => ({ useSeason: () => ({ serverOffset: 0 }) }));

const ATTENTION = [
  { id: "rm-m1", kind: "result_missing", title: "Ergebnis fehlt", match_id: "m1", station_text: "PC 2 · PC", label: "Viertelfinale", names: "NeonFalke gegen Jo", detail: "4 Min. über der Zeit", overdue_minutes: 4 },
  { id: "ds-m5", kind: "dispute", title: "Streitfall gemeldet", match_id: "m5", station_text: "PC 1 · PC", label: "Halbfinale", names: "Kometa gegen Frostbiss", detail: "Kometa: „Falsches Ergebnis“" },
];
const queued = { match_id: "QF3", label: "Viertelfinale", names: ["TurboTina", "PixelPanther"], ready: true, state: "queued", position: 1, delay_minutes: 15, forecast_at: "2026-11-13T16:40:00Z", planned_at: "2026-11-13T16:25:00Z" };
const called = { ...queued, match_id: "QF4", names: ["Aurora Blitz", "Zackenbarsch"], state: "called", delay_minutes: 0, called_at: "2026-11-13T16:20:00Z" };
const running = { match_id: "QF1", label: "Viertelfinale", names: ["NeonFalke", "Jo"], ready: true, state: "running", position: 0, started_at: new Date(Date.now() - 5 * 60000).toISOString(), duration_minutes: 20 };
const QUEUE = {
  applies: true, summary: null, operate: { all: true, station_ids: [] }, matches: {},
  stations: [
    { id: "pc1", name: "PC 1", station_text: "PC 1 · PC", status: "busy", waiting: 0, running, next: null, after: null },
    { id: "pc2", name: "PC 2", station_text: "PC 2 · PC", status: "free", waiting: 1, running: null, next: queued, after: null },
    { id: "pc3", name: "PC 3", station_text: "PC 3 · PC", status: "reserved", waiting: 1, running: null, next: called, after: null },
  ],
};

function board() {
  return { busyKey: "", onCall: vi.fn(), onStart: vi.fn(), onRelease: vi.fn(), onBroken: vi.fn(), onMove: vi.fn(), onClear: vi.fn(), onCallAll: vi.fn() };
}

function show(props) {
  return render(<MemoryRouter><TournamentCockpit loaded queue={QUEUE} board={board()} {...props} /></MemoryRouter>);
}

function reduceMotion(on) {
  window.matchMedia = vi.fn((query) => ({ matches: on && query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
}

afterEach(() => {
  delete window.matchMedia;
});

test("Probleme: dringendstes zuerst, jede Zeile ein Link zum Fall - Verzug zur Station", () => {
  const onOpen = vi.fn();
  show({ problems: cockpitProblems({ attention: ATTENTION, queue: QUEUE }), onOpen });
  const rows = screen.getAllByTestId(/^cockpit-problem-(?!chip|item)/);
  expect(rows.map((row) => row.dataset.testid)).toEqual(["cockpit-problem-ds-m5", "cockpit-problem-rm-m1", "cockpit-problem-dl-pc2"]);
  expect(rows[0]).toHaveAttribute("href", "/?fall=ds-m5");
  expect(rows[0]).toHaveTextContent("Einspruch");
  expect(rows[0]).toHaveTextContent("Kometa gegen Frostbiss");
  expect(rows[2]).toHaveAttribute("href", "/?station=pc2");
  expect(rows[2]).toHaveTextContent("+15 Min. hinter dem Plan");
  expect(screen.getByTestId("cockpit-problems-count")).toHaveTextContent("3 Probleme");
  fireEvent.click(rows[1]);
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: "rm-m1", target: "case" }));
});

test("ohne Probleme: „Alles im Plan“ - erst wenn geladen", () => {
  const { rerender } = show({ problems: [], loaded: false });
  expect(screen.queryByTestId("cockpit-problems-empty")).toBeNull();
  // Vor dem ersten Laden wird nichts angesagt (Review N3).
  expect(screen.getByTestId("cockpit-problems-count")).not.toHaveTextContent("Keine Probleme");
  expect(screen.getByTestId("cockpit-problems-count")).toHaveTextContent("Wird geladen");
  rerender(<MemoryRouter><TournamentCockpit loaded queue={QUEUE} board={board()} problems={[]} /></MemoryRouter>);
  expect(screen.getByTestId("cockpit-problems-empty")).toHaveTextContent("Alles im Plan");
  expect(screen.getByTestId("cockpit-problems-count")).toHaveTextContent("Keine Probleme");
});

test("Stationen: läuft mit Spielzeit-Uhr, Als Nächstes - Aufrufen, Starten, Freigeben (mit Rückfrage) und Defekt über die bestehenden Wege", () => {
  const handlers = board();
  render(<MemoryRouter><TournamentCockpit loaded queue={QUEUE} board={handlers} problems={[]} /></MemoryRouter>);
  expect(screen.getByTestId("live-clock-QF1")).toHaveAttribute("role", "timer");
  expect(screen.getByTestId("live-next-pc2")).toHaveTextContent("Als Nächstes");

  fireEvent.click(screen.getByTestId("live-call-pc2"));
  expect(handlers.onCall).toHaveBeenCalledWith(QUEUE.stations[1], queued);

  fireEvent.click(screen.getByTestId("live-start-pc3"));
  expect(handlers.onStart).toHaveBeenCalledWith(QUEUE.stations[2], called);

  // Freigeben fragt nach wie im Reiter „Stationen“ - erst „Freigeben“ in der Rückfrage löst aus.
  fireEvent.click(screen.getByTestId("live-release-pc1"));
  expect(handlers.onRelease).not.toHaveBeenCalled();
  expect(screen.getByTestId("live-release-confirm-pc1")).toHaveTextContent("Das Spiel läuft noch");
  fireEvent.click(screen.getByTestId("live-release-yes-pc1"));
  expect(handlers.onRelease).toHaveBeenCalledWith(QUEUE.stations[0], running);

  fireEvent.click(screen.getByTestId("live-broken-pc2"));
  expect(handlers.onBroken).toHaveBeenCalledWith(QUEUE.stations[1], true);
});

test("Aktionen nur mit Recht: ohne Bedien-Recht für die Station keine Knöpfe", () => {
  const queue = { ...QUEUE, operate: { all: false, station_ids: ["pc3"] } };
  render(<MemoryRouter><TournamentCockpit loaded queue={queue} board={board()} problems={[]} /></MemoryRouter>);
  expect(screen.queryByTestId("live-call-pc2")).toBeNull();
  expect(screen.queryByTestId("live-release-pc1")).toBeNull();
  expect(screen.getByTestId("live-start-pc3")).toBeInTheDocument();
});

test("Sprung aus „Verzug“: die Station ist markiert", () => {
  show({ problems: [], highlightStation: "pc2" });
  expect(screen.getByTestId("live-station-pc2")).toHaveAttribute("data-highlighted", "true");
  expect(screen.getByTestId("live-station-pc1")).not.toHaveAttribute("data-highlighted");
});

test("Bewegung: neue Probleme steigen gestaffelt ein - wer schon stand, bleibt stehen", () => {
  reduceMotion(false);
  const first = cockpitProblems({ attention: [ATTENTION[0]] });
  const { rerender } = show({ problems: first });
  expect(screen.getByTestId("cockpit-problems-list")).toHaveAttribute("data-motion", "on");
  const kept = screen.getByTestId("cockpit-problem-rm-m1");
  const next = cockpitProblems({ attention: ATTENTION, queue: QUEUE });
  rerender(<MemoryRouter><TournamentCockpit loaded queue={QUEUE} board={board()} problems={next} /></MemoryRouter>);
  // Dieselbe Zeile (kein Neuaufbau), die neuen nacheinander: 0 ms, 50 ms.
  expect(screen.getByTestId("cockpit-problem-rm-m1")).toBe(kept);
  expect(screen.getByTestId("cockpit-problem-item-ds-m5").style.getPropertyValue("--tls-cockpit-delay")).toBe("0ms");
  expect(screen.getByTestId("cockpit-problem-item-dl-pc2").style.getPropertyValue("--tls-cockpit-delay")).toBe("50ms");
});

test("„Bewegung reduzieren“: die Liste springt - Erledigtes ist sofort weg, nichts steigt ein", () => {
  reduceMotion(true);
  const { rerender } = show({ problems: cockpitProblems({ attention: ATTENTION }) });
  expect(screen.getByTestId("cockpit-problems-list")).toHaveAttribute("data-motion", "off");
  expect(screen.queryByTestId("cockpit-problem-item-ds-m5")).toBeNull();
  rerender(<MemoryRouter><TournamentCockpit loaded queue={QUEUE} board={board()} problems={cockpitProblems({ attention: [ATTENTION[0]] })} /></MemoryRouter>);
  expect(screen.queryByTestId("cockpit-problem-ds-m5")).toBeNull();
  expect(screen.getByTestId("cockpit-problem-rm-m1")).toBeInTheDocument();
});

test("„Alles im Plan“ erst, wenn die letzte Zeile hinausgeglitten ist (Review N6)", async () => {
  reduceMotion(false);
  const { rerender } = show({ problems: cockpitProblems({ attention: [ATTENTION[0]] }) });
  expect(screen.queryByTestId("cockpit-problems-empty")).toBeNull();
  rerender(<MemoryRouter><TournamentCockpit loaded queue={QUEUE} board={board()} problems={[]} /></MemoryRouter>);
  // Die Zeile gleitet noch hinaus - die Meldung wartet.
  expect(screen.getByTestId("cockpit-problem-rm-m1")).toBeInTheDocument();
  expect(screen.queryByTestId("cockpit-problems-empty")).toBeNull();
  expect(await screen.findByTestId("cockpit-problems-empty", {}, { timeout: 3000 })).toHaveTextContent("Alles im Plan");
  expect(screen.queryByTestId("cockpit-problem-rm-m1")).toBeNull();
});
