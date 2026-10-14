import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import fixture from "../../../../../e2e/fixtures/matchplanGenerated.json";
import { buildTimeline, timeScale } from "@/lib/matchTimeline";
import { viennaTime } from "@/lib/vienna";

// Matchplan-Seite (#1557): Einstellungen, „Wer wartet auf wen“, Zeitleiste je Station, Reihenfolge - „Automatisch
// planen“ mit Vorschau und „Übernehmen“, Ziehen und Tastatur, live mit Verzug, online und Liga ohne Stationen.
// Alle Daten aus echten Planer-Antworten (scripts/make_matchplan_fixture.py).

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({
  API: "http://test.local/api",
  api: apiMock,
  formatRequestError: (error, fallback) => error?.response?.data?.detail || fallback,
}));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => true }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const { MatchPlanPanel } = await import("./MatchPlanPanel");
const { PX_PER_MINUTE } = await import("./StationTimeline");

const MINUTE = 60_000;
const hm = (ms) => viennaTime(ms, { hour: "2-digit", minute: "2-digit" });

function conflict(detail) {
  return Object.assign(new Error("409"), { response: { status: 409, data: { detail } } });
}

function setup(state, { plan = state.plan, now = fixture.generated_at, extra = {}, lead = true } = {}) {
  apiMock.get.mockImplementation((url) => {
    if (String(url).includes("/schedule/deadlines")) return Promise.resolve({ data: state.deadlines || { matches: [] } });
    if (String(url).includes("/matchdays")) return Promise.resolve({ data: state.matchdays || { applies: false, matchdays: [] } });
    return Promise.resolve({ data: [] });
  });
  apiMock.post.mockImplementation((url) => (String(url).includes("/schedule/plan") ? Promise.resolve({ data: plan }) : Promise.resolve({ data: {} })));
  apiMock.patch.mockResolvedValue({ data: {} });
  const onChanged = vi.fn();
  const view = render(
    <MemoryRouter>
    <MatchPlanPanel
      tournament={state.tournament}
      matches={state.matches}
      stages={state.stages}
      stations={state.stations}
      registrations={state.registrations}
      durationGame={state.duration_game}
      canEditSettings={lead}
      onChanged={onChanged}
      now={new Date(now)}
      {...extra}
    />
    </MemoryRouter>,
  );
  return { ...view, onChanged };
}

const bar = (key) => screen.getByTestId(`mp-bar-${key}`);

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.post.mockReset();
  apiMock.patch.mockReset();
});

