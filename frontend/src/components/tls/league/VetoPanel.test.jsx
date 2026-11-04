import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Map-Veto auf der Matchseite (#1618): am Zug mit Countdown und Wahl, Gegenseite wartet, Decider vom System, Pause mit Grund, Eingriff
// der Leitung nur mit Grund, fertig mit Spielreihenfolge und Verlauf. Erfundene Namen.

const apiMock = { post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { VetoPanel } = await import("./VetoPanel");

const SIDES = ["Löwen · Rudel A", "Falken · Horst"];
const MAP = (map_id, name, status = "open", extra = {}) => ({ map_id, name, image_url: null, status, by_name: null, position: null, ...extra });
const REMAINING = [
  { mode: "hp", label: "Stellung", maps: [MAP("hafen", "Hafen", "banned", { by_name: SIDES[1] }), MAP("nebel", "Nebel"), MAP("turm", "Turm")] },
  { mode: "snd", label: "Suchen", maps: [MAP("kai", "Kai"), MAP("werk", "Werk")] },
];
const CURRENT = { index: 1, number: 2, total: 5, kind: "pick", mode: "hp", mode_label: "Stellung", registration_id: "a", name: SIDES[0], position: 1,
  deadline_at: new Date(Date.now() + 40000).toISOString(), remaining_seconds: 40 };
const RUNNING = {
  status: "running", skipped_reason: null, version: 2, step_seconds: 60, team_a: { registration_id: "b", name: SIDES[1], via: "home" },
  team_b: { registration_id: "a", name: SIDES[0] }, current: CURRENT, own_turn: true, can_pick: true, pick_hint: null,
  options: [{ map_id: "hafen", name: "Hafen", image_url: null, allowed: false, hint: "Hafen ist in diesem Modus schon gesperrt oder gewählt." },
    { map_id: "nebel", name: "Nebel", image_url: null, allowed: true, hint: null }, { map_id: "turm", name: "Turm", image_url: null, allowed: true, hint: null }],
  remaining: REMAINING, history: [{ index: 0, kind: "ban", mode_label: "Stellung", name: SIDES[1], map_name: "Hafen", position: null, via: "side", at: "2026-11-15T19:00:00Z" }],
  planned_games: [], paused: null, lead: null,
};

function renderPanel(block, props = {}) {
  const run = async (task) => { await task(); return true; };
  return render(<VetoPanel block={block} matchId="m1" busy={false} run={run} onChanged={async () => {}} {...props} />);
}

beforeEach(() => {
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValue({ data: { version: 3, step: 2, status: "running", idempotent_replay: false } });
});

test("am Zug: Satz, Schritt, Countdown, Maps je Modus mit Stand - die Wahl geht mit Version an den Server", async () => {
  renderPanel(RUNNING);
  expect(screen.getByTestId("veto-headline")).toHaveTextContent("Veto läuft");
  expect(screen.getByTestId("veto-text")).toHaveTextContent("Ihr seid am Zug: wählt Map 1 (Stellung). Nach 60 Sekunden wählt das System.");
  expect(screen.getByTestId("veto-step")).toHaveTextContent("Schritt 2 von 5 · Stellung · Löwen · Rudel A wählt Map 1");
  expect(screen.getByTestId("veto-teams")).toHaveTextContent("Team A: Falken · Horst (Heim)");
  expect(screen.getByTestId("veto-countdown-text")).toHaveTextContent(/^\d+:\d\d$/);
  expect(screen.getByTestId("veto-map-hp-hafen")).toHaveAttribute("data-status", "banned");
  expect(screen.getByTestId("veto-map-hp-hafen")).toHaveTextContent("gesperrt von Falken · Horst");
  expect(screen.getByTestId("veto-option-hafen")).toBeDisabled();
  expect(screen.getByTestId("veto-options-hint")).toBeInTheDocument();
  expect(screen.getByTestId("veto-history-0")).toHaveTextContent("1. Falken · Horst sperrt Hafen (Stellung)");
  expect(screen.queryByTestId("veto-lead")).toBeNull();
  fireEvent.click(screen.getByTestId("veto-option-nebel"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/veto/pick", { map_id: "nebel", version: 2 }));
});

test("Gegenseite wartet, Decider vom System, Pause mit Grund, kein Veto, vor dem Check-in nichts", () => {
  const waiting = { ...RUNNING, own_turn: false, can_pick: false, pick_hint: `Jetzt ist ${SIDES[0]} am Zug.` };
  const { rerender } = renderPanel(waiting);
  expect(screen.getByTestId("veto-panel")).toHaveAttribute("data-own-turn", "false");
  expect(screen.queryByTestId("veto-own")).toBeNull();
  expect(screen.getByTestId("veto-wait")).toHaveTextContent("am Zug");
  rerender(<VetoPanel block={{ ...waiting, current: { ...CURRENT, kind: "decider", registration_id: null, name: null, position: 3 }, pick_hint: "Die übrige Map setzt das System." }} matchId="m1" busy={false} run={async () => true} onChanged={async () => {}} />);
  expect(screen.getByTestId("veto-text")).toHaveTextContent("Die übrige Map wird Map 3 – das setzt das System.");
  rerender(<VetoPanel block={{ ...waiting, status: "paused", current: { ...CURRENT, deadline_at: null, remaining_seconds: 17 }, paused: { at: "2026-11-15T19:01:00Z", reason: "Störung bei einem Team", remaining_seconds: 17 } }} matchId="m1" busy={false} run={async () => true} onChanged={async () => {}} />);
  expect(screen.getByTestId("veto-headline")).toHaveTextContent("Veto pausiert");
  expect(screen.getByTestId("veto-paused")).toHaveTextContent("Störung bei einem Team");
  expect(screen.getByTestId("veto-countdown")).toHaveAttribute("data-paused", "true");
  expect(screen.getByTestId("veto-countdown-text")).toHaveTextContent("0:17");
  rerender(<VetoPanel block={{ ...waiting, status: "skipped", current: null, skipped_reason: "Position 4 gibt es bei Best of 3 nicht.", pick_hint: "In diesem Spiel läuft kein Veto: Position 4 gibt es bei Best of 3 nicht." }} matchId="m1" busy={false} run={async () => true} onChanged={async () => {}} />);
  expect(screen.getByTestId("veto-headline")).toHaveTextContent("Kein Veto in diesem Spiel");
  expect(screen.getByTestId("veto-skipped")).toBeInTheDocument();
  rerender(<VetoPanel block={{ ...waiting, status: "waiting" }} matchId="m1" busy={false} run={async () => true} onChanged={async () => {}} />);
  expect(screen.queryByTestId("veto-panel")).toBeNull();
  rerender(<VetoPanel block={null} matchId="m1" busy={false} run={async () => true} onChanged={async () => {}} />);
  expect(screen.queryByTestId("veto-panel")).toBeNull();
});

test("Leitung: Eingriff nur mit Grund, befangen als Superadmin nur mit Notausnahme", async () => {
  const lead = { ...RUNNING, own_turn: false, can_pick: false, pick_hint: `Jetzt ist ${SIDES[0]} am Zug.`, lead: { can_act: true, conflict: null } };
  const { rerender } = renderPanel(lead);
  expect(screen.getByTestId("veto-lead-pause")).toBeInTheDocument();
  expect(screen.queryByTestId("veto-lead-resume")).toBeNull();
  fireEvent.click(screen.getByTestId("veto-lead-undo"));
  expect(screen.getByTestId("veto-lead-problem")).toHaveTextContent("Grund");
  expect(apiMock.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("veto-lead-reason"), { target: { value: "Falsche Map angetippt, beide einig" } });
  fireEvent.click(screen.getByTestId("veto-lead-undo"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/veto/lead", { action: "undo", reason: "Falsche Map angetippt, beide einig", version: 2 }));
  apiMock.post.mockClear();
  rerender(<VetoPanel block={{ ...lead, status: "paused", paused: { at: "x", reason: "Pause", remaining_seconds: 5 }, lead: { can_act: true, conflict: { kind: "involved", override: true } } }} matchId="m1" busy={false} run={async (task) => { await task(); return true; }} onChanged={async () => {}} />);
  expect(screen.getByTestId("veto-lead-conflict")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("veto-lead-reason"), { target: { value: "Störung behoben" } });
  fireEvent.click(screen.getByTestId("veto-lead-resume"));
  expect(screen.getByTestId("veto-lead-problem")).toHaveTextContent("Notausnahme");
  fireEvent.change(screen.getByTestId("veto-lead-conflict-reason"), { target: { value: "Niemand sonst erreichbar" } });
  fireEvent.click(screen.getByTestId("veto-lead-resume"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/veto/lead", { action: "resume", reason: "Störung behoben", version: 2, conflict_reason: "Niemand sonst erreichbar" }));
});

test("fertig: die Spielreihenfolge mit Decider, der Verlauf eingeklappt, kein Polling mehr", () => {
  vi.useFakeTimers();
  const onPoll = vi.fn();
  const done = { ...RUNNING, status: "done", current: null, own_turn: false, can_pick: false, pick_hint: "Das Veto ist abgeschlossen.", options: [],
    planned_games: [
      { position: 1, mode: "hp", mode_label: "Stellung", map_id: "nebel", map_name: "Nebel", map_image_url: null, role: "picked", by_registration_id: "a" },
      { position: 2, mode: "snd", mode_label: "Suchen", map_id: "kai", map_name: "Kai", map_image_url: null, role: "picked", by_registration_id: "b" },
      { position: 3, mode: "hp", mode_label: "Stellung", map_id: "turm", map_name: "Turm", map_image_url: null, role: "decider", by_registration_id: null },
    ],
    history: [...RUNNING.history, { index: 4, kind: "decider", mode_label: "Stellung", name: null, map_name: "Turm", position: 3, via: "auto", at: "x" }] };
  renderPanel(done, { onPoll });
  expect(screen.getByTestId("veto-headline")).toHaveTextContent("Spielreihenfolge steht");
  expect(screen.getByTestId("veto-planned").children).toHaveLength(3);
  expect(screen.getByTestId("veto-planned-3")).toHaveTextContent("Map 3 · Decider");
  expect(screen.getByTestId("veto-planned-3")).toHaveTextContent("Turm");
  expect(screen.getByTestId("veto-history")).not.toHaveAttribute("open");
  expect(screen.getByTestId("veto-history-4")).toHaveTextContent("5. Decider: Turm → Map 3 (Stellung)");
  expect(screen.queryByTestId("veto-board")).toBeNull();
  vi.advanceTimersByTime(7000);
  expect(onPoll).not.toHaveBeenCalled();
  vi.useRealTimers();
});

test("solange das Veto läuft, fragt die Seite alle drei Sekunden nach", () => {
  vi.useFakeTimers();
  const onPoll = vi.fn();
  renderPanel(RUNNING, { onPoll });
  vi.advanceTimersByTime(6500);
  expect(onPoll).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
