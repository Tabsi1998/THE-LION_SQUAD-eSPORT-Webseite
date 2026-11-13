import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Turnierleitung (#1156, #1160): erster Reiter „Braucht Aufmerksamkeit“ mit dem passenden Knopf je Fall, zweiter
// „Ergebnisse“. Namen sind erfunden.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API_BASE: "", formatApiError: (value) => value }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "s1" } }) }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/Breadcrumbs", () => ({ Breadcrumbs: () => null }));
const liveCalls = [];
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (load, resources, options) => { liveCalls.push(options); } }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const TournamentLeadPage = (await import("./TournamentLeadPage")).default;

const ENTRY = {
  id: "m8", label: "Halbfinale B", kind: "duel", best_of: 1, ranking_mode: "higher_score", allows_draw: false, has_result: false, result: [], advance: {},
  participants: [{ registration_id: "r3", name: "TurboTina" }, { registration_id: "r4", name: "Frostbiss" }], station_text: "PC 4",
  timing: { missing: true, overdue_minutes: 12 }, can_enter: true, status: "scheduled",
};

function renderLead(view) {
  apiMock.get.mockResolvedValue({ data: view });
  return render(
    <MemoryRouter initialEntries={["/tournaments/fc-cup/leitung"]}>
      <Routes><Route path="/tournaments/:slug/leitung" element={<TournamentLeadPage />} /></Routes>
    </MemoryRouter>,
  );
}

test("Braucht Aufmerksamkeit: jeder Fall mit seinem Knopf, „Eintragen“ öffnet das Ergebnis-Fenster", async () => {
  renderLead({
    tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup" }, matches: [ENTRY], recent: [], counts: { open: 1 },
    attention: [
      { id: "rm-m8", kind: "result_missing", title: "Ergebnis fehlt", action: "enter", match_id: "m8", station_text: "PC 4", label: "Halbfinale B", names: "TurboTina gegen Frostbiss", detail: "12 Min. über der Zeit" },
      { id: "st-sw2", kind: "station_broken", title: "Station defekt", action: "move", station_text: "Switch 2", label: "Durchgang 3", names: "4 Teilnehmer", detail: "1 Spiel wartet darauf", match_ids: ["m7"] },
    ],
    stations: [{ id: "sw3", name: "Switch 3", status: "free", busy: false }],
  });
  expect(await screen.findByTestId("lead-tab-attention")).toHaveTextContent("Braucht Aufmerksamkeit (2)");
  expect(screen.getByTestId("lead-case-rm-m8")).toHaveTextContent("12 Min. über der Zeit");
  expect(screen.getByTestId("lead-case-move-st-sw2")).toHaveTextContent("Umlegen");
  fireEvent.click(screen.getByTestId("lead-case-enter-rm-m8"));
  expect(await screen.findByTestId("result-window")).toBeInTheDocument();
});

test("ohne Fälle startet die Ansicht bei „Ergebnisse“", async () => {
  renderLead({ tournament: { id: "t1", title: "FC 26 Herbst-Cup" }, matches: [ENTRY], recent: [], attention: [], stations: [], counts: { open: 1, missing: 1 } });
  await waitFor(() => expect(screen.getByTestId("lead-row-m8")).toBeInTheDocument());
  expect(screen.getByTestId("lead-tab-results")).toHaveAttribute("aria-selected", "true");
});