describe("vor Ort: Aufbau der Seite", () => {
  it("oben die Einstellungen mit Start, Mindestpause, Puffer, Spieldauer vom Spiel und den Stationen", async () => {
    setup(fixture.local.applied);
    const settings = screen.getByTestId("mp-settings");
    expect(within(settings).getByLabelText("Mindestpause zwischen zwei Spielen (Min.)")).toHaveValue(5);
    expect(within(settings).getByLabelText("Puffer je Spiel (Min.)")).toHaveValue(8);
    expect(settings).toHaveTextContent("vom Spiel: 12 Min. (Grand Prix (4 Rennen)) + 8 Min. Puffer");
    const chips = within(settings).getAllByRole("listitem").map((chip) => chip.firstChild.textContent);
    expect(chips).toEqual(["Switch 1", "Switch 2"]);
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(`/tournaments/${fixture.local.applied.tournament.id}/schedule/plan`));
  });

  it("Einstellungen speichern über das Turnier - Puffer und Mindestpause als Zahl", async () => {
    const user = userEvent.setup();
    setup(fixture.local.applied);
    const field = screen.getByLabelText("Puffer je Spiel (Min.)");
    await user.clear(field);
    await user.type(field, "10");
    await user.click(screen.getByRole("button", { name: "Einstellungen speichern" }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith(`/tournaments/${fixture.local.applied.tournament.id}`,
      expect.objectContaining({ match_buffer_minutes: 10, match_break_minutes: 5 })));
  });

  it("Turnierstart in Wiener Uhr - egal, wo das Gerät steht; die doppelte Stunde am 25.10. meint die erste", async () => {
    // Das Gerät steht in New York (Node übernimmt die Zone zur Laufzeit): Feld und Speichern bleiben Wiener Uhr.
    const zone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      expect(new Date("2026-10-31T16:30:00Z").getHours()).toBe(12);
      const user = userEvent.setup();
      const state = fixture.local.applied;
      setup({ ...state, tournament: { ...state.tournament, start_date: "2026-10-31T16:30:00+00:00" } });
      const field = screen.getByLabelText("Turnierstart");
      expect(field).toHaveValue("2026-10-31T17:30");
      fireEvent.change(field, { target: { value: "2026-10-25T02:30" } });
      await user.click(screen.getByRole("button", { name: "Einstellungen speichern" }));
      await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith(`/tournaments/${state.tournament.id}`,
        expect.objectContaining({ start_date: "2026-10-25T00:30:00.000Z" })));
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it("ohne Recht auf Turnier-Einstellungen stehen die Werte nur da", () => {
    setup(fixture.local.applied, { lead: false });
    expect(screen.queryByRole("button", { name: "Einstellungen speichern" })).toBeNull();
    expect(screen.getByTestId("mp-settings")).toHaveTextContent("Puffer je Spiel8 Min.");
  });

  it("„Wer wartet auf wen“: ein Knoten je Spiel, antippen zeigt Vorspiele und Folgespiele", async () => {
    const user = userEvent.setup();
    setup(fixture.local.applied);
    const flow = screen.getByTestId("mp-flow");
    expect(within(flow).getAllByRole("button")).toHaveLength(14);
    await user.click(within(flow).getByRole("button", { name: /^E,/ }));
    const detail = screen.getByTestId("mp-flow-detail");
    expect(detail).toHaveTextContent("Braucht: A");
    expect(detail).toHaveTextContent("Danach warten: G, LC");
  });

  it("Zeitleiste: je Station eine Bahn, Balken an Zeit und Dauer", () => {
    const state = fixture.local.applied;
    setup(state);
    const lanes = screen.getAllByTestId(/^mp-lane-/);
    expect(lanes.map((lane) => lane.getAttribute("data-name"))).toEqual(["Switch 1", "Switch 2"]);
    const timeline = buildTimeline({ matches: state.matches, stations: state.stations, stages: state.stages, tournament: state.tournament,
      game: state.duration_game, registrations: state.registrations, now: new Date(fixture.generated_at) });
    const scale = timeScale(timeline.range, PX_PER_MINUTE);
    const a = timeline.items.find((item) => item.key === "A");
    expect(bar("A").style.transform).toBe(`translate3d(${scale.x(a.start)}px, 0, 0)`);
    expect(bar("A").style.width).toBe(`${scale.width(a)}px`);
    expect(bar("A")).toHaveAttribute("data-tone", "wb");
    expect(bar("LA")).toHaveAttribute("data-tone", "lb");
    expect(bar("FINAL")).toHaveAttribute("data-tone", "final");
  });

  it("Reihenfolge als Liste: nach Zeit, mit Station und Dauer", () => {
    setup(fixture.local.applied);
    const rows = within(screen.getByTestId("mp-order")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(14);
    expect(rows[0]).toHaveTextContent("20 Min.");
    expect(rows.at(-1)).toHaveTextContent("FINAL");
  });
});

// Praxis-Fehler nach #1589: Ein Turnier vor Ort, dessen Baum noch Vorschau ist, bekam vom Planer „none“ - die Seite
// sprang auf „online“ und war leer. „none“ heißt „nichts neu zu planen“, nicht „online“; vorhandene Spiele stehen da.
describe("Ansicht springt nicht und bleibt nie leer", () => {
  it("Baum noch Vorschau, Planer meldet „none“: bleibt vor Ort, zeigt alle Spiele und warum noch nicht geplant wird", async () => {
    const state = fixture.draft;
    expect(state.plan.mode).toBe("none");
    setup(state);
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(`/tournaments/${state.tournament.id}/schedule/plan`));
    await act(async () => {});
    expect(screen.queryByTestId("mp-online")).toBeNull();
    expect(screen.queryByTestId("mp-league")).toBeNull();
    expect(screen.getByLabelText("Puffer je Spiel (Min.)")).toBeInTheDocument();
    expect(within(screen.getByTestId("mp-flow")).getAllByRole("button")).toHaveLength(14);
    const rows = within(screen.getByTestId("mp-order")).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(14);
    expect(rows[0]).toHaveTextContent("noch ohne Zeit");
    expect(screen.getByTestId("mp-plan-note")).toHaveTextContent("Turnierbaum ist noch eine Vorschau");
  });

  it("scheitert die Anfrage an den Planer, steht eine Meldung da - die gespeicherten Spiele bleiben sichtbar", async () => {
    const state = fixture.local.applied;
    apiMock.get.mockResolvedValue({ data: [] });
    apiMock.post.mockRejectedValue(Object.assign(new Error("403"), { response: { status: 403, data: { detail: "Keine Turnierberechtigung für diese Aktion" } } }));
    apiMock.patch.mockResolvedValue({ data: {} });
    render(
      <MemoryRouter>
        <MatchPlanPanel tournament={state.tournament} matches={state.matches} stages={state.stages} stations={state.stations}
          registrations={state.registrations} durationGame={state.duration_game} now={new Date(fixture.generated_at)} />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("mp-plan-error")).toHaveTextContent("Keine Turnierberechtigung für diese Aktion");
    expect(bar("A")).toBeInTheDocument();
  });

  it("ohne Recht zum Planen fragt die Seite den Planer nicht, sagt es und zeigt trotzdem den Plan", () => {
    const state = fixture.local.applied;
    setup({ ...state, tournament: { ...state.tournament, can_assign_stations: false, can_plan_matches: false } });
    expect(apiMock.post).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Automatisch planen" })).toBeNull();
    expect(screen.getByTestId("mp-plan-note")).toHaveTextContent("Planen und Verschieben");
    expect(bar("A")).toBeInTheDocument();
    expect(bar("A")).not.toHaveAttribute("data-movable");
  });

  it("Fristen nicht ladbar: Meldung in der Online-Ansicht statt leerer Fläche", async () => {
    const state = fixture.online;
    apiMock.get.mockRejectedValue(new Error("weg"));
    apiMock.post.mockResolvedValue({ data: state.plan });
    render(
      <MemoryRouter>
        <MatchPlanPanel tournament={state.tournament} matches={state.matches} stages={state.stages} stations={state.stations}
          registrations={state.registrations} durationGame={state.duration_game} now={new Date(fixture.generated_at)} />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("mp-remote-error")).toHaveTextContent("Fristen");
  });
});

describe("Spiel ändern: Zeit, Station und eigene Dauer (ersetzt die alte Matchplanung im Reiter „Spiele“)", () => {
  it("ohne eigene Dauer steht da, woher sie kommt; Speichern schickt Wiener Zeit, Station und leer als null", async () => {
    const user = userEvent.setup();
    const state = fixture.local.applied;
    const a = state.matches.find((row) => row.match_key === "A");
    setup(state);
    await user.click(within(screen.getByTestId("mp-order")).getByRole("button", { name: "A ändern" }));
    const editor = screen.getByTestId("mp-editor");
    const duration = within(editor).getByLabelText("Eigene Dauer (Min.)");
    expect(duration).toHaveValue(null);
    expect(duration).toHaveAttribute("placeholder", "20");
    expect(editor).toHaveTextContent("Leer lassen: vom Spiel: 12 Min. (Grand Prix (4 Rennen)) + 8 Min. Puffer");
    fireEvent.change(within(editor).getByLabelText("Start"), { target: { value: "2026-10-31T17:05" } });
    await user.selectOptions(within(editor).getByLabelText("Station"), "Switch 2");
    await user.click(within(editor).getByRole("button", { name: "Speichern" }));
    const station = state.stations.find((row) => row.name === "Switch 2").id;
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith(`/matches/${a.id}`,
      { scheduled_at: "2026-10-31T16:05:00.000Z", station_id: station, duration_minutes: null }));
  });

  it("eine eigene Dauer steht im Feld und geht als Zahl an den Server; leerer Start löst den Termin", async () => {
    const user = userEvent.setup();
    const state = fixture.local.applied;
    const matches = state.matches.map((row) => (row.match_key === "A" ? { ...row, duration_minutes: 25 } : row));
    const a = matches.find((row) => row.match_key === "A");
    setup({ ...state, matches });
    await user.click(within(screen.getByTestId("mp-order")).getByRole("button", { name: "A ändern" }));
    const editor = screen.getByTestId("mp-editor");
    expect(within(editor).getByLabelText("Eigene Dauer (Min.)")).toHaveValue(25);
    fireEvent.change(within(editor).getByLabelText("Start"), { target: { value: "" } });
    await user.click(within(editor).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith(`/matches/${a.id}`,
      { scheduled_at: null, station_id: a.station_id, duration_minutes: 25 }));
  });

  it("Spiele eines Vorschau-Baums lassen sich nicht ändern", () => {
    setup(fixture.draft);
    expect(within(screen.getByTestId("mp-order")).queryByRole("button", { name: /ändern$/ })).toBeNull();
  });
});

