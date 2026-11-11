import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Vorgabe der Woche im Veto-Block der Matchseite (#2326): schon vor dem Veto sichtbar, im Brett als feste Map, in der Spielreihenfolge
// an ihrer Position - und ein klarer Satz, solange sie fehlt. Erfundene Namen.

const apiMock = { post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const { VetoPanel } = await import("./VetoPanel");

const SIDES = ["Löwen · Rudel A", "Falken · Horst"];
const PRESETS = [{ mode: "ctl", mode_label: "Kontrolle", position: 3, map_id: "kai", map_name: "Kai", map_image_url: null }];
const WAITING = {
  status: "waiting", skipped_reason: null, version: 0, step_seconds: null, team_a: null, team_b: null, current: null, own_turn: false, can_pick: false,
  pick_hint: "Das Veto beginnt erst, wenn beide Seiten eingecheckt sind.", options: [], remaining: [], history: [], planned_games: [], paused: null, lead: null,
  week: 1, presets: PRESETS, blocked: null, start: null,
};
const BLOCKED_TEXT = "Für Spielwoche 2 steht die Vorgabe der Woche noch nicht – Kontrolle: Die Vorgabe der Woche fehlt. Das Veto beginnt erst, wenn die Liga-Leitung sie eingetragen hat.";
const RUNNING = {
  ...WAITING, status: "running", version: 3, step_seconds: 60, team_a: { registration_id: "a", name: SIDES[0], via: "home" }, team_b: { registration_id: "b", name: SIDES[1] },
  current: { index: 2, number: 3, total: 4, kind: "ban", mode: "ctl", mode_label: "Kontrolle", registration_id: "a", name: SIDES[0], position: null,
    deadline_at: new Date(Date.now() + 40000).toISOString(), remaining_seconds: 40 },
  own_turn: true, can_pick: true, pick_hint: null,
  options: [{ map_id: "hafen", name: "Hafen", image_url: null, allowed: true, hint: null },
    { map_id: "kai", name: "Kai", image_url: null, allowed: false, hint: "Kai ist die Vorgabe der Woche – weder sperrbar noch wählbar." }],
  remaining: [{ mode: "ctl", label: "Kontrolle", maps: [
    { map_id: "hafen", name: "Hafen", image_url: null, status: "open", by_name: null, position: null },
    { map_id: "kai", name: "Kai", image_url: null, status: "preset", by_name: null, position: 3 }] }],
};

function panel(block, props = {}) {
  return <VetoPanel block={block} matchId="m1" busy={false} run={async () => true} onChanged={async () => {}} {...props} />;
}

test("vor dem Veto: die Vorgabe der Woche steht schon da - ohne Vorgabe in der Vorlage bleibt der Block weg", () => {
  const { rerender } = render(panel(WAITING));
  expect(screen.getByTestId("veto-panel")).toHaveAttribute("data-blocked", "false");
  expect(screen.getByTestId("veto-headline")).toHaveTextContent("Vorgabe der Woche");
  expect(screen.getByTestId("veto-presets")).toHaveTextContent("Vorgabe der Woche · Spielwoche 1");
  expect(screen.getByTestId("veto-preset-ctl")).toHaveTextContent("Kai");
  expect(screen.getByTestId("veto-preset-ctl")).toHaveTextContent("Kontrolle · Map 3");
  expect(screen.getByTestId("veto-presets")).toHaveTextContent("nicht sperrbar und nicht wählbar");
  expect(screen.queryByTestId("veto-blocked")).toBeNull();
  // Gegenprobe: eine Vorlage ohne Vorgabe zeigt vor dem Check-in wie bisher nichts.
  rerender(panel({ ...WAITING, week: null, presets: [] }));
  expect(screen.queryByTestId("veto-panel")).toBeNull();
});

test("fehlt die Vorgabe, sagt der Block es klar und fragt weiter nach - gewertet wird nichts", () => {
  vi.useFakeTimers();
  const onPoll = vi.fn();
  const waitingForPreset = { ...WAITING, week: 2, presets: [], blocked: { week: 2, text: BLOCKED_TEXT }, pick_hint: BLOCKED_TEXT };
  const { rerender } = render(panel(waitingForPreset, { onPoll, bothIn: true }));
  expect(screen.getByTestId("veto-panel")).toHaveAttribute("data-blocked", "true");
  expect(screen.getByTestId("veto-headline")).toHaveTextContent("Veto wartet auf die Vorgabe der Woche");
  expect(screen.getByTestId("veto-text")).toHaveTextContent(BLOCKED_TEXT);
  expect(screen.getByTestId("veto-blocked")).toHaveTextContent("Gewertet wird nichts von selbst.");
  expect(screen.getByTestId("veto-blocked")).toHaveTextContent("startet das Veto hier selbst");
  expect(screen.queryByTestId("veto-start")).toBeNull();
  expect(screen.queryByTestId("veto-presets")).toBeNull();
  vi.advanceTimersByTime(6500);
  expect(onPoll).toHaveBeenCalledTimes(2);
  // Gegenprobe: vor dem Check-in beider Seiten gibt es nichts abzuwarten, und mit Vorgabe wartet der Block still - kein Nachfragen.
  onPoll.mockClear();
  rerender(panel(waitingForPreset, { onPoll, bothIn: false }));
  expect(screen.getByTestId("veto-blocked")).toBeInTheDocument();
  vi.advanceTimersByTime(6500);
  rerender(panel(WAITING, { onPoll, bothIn: true }));
  vi.advanceTimersByTime(6500);
  expect(onPoll).not.toHaveBeenCalled();
  vi.useRealTimers();
});

test("nachgetragene Vorgabe: „Veto starten“ beginnt das Veto erst auf Knopfdruck - nur für die Seiten, ohne Frist davor", async () => {
  vi.useFakeTimers();
  const onPoll = vi.fn();
  const onChanged = vi.fn(async () => {});
  apiMock.post.mockResolvedValue({ data: { version: 1, status: "running", idempotent_replay: false } });
  const ready = { ...WAITING, step_seconds: 60, pick_hint: "Die Vorgabe der Woche steht.", start: { can_start: true, hint: null } };
  const run = async (task) => { await task(); return true; };
  const { rerender } = render(<VetoPanel block={ready} matchId="m1" busy={false} run={run} onChanged={onChanged} onPoll={onPoll} bothIn />);
  expect(screen.getByTestId("veto-panel")).toHaveAttribute("data-start-ready", "true");
  expect(screen.getByTestId("veto-headline")).toHaveTextContent("Vorgabe steht – Veto starten");
  expect(screen.getByTestId("veto-text")).toHaveTextContent("Tippt auf „Veto starten“, sobald beide Teams bereit sind.");
  expect(screen.getByTestId("veto-start")).toHaveTextContent("Erst ab dem Start läuft die Zeit (60 Sekunden je Schritt). Bis dahin läuft keine Frist");
  expect(screen.getByTestId("veto-presets")).toHaveTextContent("Kai");
  expect(screen.queryByTestId("veto-countdown")).toBeNull();
  expect(screen.queryByTestId("veto-blocked")).toBeNull();
  // Startet die Gegenseite, zeigt die Seite es von selbst.
  vi.advanceTimersByTime(6500);
  expect(onPoll).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
  fireEvent.click(screen.getByTestId("veto-start-button"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/matches/m1/veto/start", {}));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  // Gegenprobe: Wer keine Seite vertritt (Leitung), sieht den Stand, aber keinen Knopf - und ohne Merker gibt es ihn gar nicht.
  rerender(<VetoPanel block={{ ...ready, start: { can_start: false, hint: "Captain oder Vertreter einer Seite tippt auf „Veto starten“." } }} matchId="m1" busy={false} run={run} onChanged={onChanged} />);
  expect(screen.getByTestId("veto-headline")).toHaveTextContent("Vorgabe steht – Veto starten");
  expect(screen.getByTestId("veto-text")).toHaveTextContent("Captain oder Vertreter einer Seite startet das Veto.");
  expect(screen.queryByTestId("veto-start-button")).toBeNull();
  rerender(<VetoPanel block={WAITING} matchId="m1" busy={false} run={run} onChanged={onChanged} />);
  expect(screen.getByTestId("veto-headline")).toHaveTextContent("Vorgabe der Woche");
  expect(screen.queryByTestId("veto-start")).toBeNull();
});

test("im Veto: die vorgegebene Map steht fest im Brett und lässt sich nicht antippen", () => {
  render(panel(RUNNING));
  expect(screen.getByTestId("veto-presets")).toHaveTextContent("Kai");
  expect(screen.getByTestId("veto-map-ctl-kai")).toHaveAttribute("data-status", "preset");
  expect(screen.getByTestId("veto-map-ctl-kai")).toHaveTextContent("Map 3 · Vorgabe der Woche");
  expect(screen.getByTestId("veto-map-ctl-hafen")).toHaveAttribute("data-status", "open");
  expect(screen.getByTestId("veto-option-kai")).toBeDisabled();
  expect(screen.getByTestId("veto-option-kai")).toHaveAttribute("title", "Kai ist die Vorgabe der Woche – weder sperrbar noch wählbar.");
  expect(screen.getByTestId("veto-option-hafen")).not.toBeDisabled();
});

test("fertig: die Vorgabe steht an ihrer Position in der Spielreihenfolge und im Verlauf", () => {
  const done = { ...RUNNING, status: "done", current: null, own_turn: false, can_pick: false, options: [],
    planned_games: [
      { position: 1, mode: "hp", mode_label: "Stellung", map_id: "nebel", map_name: "Nebel", map_image_url: null, role: "picked", by_registration_id: "a" },
      { position: 3, mode: "ctl", mode_label: "Kontrolle", map_id: "kai", map_name: "Kai", map_image_url: null, role: "preset", by_registration_id: null },
    ],
    history: [{ index: 3, kind: "preset", mode_label: "Kontrolle", name: null, map_name: "Kai", position: 3, via: "auto", at: "x" }] };
  render(panel(done));
  expect(screen.getByTestId("veto-planned-3")).toHaveTextContent("Map 3 · Vorgabe der Woche");
  expect(screen.getByTestId("veto-planned-3")).toHaveTextContent("Kai");
  expect(screen.getByTestId("veto-planned-1")).not.toHaveTextContent("Vorgabe");
  expect(screen.getByTestId("veto-history-3")).toHaveTextContent("4. Vorgabe der Woche: Kai → Map 3 (Kontrolle)");
  expect(screen.queryByTestId("veto-presets")).toBeNull();
});