test("„Nicht erschienen?“ (#1551): die Turnierleitung wählt die fehlende Seite oder verlängert", async () => {
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  const longName = "Aleksandra Wiśniewska-Kowalczyk 🦁 [LÖWEN-ESPORTS-AKADEMIE]";
  renderLead({
    tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup" }, matches: [ENTRY], recent: [], counts: { open: 1 }, stations: [],
    attention: [{
      id: "ns-m8", kind: "no_show", title: "Nicht erschienen?", action: "no_show", match_id: "m8", station_text: "PC 4",
      label: "Halbfinale B", names: `${longName} gegen Jo`, detail: "10 Min. ab Aufruf um – kampflos werten oder verlängern.",
      participants: [{ registration_id: "r3", name: longName }, { registration_id: "r4", name: "Jo" }],
    }],
  });
  const card = await screen.findByTestId("lead-case-ns-m8");
  expect(card).toHaveTextContent("10 Min. ab Aufruf um");
  expect(screen.getByTestId("lead-no-show-r3")).toHaveTextContent(`${longName} nicht erschienen`);
  fireEvent.click(screen.getByTestId("lead-no-show-r4"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/fc-cup/lead/no-show/m8", { action: "confirm", registration_id: "r4" }));
  fireEvent.click(screen.getByTestId("lead-no-show-extend-ns-m8"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/fc-cup/lead/no-show/m8", { action: "extend", minutes: 5 }));
});

test("„Nicht erschienen“ im Lauf (#1823): die Rückmeldung sagt, dass der Lauf offen bleibt - im Duell „kampflos“", async () => {
  const { toast } = await import("sonner");
  const heat = {
    id: "ns-h1", kind: "no_show", title: "Nicht erschienen?", action: "no_show", match_id: "h1", station_text: "Switch 1",
    label: "Lauf A", names: "4 Teilnehmer", detail: "10 Min. ab Aufruf um.",
    participants: ["r1", "r2", "r3", "r4"].map((id) => ({ registration_id: id, name: `Spieler ${id}` })),
  };
  apiMock.post.mockResolvedValueOnce({ data: { ok: true, status: "scheduled" } });
  renderLead({ tournament: { id: "t1", slug: "fc-cup", title: "Läufe-Cup" }, matches: [], recent: [], counts: {}, stations: [], attention: [heat] });
  fireEvent.click(await screen.findByTestId("lead-no-show-r2"));
  await waitFor(() => expect(toast.success).toHaveBeenLastCalledWith("Als nicht erschienen markiert – der Lauf bleibt offen."));
  apiMock.post.mockResolvedValueOnce({ data: { ok: true, status: "forfeit" } });
  fireEvent.click(await screen.findByTestId("lead-no-show-r3"));
  await waitFor(() => expect(toast.success).toHaveBeenLastCalledWith("Kampflos gewertet – beide Seiten bekommen Bescheid."));
});

test("Stationen (#1556): vor Ort die Warteschlange je Station - „Aufrufen“ und „Starten“ gehen über den Server; Einstieg ist das Cockpit (#1653)", async () => {
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  const next = { match_id: "QF2", label: "Viertelfinale", names: ["NeonFalke", "Jo"], ready: true, state: "queued", position: 1, forecast_at: "2026-10-31T16:40:00Z" };
  const queue = {
    applies: true, summary: null, operate: { all: true, station_ids: [] },
    stations: [{ id: "st2", name: "2", station_text: "Station 2 · Switch 2", status: "free", waiting: 1, running: null, next, after: null }],
  };
  const lead = { tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup", event_mode: "local" }, matches: [ENTRY], recent: [], attention: [], stations: [], counts: { open: 1 } };
  apiMock.get.mockImplementation(async (url) => ({ data: url.endsWith("/live-queue") ? queue : lead }));
  render(
    <MemoryRouter initialEntries={["/tournaments/fc-cup/leitung"]}>
      <Routes><Route path="/tournaments/:slug/leitung" element={<TournamentLeadPage />} /></Routes>
    </MemoryRouter>,
  );
  // Vor Ort startet die Seite im Cockpit (#1653) - die Stationen stehen dort mit denselben Knöpfen.
  await waitFor(() => expect(screen.getByTestId("lead-tab-cockpit")).toHaveAttribute("aria-selected", "true"));
  fireEvent.click(await screen.findByTestId("live-call-st2"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/fc-cup/live-queue/call", { station_id: "st2", match_id: "QF2" }));
  // Der Reiter „Stationen“ bleibt erreichbar.
  fireEvent.click(screen.getByTestId("lead-tab-stations"));
  expect(screen.getByTestId("lead-tab-stations")).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByTestId("lead-stations")).toBeInTheDocument();
});

// Stationen (#1162): Freigeben, Defekt und Umlegen gehen über die schmalen Wege der Warteschlange; ?reiter=stationen
// öffnet den Reiter direkt (Link aus /admin/stations). Nach „Defekt“ sagt die Rückmeldung, was mit dem Spiel passiert.
test("Stationen (#1162): Freigeben, Defekt und Umlegen - mit Hinweis auf „Umlegen“ nach „Defekt“", async () => {
  const { toast } = await import("sonner");
  const running = { match_id: "QF1", label: "Viertelfinale", names: ["NeonFalke", "Jo"], ready: true, state: "running", position: 0, started_at: "2026-10-31T16:00:00Z", duration_minutes: 30 };
  const queue = {
    applies: true, summary: null, operate: { all: true, station_ids: [] },
    stations: [
      { id: "st1", name: "1", station_text: "Station 1", status: "busy", waiting: 0, running, next: null, after: null },
      { id: "st2", name: "2", station_text: "Station 2", status: "free", waiting: 0, running: null, next: null, after: null },
    ],
  };
  const lead = { tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup" }, matches: [ENTRY], recent: [], attention: [{ id: "x", kind: "result_missing", match_id: "m8", title: "Ergebnis fehlt" }], stations: [], counts: { open: 1 } };
  apiMock.get.mockImplementation(async (url) => ({ data: url.endsWith("/live-queue") ? queue : lead }));
  apiMock.post.mockReset();
  render(
    <MemoryRouter initialEntries={["/tournaments/fc-cup/leitung?reiter=stationen"]}>
      <Routes><Route path="/tournaments/:slug/leitung" element={<TournamentLeadPage />} /></Routes>
    </MemoryRouter>,
  );
  // Trotz offener Fälle: der Link öffnet die Stationen.
  await waitFor(() => expect(screen.getByTestId("lead-tab-stations")).toHaveAttribute("aria-selected", "true"));

  apiMock.post.mockResolvedValueOnce({ data: { ok: true, idempotent_replay: false, holds: { match_id: "QF1", state: "running" } } });
  fireEvent.click(await screen.findByTestId("live-broken-st1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/fc-cup/live-queue/broken", { station_id: "st1", broken: true }));
  await waitFor(() => expect(toast.success).toHaveBeenLastCalledWith("Station 1 ist als defekt gemeldet. Das laufende Spiel steht noch dort – mit „Umlegen“ auf eine freie Station."));

  apiMock.post.mockResolvedValueOnce({ data: { ok: true, idempotent_replay: false, state: "running", to: "Station 2" } });
  fireEvent.click(screen.getByTestId("live-move-st1"));
  fireEvent.click(await screen.findByTestId("live-move-to-st1-st2"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/fc-cup/live-queue/move", { station_id: "st1", match_id: "QF1", to_station_id: "st2" }));
  await waitFor(() => expect(toast.success).toHaveBeenLastCalledWith("Von Station 1 an Station 2 umgelegt – die Uhr läuft weiter."));

  apiMock.post.mockResolvedValueOnce({ data: { ok: true, idempotent_replay: false, state: "running" } });
  fireEvent.click(await screen.findByTestId("live-release-st1"));
  fireEvent.click(await screen.findByTestId("live-release-yes-st1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/fc-cup/live-queue/release", { station_id: "st1", match_id: "QF1" }));
  await waitFor(() => expect(toast.success).toHaveBeenLastCalledWith("Station 1 ist frei – das Ergebnis trägst du unter „Ergebnisse“ ein."));

  // Zwei Leitungen zugleich: die zweite bekommt die Meldung des Servers.
  apiMock.post.mockRejectedValueOnce({ response: { status: 409, data: { detail: "Die Zielstation ist inzwischen belegt. Bitte neu laden." } } });
  fireEvent.click(screen.getByTestId("live-move-st1"));
  fireEvent.click(await screen.findByTestId("live-move-to-st1-st2"));
  await waitFor(() => expect(toast.error).toHaveBeenLastCalledWith("Die Zielstation ist inzwischen belegt. Bitte neu laden."));
});

test("„Alle freien Stationen aufrufen“ (#1162): nacheinander über den Aufruf-Weg, Absagen in der Rückmeldung", async () => {
  const { toast } = await import("sonner");
  const next = (id) => ({ match_id: id, label: "Viertelfinale", names: ["NeonFalke", "Jo"], ready: true, state: "queued", position: 1, forecast_at: "2026-10-31T16:40:00Z" });
  const queue = {
    applies: true, summary: null, operate: { all: true, station_ids: [] }, matches: {},
    stations: [
      { id: "st1", name: "1", station_text: "Station 1", status: "free", waiting: 1, running: null, next: next("QF1"), after: null },
      { id: "st2", name: "2", station_text: "Station 2", status: "free", waiting: 1, running: null, next: next("QF2"), after: null },
    ],
  };
  const lead = { tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup" }, matches: [ENTRY], recent: [], attention: [], stations: [], counts: { open: 1 } };
  apiMock.get.mockImplementation(async (url) => ({ data: url.endsWith("/live-queue") ? queue : lead }));
  apiMock.post.mockReset();
  apiMock.post.mockResolvedValueOnce({ data: { ok: true } }).mockRejectedValueOnce({ response: { status: 409, data: { detail: "Das Spiel ist schon an Station 3 aufgerufen." } } });
  render(
    <MemoryRouter initialEntries={["/tournaments/fc-cup/leitung?reiter=stationen"]}>
      <Routes><Route path="/tournaments/:slug/leitung" element={<TournamentLeadPage />} /></Routes>
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByTestId("live-call-all"));
  fireEvent.click(await screen.findByTestId("live-call-all-yes"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledTimes(2));
  expect(apiMock.post).toHaveBeenNthCalledWith(1, "/tournaments/fc-cup/live-queue/call", { station_id: "st1", match_id: "QF1" });
  expect(apiMock.post).toHaveBeenNthCalledWith(2, "/tournaments/fc-cup/live-queue/call", { station_id: "st2", match_id: "QF2" });
  await waitFor(() => expect(toast.success).toHaveBeenLastCalledWith("1 Station aufgerufen – die Spieler bekommen Bescheid."));
  expect(toast.error).toHaveBeenLastCalledWith("Station 2: Das Spiel ist schon an Station 3 aufgerufen.");
});

// Show-Auslosung (#1590): „Auslosung bereit · N Namen“ mit Topf, Restzeit bis zum automatischen Los und „Jetzt auslosen“.
test("Auslosung bereit: Topf mit Namen, Restzeit, „Jetzt auslosen“ nur mit Aufbau-Recht", async () => {
  // Die Browser-Uhr steht drei Minuten nach der Server-Uhr der Antwort - die Restzeit zählt von dort weiter.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T10:06:30+00:00"));
  apiMock.post.mockResolvedValue({ data: { ok: true } });
  const card = {
    id: "draw-WB:2", stage_id: "s1", stage_name: "K.-o.", group: "WB:2", label: "Runde 1", match_ids: ["m5", "m6"], match_keys: ["E", "F"],
    pot: ["NeonFalke", "Aleksandra Wiśniewska-Kowalczyk 🦁 [LÖWEN-ESPORTS-AKADEMIE]", "TurboTina", "Jo"], pot_size: 4,
    since: "2026-10-14T10:00:00+00:00", remind_minutes: 10, remind_at: "2026-10-14T10:10:00+00:00", due_at: "2026-10-14T10:20:00+00:00", can_draw: true,
  };
  renderLead({
    tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup" }, now: "2026-10-14T10:03:30+00:00", matches: [ENTRY], recent: [], counts: { open: 1 },
    attention: [], stations: [], draws: [card],
  });
  expect(await screen.findByTestId("lead-tab-attention")).toHaveTextContent("Braucht Aufmerksamkeit (1)");
  const shown = screen.getByTestId("lead-draw-WB:2");
  expect(shown).toHaveTextContent("Auslosung bereit · 4 Namen");
  expect(shown).toHaveTextContent("nach Runde 1 → E, F");
  expect(screen.getByTestId("lead-draw-pot-WB:2").querySelectorAll("li")).toHaveLength(4);
  expect(screen.getByTestId("lead-draw-countdown-WB:2")).toHaveTextContent("automatisch in 14 Min.");
  fireEvent.click(screen.getByTestId("lead-draw-now-WB:2"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/fc-cup/stages/s1/draw", { group: "WB:2" }));
  // Nach dem Auslosen lädt die Ansicht neu (die Warteschlange vor Ort fragt die Seite getrennt, #1556).
  await waitFor(() => expect(apiMock.get.mock.calls.filter(([url]) => String(url).endsWith("/lead"))).toHaveLength(2));
  vi.useRealTimers();
});

test("Auslosung bereit: die Zielrunde heißt wie im Baum (#1829)", async () => {
  const { drawTargetText } = await import("./TournamentLeadPage");
  expect(drawTargetText({ label: "Runde 1", round_label: "Loser Runde 1", match_keys: ["LA", "LB"] })).toBe("nach Runde 1 → Loser Runde 1 (LA, LB)");
  expect(drawTargetText({ label: "Runde 1", round_label: "Winner Runde 2", match_keys: ["C", "D"] })).toBe("nach Runde 1 → Winner Runde 2 (C, D)");
  expect(drawTargetText({ label: "Runde 1", match_keys: ["E", "F"] })).toBe("nach Runde 1 → E, F");
});

test("Auslosung bereit ohne Aufbau-Recht: Karte ohne Knopf; nach der Frist steht „jeden Moment“", async () => {
  const { drawCountdown } = await import("./TournamentLeadPage");
  const card = { id: "draw-LB:3", stage_id: "s1", group: "LB:3", label: "Loser Runde 2", match_keys: ["LC"], pot: ["Jo"], pot_size: 1, due_at: "2026-10-14T10:20:00+00:00", can_draw: false };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T10:25:00+00:00"));
  renderLead({ tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup" }, now: "2026-10-14T10:25:00+00:00", matches: [], recent: [], counts: {}, attention: [], stations: [], draws: [card] });
  expect(await screen.findByTestId("lead-draw-LB:3")).toHaveTextContent("Auslosung bereit · 1 Name");
  expect(screen.queryByTestId("lead-draw-now-LB:3")).toBeNull();
  expect(screen.getByTestId("lead-draw-countdown-LB:3")).toHaveTextContent("jeden Moment");
  expect(drawCountdown(card, "2026-10-14T10:09:30+00:00", new Date("2026-10-14T10:09:30+00:00").getTime())).toBe("automatisch in 11 Min.");
  expect(drawCountdown({ due_at: null }, "2026-10-14T10:09:30+00:00")).toBe("");
  vi.useRealTimers();
});

// #1801: Die Turnierleitung lädt nur bei Änderungen ihres Turniers nach (und, wegen der geteilten Stationen, der anderen
// Turniere seines Events) - bis das Turnier geladen ist, bei jeder. Beide Abfragen: Ansicht und Warteschlange.
test("hört nach dem Laden nur noch auf das eigene Turnier und sein Event", async () => {
  liveCalls.length = 0;
  renderLead({ tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup", event_id: "e1" }, matches: [], recent: [], counts: { open: 0 }, attention: [], stations: [] });
  expect(liveCalls.slice(0, 2).map((options) => options.tournamentId)).toEqual([undefined, undefined]);
  await waitFor(() => expect(liveCalls.slice(-2).map((options) => [options.tournamentId, options.eventId])).toEqual([["t1", "e1"], ["t1", "e1"]]));
});

test("Befangen (#2203): kein Eintragen, der Satz sagt warum - „nicht erschienen“ ebenso", async () => {
  const blocked = { ...ENTRY, can_enter: false, conflict: true };
  renderLead({
    tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup" }, matches: [blocked], recent: [], counts: { open: 1 },
    attention: [{ id: "ns-m8", kind: "no_show", title: "Nicht erschienen?", action: "no_show", match_id: "m8", station_text: "PC 4", label: "Halbfinale B", names: "TurboTina gegen Frostbiss", detail: "Frist um", participants: blocked.participants }],
    stations: [],
  });
  expect(await screen.findByTestId("lead-no-show-conflict-ns-m8")).toHaveTextContent("zweite berechtigte Person");
  expect(screen.queryByTestId("lead-no-show-r3")).toBeNull();
  fireEvent.click(screen.getByTestId("lead-tab-results"));
  expect(await screen.findByTestId("lead-conflict-m8")).toHaveTextContent("Selbst beteiligt");
  expect(screen.queryByTestId("lead-enter-m8")).toBeNull();
});

// Reiter "Check-in" (#1161): nur mit Check-in-Recht; im Status "Check-in" oeffnet die Seite dort, die Verwaltung verlinkt
// mit ?reiter=checkin. Die Liste selbst testet CheckinBoard.test.jsx.
function renderWithCheckin(tournament, path = "/tournaments/fc-cup/leitung") {
  apiMock.get.mockImplementation((url) => {
    if (String(url).endsWith("/lead/checkin")) return Promise.resolve({ data: { applies: true, team_mode: false, tournament: { id: "t1", slug: "fc-cup" }, rows: [{ id: "r1", name: "Anton", status: "approved", kind: "solo", fee: null }] } });
    if (String(url).endsWith("/live-queue")) return Promise.resolve({ data: { applies: false } });
    return Promise.resolve({ data: { tournament, matches: [ENTRY], recent: [], attention: [], stations: [], counts: { open: 1 } } });
  });
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/tournaments/:slug/leitung" element={<TournamentLeadPage />} /></Routes>
    </MemoryRouter>,
  );
}

test("Check-in-Reiter: ohne Check-in-Recht fehlt er, im Status Check-in startet die Seite dort", async () => {
  const first = renderWithCheckin({ id: "t1", slug: "fc-cup", title: "Cup", status: "check_in", can_check_in: false });
  await screen.findByTestId("lead-row-m8");
  expect(screen.queryByTestId("lead-tab-checkin")).toBeNull();
  expect(apiMock.get.mock.calls.some(([url]) => String(url).endsWith("/lead/checkin"))).toBe(false);
  first.unmount();

  renderWithCheckin({ id: "t1", slug: "fc-cup", title: "Cup", status: "check_in", can_check_in: true });
  expect(await screen.findByTestId("lead-tab-checkin")).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByTestId("lead-checkin-row-r1")).toBeInTheDocument();
  expect(screen.getByTestId("lead-checkin-counter")).toHaveTextContent("0 von 1 da");
});

test("Check-in-Reiter online: sichtbar, öffnet sich im Check-in aber nicht von selbst (Spieler checken selbst ein)", async () => {
  renderWithCheckin({ id: "t1", slug: "fc-cup", title: "Cup", status: "check_in", can_check_in: true, self_checkin: true });
  await screen.findByTestId("lead-row-m8");
  expect(screen.getByTestId("lead-tab-checkin")).toHaveAttribute("aria-selected", "false");
  expect(screen.getByTestId("lead-tab-results")).toHaveAttribute("aria-selected", "true");
});

test("Check-in-Reiter: ?reiter=checkin aus der Verwaltung oeffnet ihn auch ausserhalb des Check-ins", async () => {
  renderWithCheckin({ id: "t1", slug: "fc-cup", title: "Cup", status: "live", can_check_in: true }, "/tournaments/fc-cup/leitung?reiter=checkin");
  expect(await screen.findByTestId("lead-checkin-row-r1")).toBeInTheDocument();
  expect(screen.getByTestId("lead-tab-checkin")).toHaveAttribute("aria-selected", "true");
  fireEvent.click(screen.getByTestId("lead-tab-results"));
  expect(await screen.findByTestId("lead-row-m8")).toBeInTheDocument();
});

test("Reiter „Braucht Aufmerksamkeit“: ein Textblock, kein doppelter Abstand (Review N8)", async () => {
  renderLead({ tournament: { id: "t1", title: "Cup" }, matches: [ENTRY], recent: [], attention: [], stations: [], counts: { open: 1 } });
  const tab = await screen.findByTestId("lead-tab-attention");
  const label = screen.getByTestId("lead-tab-label-attention");
  expect(label.parentElement).toBe(tab);
  expect(label.textContent).toBe("Braucht Aufmerksamkeit (0)");
  // Kein loses Leerzeichen als eigenes Flex-Kind neben dem Symbol.
  expect([...tab.childNodes].filter((node) => node.nodeType === 3 && node.textContent.trim() === "")).toHaveLength(0);
});

test("Liste „läuft“ (#1167): ein laufendes Spiel trägt die Spielzeit-Uhr mit der Dauer des Servers - fehlt das Ergebnis, bleibt der Hinweis", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T16:17:00Z"));
  const running = { ...ENTRY, id: "m9", status: "in_progress", started_at: "2026-10-31T16:00:00Z", duration_minutes: null,
    timing: { running_minutes: 17, overdue_minutes: null, missing: false, duration_minutes: 20 } };
  const late = { ...ENTRY, id: "m10", status: "in_progress", started_at: "2026-10-31T15:30:00Z",
    timing: { running_minutes: 47, overdue_minutes: 27, missing: true, duration_minutes: 20 } };
  const planned = { ...ENTRY, id: "m11", status: "scheduled", scheduled_at: "2026-10-31T17:00:00Z", timing: { running_minutes: null, missing: false } };
  try {
    renderLead({ tournament: { id: "t1", title: "FC 26 Herbst-Cup" }, matches: [running, late, planned], recent: [], attention: [], stations: [], counts: { open: 3, running: 2 } });
    const clock = await screen.findByTestId("lead-clock-m9");
    expect(clock).toHaveTextContent("17:00/ 20 Min.");
    expect(clock).toHaveAttribute("data-tone", "warn");
    expect(clock).toHaveAttribute("data-size", "sm");
    expect(clock).toHaveAttribute("aria-label", "Spielzeit 17:00 von 20 Min., knapp");
    // Die Uhr ersetzt „läuft 17 Min.“.
    expect(screen.queryByTestId("lead-line-m9")).toBeNull();
    expect(screen.getByTestId("lead-clock-m10")).toHaveAttribute("data-tone", "over");
    expect(screen.getByTestId("lead-line-m10")).toHaveTextContent("Ergebnis fehlt · 27 Min. über der Zeit");
    // Geplant, noch nicht gestartet: keine Uhr.
    expect(screen.queryByTestId("lead-clock-m11")).toBeNull();
    expect(screen.getByTestId("lead-line-m11")).toHaveTextContent("geplant");
  } finally {
    vi.useRealTimers();
  }
});

test("Turnierpause (#1167): die Uhr in der Liste steht mit „Pause“ - frühere Pausen zählen nicht mit", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-31T16:30:00Z"));
  const paused = { ...ENTRY, id: "m12", status: "in_progress", started_at: "2026-10-31T16:00:00Z", paused_at: "2026-10-31T16:20:00Z", paused_seconds: 240,
    timing: { running_minutes: 16, overdue_minutes: null, missing: false, duration_minutes: 20 } };
  try {
    renderLead({ tournament: { id: "t1", title: "FC 26 Herbst-Cup", status: "paused", paused_at: "2026-10-31T16:20:00Z" }, matches: [paused], recent: [], attention: [], stations: [], counts: { open: 1, running: 1 } });
    const clock = await screen.findByTestId("lead-clock-m12");
    expect(screen.getByTestId("lead-clock-m12-time")).toHaveTextContent("16:00");
    expect(screen.getByTestId("lead-clock-m12-paused")).toHaveTextContent("Pause");
    expect(clock).toHaveAttribute("aria-label", "Spielzeit 16:00 von 20 Min., knapp, angehalten");
  } finally {
    vi.useRealTimers();
  }
});

// Turnier-Cockpit (#1653): vor Ort der Einstieg. Ein Tipp auf ein Problem öffnet den Fall in „Braucht Aufmerksamkeit“;
// solange das Cockpit offen ist, fragen beide Abfragen kurz im Takt nach.
test("Cockpit (#1653): Probleme oben, ein Tipp öffnet den Fall mit seinen Knöpfen; kurzer Abruf, solange es offen ist", async () => {
  const { COCKPIT_POLL_MS } = await import("@/lib/tournamentCockpit");
  liveCalls.length = 0;
  const queue = {
    applies: true, summary: null, operate: { all: true, station_ids: [] }, matches: {},
    stations: [{ id: "st2", name: "2", station_text: "Station 2", status: "free", waiting: 1, running: null, next: { match_id: "QF2", label: "Viertelfinale", names: ["NeonFalke", "Jo"], ready: true, state: "queued", position: 1, delay_minutes: 0 }, after: null }],
  };
  const lead = {
    tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup", event_mode: "local" }, matches: [ENTRY], recent: [], counts: { open: 1 }, stations: [],
    attention: [{ id: "rm-m8", kind: "result_missing", title: "Ergebnis fehlt", action: "enter", match_id: "m8", station_text: "PC 4", label: "Halbfinale B", names: "TurboTina gegen Frostbiss", detail: "12 Min. über der Zeit", overdue_minutes: 12 }],
  };
  apiMock.get.mockImplementation(async (url) => ({ data: url.endsWith("/live-queue") ? queue : lead }));
  render(
    <MemoryRouter initialEntries={["/tournaments/fc-cup/leitung"]}>
      <Routes><Route path="/tournaments/:slug/leitung" element={<TournamentLeadPage />} /></Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId("lead-tab-cockpit")).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByTestId("lead-tab-attention")).toHaveTextContent("Aufmerksamkeit (1)");
  expect(liveCalls.slice(-2).map((options) => options.pollMs)).toEqual([COCKPIT_POLL_MS, COCKPIT_POLL_MS]);
  const row = await screen.findByTestId("cockpit-problem-rm-m8");
  expect(row).toHaveAttribute("href", "/tournaments/fc-cup/leitung?fall=rm-m8");
  fireEvent.click(row);
  await waitFor(() => expect(screen.getByTestId("lead-tab-attention")).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByTestId("lead-case-enter-rm-m8")).toHaveTextContent("Eintragen");
  // Außerhalb des Cockpits wieder wie bisher: die Ansicht nur bei Änderungen, die Warteschlange je Minute.
  expect(liveCalls.slice(-2).map((options) => options.pollMs)).toEqual([0, 60000]);
});

test("Einstieg (#1653): Fall-Link → Aufmerksamkeit; vor Ort das Cockpit (im Check-in nur mit Fällen); sonst wie bisher", async () => {
  const { defaultLeadTab } = await import("./TournamentLeadPage");
  const queue = { applies: true, stations: [] };
  expect(defaultLeadTab({ fall: "rm-1", queue, ready: false })).toBe("attention");
  expect(defaultLeadTab({ queue, ready: false })).toBe("");
  expect(defaultLeadTab({ queue, ready: true })).toBe("cockpit");
  expect(defaultLeadTab({ queue, cases: 2, ready: true })).toBe("cockpit");
  expect(defaultLeadTab({ queue, checkinPhase: true, ready: true })).toBe("checkin");
  expect(defaultLeadTab({ queue, checkinPhase: true, cases: 1, ready: true })).toBe("cockpit");
  expect(defaultLeadTab({ cases: 1, checkinPhase: true, ready: true })).toBe("attention");
  expect(defaultLeadTab({ checkinPhase: true, ready: true })).toBe("checkin");
  expect(defaultLeadTab({ ready: true })).toBe("results");
});

// Review M1 (#1653): Startet die Seite vor Ort im Check-in (ohne Fälle), ist das Cockpit nicht offen - kein kurzer Takt.
test("Check-in vor Ort ohne Fälle: kein 20-Sekunden-Takt - erst im Cockpit", async () => {
  const { COCKPIT_POLL_MS } = await import("@/lib/tournamentCockpit");
  liveCalls.length = 0;
  // Nur die beiden Abfragen der Seite (Ansicht, Warteschlange) - die Check-in-Liste hört selbst mit.
  const pagePolls = () => liveCalls.filter((options) => options && "pollMs" in options).slice(-2).map((options) => options.pollMs);
  const queue = { applies: true, summary: null, operate: { all: true, station_ids: [] }, matches: {}, stations: [] };
  apiMock.get.mockImplementation((url) => {
    if (String(url).endsWith("/lead/checkin")) return Promise.resolve({ data: { applies: true, team_mode: false, tournament: { id: "t1", slug: "fc-cup" }, rows: [] } });
    if (String(url).endsWith("/live-queue")) return Promise.resolve({ data: queue });
    return Promise.resolve({ data: { tournament: { id: "t1", slug: "fc-cup", title: "Cup", status: "check_in", can_check_in: true, event_mode: "local" }, matches: [ENTRY], recent: [], attention: [], stations: [], counts: { open: 1 } } });
  });
  render(
    <MemoryRouter initialEntries={["/tournaments/fc-cup/leitung"]}>
      <Routes><Route path="/tournaments/:slug/leitung" element={<TournamentLeadPage />} /></Routes>
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getByTestId("lead-tab-checkin")).toHaveAttribute("aria-selected", "true"));
  expect(pagePolls()).toEqual([0, 60000]);
  fireEvent.click(screen.getByTestId("lead-tab-cockpit"));
  await waitFor(() => expect(pagePolls()).toEqual([COCKPIT_POLL_MS, COCKPIT_POLL_MS]));
});

// Review M2 (#1653): Derselbe Fall ein zweites Mal aus dem Cockpit angetippt springt wieder hin - auch nach einem
// ?fall=-Link, der schon einmal hingesprungen ist.
test("Cockpit: zweiter Tipp auf denselben Fall springt erneut - auch nach einem ?fall=-Link", async () => {
  const jumps = [];
  const original = window.Element.prototype.scrollIntoView;
  window.Element.prototype.scrollIntoView = function scrollIntoView() { jumps.push(this.id); };
  try {
    const queue = { applies: true, summary: null, operate: { all: true, station_ids: [] }, matches: {}, stations: [] };
    const lead = {
      tournament: { id: "t1", slug: "fc-cup", title: "FC 26 Herbst-Cup", event_mode: "local" }, matches: [ENTRY], recent: [], counts: { open: 1 }, stations: [],
      attention: [{ id: "rm-m8", kind: "result_missing", title: "Ergebnis fehlt", action: "enter", match_id: "m8", station_text: "PC 4", label: "Halbfinale B", names: "TurboTina gegen Frostbiss", detail: "12 Min. über der Zeit", overdue_minutes: 12 }],
    };
    apiMock.get.mockImplementation(async (url) => ({ data: url.endsWith("/live-queue") ? queue : lead }));
    render(
      <MemoryRouter initialEntries={["/tournaments/fc-cup/leitung?fall=rm-m8"]}>
        <Routes><Route path="/tournaments/:slug/leitung" element={<TournamentLeadPage />} /></Routes>
      </MemoryRouter>,
    );
    await screen.findByTestId("lead-case-rm-m8");
    await waitFor(() => expect(jumps).toEqual(["fall-rm-m8"]));
    for (const round of [2, 3]) {
      fireEvent.click(await screen.findByTestId("lead-tab-cockpit"));
      fireEvent.click(await screen.findByTestId("cockpit-problem-rm-m8"));
      await waitFor(() => expect(screen.getByTestId("lead-tab-attention")).toHaveAttribute("aria-selected", "true"));
      await waitFor(() => expect(jumps.filter((id) => id === "fall-rm-m8")).toHaveLength(round));
    }
  } finally {
    window.Element.prototype.scrollIntoView = original;
  }
});