describe("Automatisch planen: Vorschau und Übernehmen", () => {
  it("zeigt die Vorschau mit geänderten Spielen und schreibt erst nach „Übernehmen“ mit Fingerabdruck", async () => {
    const user = userEvent.setup();
    const state = fixture.local.preview;
    const { onChanged } = setup(state);
    await user.click(screen.getByRole("button", { name: "Automatisch planen" }));
    const preview = await screen.findByTestId("mp-preview");
    expect(preview).toHaveTextContent("14 Spiele bekommen Zeit und Station");
    expect(bar("E")).toHaveAttribute("data-changed", "true");
    expect(bar("E")).toHaveAttribute("data-forecast", "true");
    expect(apiMock.post.mock.calls.filter(([url]) => url.includes("/schedule/apply"))).toHaveLength(0);

    apiMock.post.mockImplementation((url) => (String(url).includes("/schedule/apply")
      ? Promise.resolve({ data: fixture.local.apply_response }) : Promise.resolve({ data: state.plan })));
    await user.click(within(preview).getByRole("button", { name: "Übernehmen" }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(`/tournaments/${state.tournament.id}/schedule/apply`,
      { fingerprint: state.plan.fingerprint, planned_at: state.plan.planned_at }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("mp-preview")).toBeNull());
  });

  it("409: sagt in Worten, dass sich der Plan geändert hat, und plant neu statt zu schreiben", async () => {
    const user = userEvent.setup();
    const state = fixture.local.preview;
    setup(state);
    await user.click(screen.getByRole("button", { name: "Automatisch planen" }));
    const preview = await screen.findByTestId("mp-preview");
    apiMock.post.mockImplementation((url) => (String(url).includes("/schedule/apply")
      ? Promise.reject(conflict(fixture.local.errors.stale_apply.detail)) : Promise.resolve({ data: state.plan })));
    const plansBefore = apiMock.post.mock.calls.filter(([url]) => url.includes("/schedule/plan")).length;
    await user.click(within(preview).getByRole("button", { name: "Übernehmen" }));
    expect(await screen.findByTestId("mp-preview-stale")).toHaveTextContent("Der Plan hat sich inzwischen geändert");
    await waitFor(() => expect(apiMock.post.mock.calls.filter(([url]) => url.includes("/schedule/plan")).length).toBe(plansBefore + 1));
    expect(screen.getByTestId("mp-preview")).toBeInTheDocument();
  });

  it("„Verwerfen“ schließt die Vorschau ohne zu schreiben", async () => {
    const user = userEvent.setup();
    setup(fixture.local.preview);
    await user.click(screen.getByRole("button", { name: "Automatisch planen" }));
    await user.click(within(await screen.findByTestId("mp-preview")).getByRole("button", { name: "Verwerfen" }));
    await waitFor(() => expect(screen.queryByTestId("mp-preview")).toBeNull());
    expect(apiMock.post.mock.calls.some(([url]) => url.includes("/schedule/apply"))).toBe(false);
  });
});

describe("Konflikte und feste Termine", () => {
  it("ein zu früh gesetzter fester Termin ist markiert und steht in Worten da", async () => {
    setup(fixture.local.conflict);
    await waitFor(() => expect(bar("E")).toHaveAttribute("data-conflict", "true"));
    expect(bar("E")).toHaveAttribute("data-fixed", "true");
    expect(screen.getByTestId("mp-warnings")).toHaveTextContent(/E ist fest um \d\d:\d\d, aber A ist erst um \d\d:\d\d vorbei\./);
    expect(screen.getByTestId("mp-lane-none")).toHaveAttribute("data-name", "Ohne Station");
  });

  it("„Termin lösen“ gibt einen festen Termin an den Planer zurück", async () => {
    const user = userEvent.setup();
    const { onChanged } = setup(fixture.local.conflict);
    const id = fixture.local.conflict.matches.find((row) => row.match_key === "E").id;
    await user.click(within(screen.getByTestId("mp-order")).getByRole("button", { name: "Termin von E lösen" }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith(`/matches/${id}`, { scheduled_at: null }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});

describe("Ziehen und Tastatur", () => {
  const state = fixture.local.applied;
  const timeline = buildTimeline({ matches: state.matches, stations: state.stations, stages: state.stages, tournament: state.tournament,
    game: state.duration_game, registrations: state.registrations, now: new Date(fixture.generated_at) });
  const item = (key) => timeline.items.find((row) => row.key === key);
  const other = (laneId) => timeline.lanes.find((lane) => lane.id !== laneId).id;

  it("Balken ziehen: Zeit in 5-Minuten-Schritten, Station nach Bahn - setzt einen festen Termin", async () => {
    const { onChanged } = setup(state);
    const b = item("B");
    const handle = bar("B");
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 100 + 9 * PX_PER_MINUTE, clientY: 100 + 64 * (b.laneId === timeline.lanes[0].id ? 1 : -1) });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 100 + 9 * PX_PER_MINUTE, clientY: 100 + 64 * (b.laneId === timeline.lanes[0].id ? 1 : -1) });
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith(`/matches/${b.id}`, {
      scheduled_at: new Date(b.start + 10 * MINUTE).toISOString(), station_id: other(b.laneId) }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("beim Ziehen auf ein belegtes Feld wird es sofort rot und nennt, wer im Weg ist", () => {
    setup(state);
    const a = item("A");
    const b = item("B");
    const handle = bar("B");
    const lanes = timeline.lanes.map((lane) => lane.id);
    const dy = (lanes.indexOf(a.laneId) - lanes.indexOf(b.laneId)) * 64;
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 300, clientY: 100 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 300 + ((a.start - b.start) / MINUTE) * PX_PER_MINUTE, clientY: 100 + dy });
    expect(screen.getByTestId("mp-ghost")).toHaveAttribute("data-blocked", "true");
    expect(screen.getByTestId("mp-drag-status")).toHaveTextContent("im Weg: A");
    fireEvent.keyDown(handle, { key: "Escape" });
    expect(screen.queryByTestId("mp-ghost")).toBeNull();
    expect(apiMock.patch).not.toHaveBeenCalled();
  });

  it("Tastatur: Enter nimmt auf, Pfeile verschieben (5 Min., Station), Enter legt ab", async () => {
    setup(state);
    const b = item("B");
    const handle = bar("B");
    handle.focus();
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(screen.getByTestId("mp-drag-status")).toHaveTextContent("aufgenommen");
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: b.laneId === timeline.lanes[0].id ? "ArrowDown" : "ArrowUp" });
    fireEvent.keyDown(handle, { key: "Enter" });
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith(`/matches/${b.id}`, {
      scheduled_at: new Date(b.start + 10 * MINUTE).toISOString(), station_id: other(b.laneId) }));
  });

  it("Escape bricht ab, nichts wird geschrieben", () => {
    setup(state);
    const handle = bar("B");
    handle.focus();
    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "Escape" });
    expect(screen.getByTestId("mp-drag-status")).toHaveTextContent("abgebrochen");
    expect(apiMock.patch).not.toHaveBeenCalled();
  });

  it("lehnt der Server ab (Station belegt), steht der Grund da und nichts verrutscht", async () => {
    setup(state);
    apiMock.patch.mockRejectedValueOnce(conflict(fixture.local.errors.station_taken.detail));
    const handle = bar("B");
    handle.focus();
    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(await screen.findByTestId("mp-drag-status")).toHaveTextContent("Station ist in diesem Zeitraum bereits belegt (A).");
  });
});

describe("live", () => {
  it("Verzug oben aus der Prognose des Planers, laufendes Spiel rot mit Spielzeit, erledigte grau", async () => {
    const state = fixture.live;
    setup(state, { now: state.now });
    const final = state.plan.assignments.find((row) => row.label === "FINAL");
    const minutes = Math.round((Date.parse(final.scheduled_at) - Date.parse(final.previous.scheduled_at)) / MINUTE);
    const banner = await screen.findByTestId("mp-delay");
    expect(banner).toHaveTextContent(`+${minutes} Min.`);
    expect(banner).toHaveTextContent(`FINAL jetzt ca. ${hm(Date.parse(final.scheduled_at))}`);
    expect(bar("C")).toHaveAttribute("data-state", "running");
    expect(bar("C")).toHaveTextContent(/läuft \d+ Min\./);
    expect(bar("A")).toHaveAttribute("data-state", "done");
    expect(screen.getByTestId("mp-now")).toBeInTheDocument();
  });

  it("live steht die Prognose des Planers auf der Zeitleiste: der Rest ist nachgerückt", async () => {
    const state = fixture.live;
    setup(state, { now: state.now });
    const d = state.plan.assignments.find((row) => row.label === "D");
    const timeline = buildTimeline({ matches: state.matches, stations: state.stations, stages: state.stages, tournament: state.tournament,
      game: state.duration_game, registrations: state.registrations, plan: state.plan, now: new Date(state.now) });
    const scale = timeScale(timeline.range, PX_PER_MINUTE);
    await waitFor(() => expect(bar("D").style.transform).toBe(`translate3d(${scale.x(Date.parse(d.scheduled_at))}px, 0, 0)`));
    expect(bar("D")).not.toHaveAttribute("data-changed");
    expect(screen.queryByTestId("mp-warnings")).toBeNull();
  });

  it("die Uhr läuft weiter: die Spielzeit zählt ohne neues Laden", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    try {
      const state = fixture.live;
      vi.setSystemTime(new Date(state.now));
      setup(state, { extra: { now: undefined } });
      const before = bar("C").textContent;
      act(() => { vi.advanceTimersByTime(5 * MINUTE); });
      expect(bar("C").textContent).not.toBe(before);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Handy: Liste je Station", () => {
  it("jede Station mit ihren Spielen in Reihenfolge, Spieler voll lesbar", () => {
    setup(fixture.local.applied);
    const agenda = screen.getByTestId("mp-agenda");
    const groups = within(agenda).getAllByRole("list");
    expect(groups).toHaveLength(2);
    expect(agenda).toHaveTextContent("NeonFalke");
  });
});

// Codex zu #1601: Online und Liga hatten nach dem Entfernen der alten Planung kein „ändern“ mehr, hybrid fiel ohne
// Antwort des Planers auf „vor Ort“, und Online-Vorschau-Spiele fehlten.
describe("online, Liga, hybrid: dieselben Regeln wie der Planer", () => {
  it("online: je Spiel „ändern“ mit Start und Dauer - ohne Station", async () => {
    const user = userEvent.setup();
    const state = fixture.online;
    setup(state);
    const online = await screen.findByTestId("mp-online");
    const open = state.matches.find((row) => !row.is_preview && !["completed", "forfeit", "bye"].includes(row.status));
    await user.click(within(online).getByRole("button", { name: `${open.match_key} ändern` }));
    const editor = within(online).getByTestId("mp-editor");
    expect(within(editor).queryByLabelText("Station")).toBeNull();
    fireEvent.change(within(editor).getByLabelText("Start"), { target: { value: "2026-11-02T20:15" } });
    fireEvent.change(within(editor).getByLabelText("Eigene Dauer (Min.)"), { target: { value: "40" } });
    await user.click(within(editor).getByRole("button", { name: "Speichern" }));
    await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith(`/matches/${open.id}`,
      { scheduled_at: "2026-11-02T19:15:00.000Z", duration_minutes: 40 }));
  });

  it("Liga: je Partie „ändern“ in der Spielwoche", async () => {
    const user = userEvent.setup();
    const state = fixture.league;
    setup(state);
    const league = await screen.findByTestId("mp-league");
    const entry = state.matchdays.matchdays[0].matches[0];
    const match = state.matches.find((row) => row.id === entry.match_id);
    await waitFor(() => expect(within(league).getByRole("button", { name: `${match.match_key} ändern` })).toBeInTheDocument());
    await user.click(within(league).getAllByRole("button", { name: `${match.match_key} ändern` })[0]);
    expect(within(league).getByTestId("mp-editor")).toBeInTheDocument();
  });

  it("ohne Recht auf Termine kein „ändern“ online", async () => {
    const state = fixture.online;
    setup({ ...state, tournament: { ...state.tournament, can_plan_matches: false, staff_scopes: [] } });
    const online = await screen.findByTestId("mp-online");
    expect(within(online).queryByRole("button", { name: /ändern$/ })).toBeNull();
  });

  it("online mit Vorschau-Baum: die Spiele stehen da, als Vorschau gekennzeichnet, ohne „ändern“", async () => {
    const state = fixture.online_draft;
    expect(state.matches.every((row) => row.is_preview)).toBe(true);
    setup(state);
    const online = await screen.findByTestId("mp-online");
    expect(online).not.toHaveTextContent("Noch keine Spiele");
    expect(within(online).getAllByText(/Vorschau/).length).toBeGreaterThan(0);
    expect(within(online).queryByRole("button", { name: /ändern$/ })).toBeNull();
    expect(within(online).getAllByRole("listitem")).toHaveLength(state.matches.length);
  });

  it("hybrid ohne Antwort des Planers: Online-Ansicht wie beim Planer, nicht die Stationen", () => {
    const state = fixture.online;
    setup({ ...state, tournament: { ...state.tournament, event_mode: "hybrid", can_assign_stations: false } });
    expect(screen.getByTestId("mp-online")).toBeInTheDocument();
    expect(screen.queryByTestId("mp-timeline")).toBeNull();
  });
});

describe("Praxis 14.10.: Stationen und Reihenfolge - eine Wahrheit für Kopf und Zeitleiste", () => {
  it("gelöschte Station: Kopf „Noch keine Station“, Bahn „Gelöschte Station“, Warnungen in Worten", async () => {
    const state = fixture.orphan;
    setup(state);
    await waitFor(() => expect(screen.getByTestId("mp-warnings")).toHaveTextContent("die es nicht mehr gibt"));
    expect(screen.getByTestId("mp-settings")).toHaveTextContent("Noch keine Station");
    expect(screen.getByTestId(`mp-lane-${state.deleted_station_id}`)).toHaveAttribute("data-name", "Gelöschte Station");
    expect(screen.getByTestId("mp-warnings")).toHaveTextContent(/LE ist fest um 19:10, aber LC ist erst um 20:00 vorbei\./);
    expect(bar("LE")).toHaveAttribute("data-conflict", "true");
  });

  it("auf die gelöschte Station lässt sich nichts ziehen - mit Grund, ohne Anfrage", async () => {
    const state = fixture.orphan;
    setup(state);
    await waitFor(() => expect(screen.getByTestId("mp-warnings")).toBeInTheDocument());
    const lanes = screen.getAllByTestId(/^mp-lane-/).map((lane) => lane.getAttribute("data-testid").replace("mp-lane-", ""));
    const handle = bar("LF");
    const dy = (lanes.indexOf(state.deleted_station_id) - lanes.indexOf("none")) * 64;
    fireEvent.pointerDown(handle, { pointerId: 1, button: 0, clientX: 200, clientY: 300 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200, clientY: 300 + dy });
    expect(screen.getByTestId("mp-ghost")).toHaveAttribute("data-blocked", "true");
    expect(screen.getByTestId("mp-drag-status")).toHaveTextContent("Diese Station gibt es nicht mehr");
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 200, clientY: 300 + dy });
    await act(async () => {});
    expect(apiMock.patch).not.toHaveBeenCalled();
  });

  it("die Stationen des Events stehen im Kopf und in der Auswahl beim Ändern", async () => {
    const user = userEvent.setup();
    const state = fixture.event_stations;
    const hall = state.plan.stations.find((row) => row.scope === "event");
    setup(state);
    await waitFor(() => expect(screen.getByTestId("mp-settings")).toHaveTextContent(hall.name));
    expect(screen.getByTestId("mp-settings")).toHaveTextContent("Event");
    const first = state.matches.find((row) => row.match_key === "A");
    expect(first).toBeTruthy();
    await user.click(within(screen.getByTestId("mp-order")).getAllByRole("button", { name: /ändern$/ })[0]);
    expect(within(screen.getByTestId("mp-editor")).getByRole("option", { name: new RegExp(hall.name) })).toBeInTheDocument();
  });
});

describe("online und Liga: keine Stationen, keine Zeitleiste je Station", () => {
  it("online: Runden mit Fristen je Spiel, ohne Stationsfelder", async () => {
    setup(fixture.online);
    expect(await screen.findByTestId("mp-online")).toBeInTheDocument();
    expect(screen.queryByTestId("mp-timeline")).toBeNull();
    expect(screen.queryByText("Stationen")).toBeNull();
    expect(screen.queryByLabelText("Puffer je Spiel (Min.)")).toBeNull();
    await waitFor(() => expect(screen.getByTestId("mp-online")).toHaveTextContent(/nicht erschienen ab \d\d:\d\d/));
  });

  it("Liga: Spielwochen mit Frist und geltendem Termin", async () => {
    setup(fixture.league);
    const weeks = await screen.findByTestId("mp-league");
    await waitFor(() => expect(within(weeks).getAllByTestId(/^mp-week-/)).toHaveLength(fixture.league.matchdays.matchdays.length));
    expect(weeks).toHaveTextContent("Spielwoche 1");
    expect(weeks).toHaveTextContent("Frist");
    expect(weeks).toHaveTextContent("Standardzeit");
    expect(screen.queryByTestId("mp-timeline")).toBeNull();
  });
});
