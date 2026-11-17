import { act, render, screen, waitFor } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";

// Spielplan (#225): Ein frisch eingetragenes Ergebnis trägt kurz „gerade eingetragen“, und
// unten steht ein Hinweis mit dem Ergebnis - auch für Zuschauer. Beim ersten Laden nichts davon.

const apiMock = { get: vi.fn() };
const toastMock = vi.fn();
let refresh = null;
vi.mock("@/lib/api", () => ({ api: apiMock }));
vi.mock("sonner", () => ({ toast: (...args) => toastMock(...args) }));
let liveOptions = null;
// Alle Ladefunktionen (#2440): die Seite und die Spieler-Zeile (LiveQueueStatus) fragen je selbst.
const refreshes = new Set();
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (callback, resources, options) => { refresh = callback; liveOptions = options; refreshes.add(callback); } }));
vi.mock("@/hooks/useCanonicalSlugRedirect", () => ({ useCanonicalSlugRedirect: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/Breadcrumbs", () => ({ Breadcrumbs: () => null }));

const TournamentSchedulePage = (await import("./TournamentSchedulePage")).default;

const tournament = { id: "t1", slug: "cup", title: "Herbst-Cup", status: "live" };
const registrations = [{ id: "r1", display_name: "Team A" }, { id: "r2", display_name: "Team B" }];

function bracket(m1) {
  return {
    tournament,
    registrations,
    matches_v2: [
      { id: "m1", match_key: "A1", round: 1, match_type: "duel", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }], ...m1 },
      { id: "m2", match_key: "A2", round: 1, match_type: "duel", status: "scheduled", slots: [{ slot: 1, registration_id: "r2" }, { slot: 2, registration_id: "r1" }], results: [] },
    ],
    matches: [],
  };
}

function mockApi(data) {
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: tournament });
    if (path === "/tournaments/t1/bracket") return Promise.resolve({ data });
    if (path === "/tournaments/t1/matchdays") return Promise.resolve({ data: { applies: false, matchdays: [] } });
    return Promise.reject(new Error(path));
  });
}

beforeEach(() => { toastMock.mockClear(); });

test("frisches Ergebnis: Kennzeichen an der Karte und Hinweis mit dem Ergebnis", async () => {
  mockApi(bracket({ status: "running", results: [] }));
  render(
    <MemoryRouter initialEntries={["/tournaments/cup/matches"]}>
      <Routes><Route path="/tournaments/:slug/matches" element={<TournamentSchedulePage />} /></Routes>
    </MemoryRouter>,
  );
  const card = await screen.findByTestId("schedule-match-m1");
  expect(card).not.toHaveAttribute("data-changed");
  expect(toastMock).not.toHaveBeenCalled();

  mockApi(bracket({ status: "completed", results: [{ registration_id: "r1", score: 2, rank: 1 }, { registration_id: "r2", score: 1, rank: 2 }] }));
  await act(async () => { await refresh(); });
  await waitFor(() => expect(screen.getByTestId("schedule-fresh-m1")).toHaveTextContent("gerade eingetragen"));
  expect(screen.getByTestId("schedule-match-m2")).not.toHaveAttribute("data-changed");
  expect(toastMock).toHaveBeenCalledWith("Ergebnis eingetragen: Team A 2 : Team B 1", expect.objectContaining({ id: "result-m1" }));
});

// Klartext im Spielplan (#1220): Freilos heißt Freilos, leere Plätze „noch offen“, Station einmal, Datum kurz und ganz.
test("Spielplan: Freilos, noch offene Plätze, Station im Klartext und Datum", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-05-20T10:00:00Z"));
  try {
    mockApi({
      tournament, registrations, matches: [],
      matches_v2: [
        { id: "m1", match_key: "A1", round: 1, match_type: "duel", status: "completed", winner_id: "r1", scheduled_at: "2026-05-23T16:00:00Z",
          station_label: "Station A - switch2", station_text: "Station A · Switch 2",
          slots: [{ slot: 1, registration_id: "r1", status: "filled" }, { slot: 2, status: "bye" }], results: [{ registration_id: "r1", rank: 1 }] },
        { id: "m2", match_key: "B1", round: 2, match_type: "duel", status: "scheduled", slots: [{ slot: 1, status: "pending" }, { slot: 2, status: "pending" }], results: [] },
      ],
    });
    render(
      <MemoryRouter initialEntries={["/tournaments/cup/matches"]}>
        <Routes><Route path="/tournaments/:slug/matches" element={<TournamentSchedulePage />} /></Routes>
      </MemoryRouter>,
    );
    const bye = await screen.findByTestId("schedule-match-m1");
    expect(bye).toHaveTextContent("Team A gegen Freilos");
    expect(screen.getByTestId("schedule-station-m1")).toHaveTextContent("Station A · Switch 2");
    expect(bye).not.toHaveTextContent("Station Station");
    expect(screen.getByTestId("schedule-when-m1")).toHaveTextContent("Sa 23. Mai · 18:00");
    expect(screen.getByTestId("schedule-match-m2")).toHaveTextContent("noch offen gegen noch offen");
    expect(screen.getByTestId("schedule-when-m2")).toHaveTextContent("Termin offen");
  } finally {
    vi.useRealTimers();
  }
});

// Neuer Spielplan (#1562) - mit den Daten aus dem echten Planer (scripts/make_table_schedule_fixture.py).
const generated = (await import("../../../e2e/fixtures/tableScheduleGenerated.json")).default;

function mockGenerated(set) {
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: { ...set.tournament, slug: "cup" } });
    if (path === `/tournaments/${set.tournament.id}/bracket`) return Promise.resolve({ data: set.bracket });
    if (path === `/tournaments/${set.tournament.id}/matchdays`) return Promise.resolve({ data: set.matchdays || { applies: false, matchdays: [] } });
    return Promise.reject(new Error(path));
  });
}

const renderSchedule = () => render(
  <MemoryRouter initialEntries={["/tournaments/cup/matches"]}>
    <Routes>
      <Route path="/tournaments/:slug/matches" element={<TournamentSchedulePage />} />
      <Route path="/matches/:id" element={<div data-testid="match-page" />} />
    </Routes>
  </MemoryRouter>,
);

test("vor Ort: das laufende Spiel trägt die Live-Farbe, fertige und offene nicht", async () => {
  mockGenerated(generated.onsite);
  renderSchedule();
  const live = generated.onsite.bracket.matches_v2.find((match) => match.status === "in_progress");
  const done = generated.onsite.bracket.matches_v2.find((match) => match.status === "completed");
  expect(await screen.findByTestId(`schedule-match-${live.id}`)).toHaveAttribute("data-tone", "live");
  expect(screen.getByTestId(`schedule-match-${live.id}`).className).toContain("tls-bracket-live");
  expect(screen.getByTestId(`schedule-status-${live.id}`)).toHaveAttribute("data-tone", "live");
  expect(screen.getByTestId(`schedule-status-${live.id}`)).toHaveTextContent("Läuft");
  expect(screen.getByTestId(`schedule-status-${done.id}`)).toHaveAttribute("data-tone", "done");
  expect(screen.getByTestId(`schedule-match-${done.id}`).className).not.toContain("tls-bracket-live");
  // Was der Planer nur vorhersagt, sagt es auch.
  const forecast = generated.onsite.bracket.matches_v2.find((match) => match.schedule_forecast);
  expect(screen.getByTestId(`schedule-forecast-${forecast.id}`)).toHaveTextContent("voraussichtlich");
});

test("Sicht je Station: eine Liste je Station nach Zeit, ein Spiel antippen öffnet die Spielseite", async () => {
  const user = (await import("@testing-library/user-event")).default.setup();
  mockGenerated(generated.onsite);
  renderSchedule();
  await user.click(await screen.findByTestId("schedule-view-stations"));
  const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.firstElementChild.firstElementChild.textContent);
  expect(headings).toEqual(["PC 1", "PC 2", "Switch 3"]);
  // Das Gerät steht klein daneben, nicht im Namen (Abnahme #1593).
  expect(screen.getByTestId("schedule-station-device-Switch 3")).toHaveTextContent("PC");
  const first = generated.onsite.bracket.matches_v2.find((match) => match.status === "completed");
  await user.click(screen.getByTestId(`schedule-line-${first.id}`));
  expect(await screen.findByTestId("match-page")).toBeInTheDocument();
});

test("Nur meine Spiele: zeigt nur die Spiele der eigenen Anmeldung", async () => {
  const user = (await import("@testing-library/user-event")).default.setup();
  mockGenerated(generated.onsite);
  renderSchedule();
  const toggle = await screen.findByTestId("schedule-only-mine");
  expect(toggle).toHaveAttribute("aria-pressed", "false");
  await user.click(toggle);
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  // Aktiver Filter in der Filter-Farbe, nicht in Gold - Gold ist Ehre (Abnahme #1593).
  expect(toggle.className).toContain("tls-btn--secondary");
  expect(toggle.className).not.toContain("tls-btn--honor");
  const mineId = generated.onsite.bracket.registrations.find((reg) => reg.is_mine).id;
  const cards = screen.getAllByTestId(/^schedule-match-/);
  const mine = generated.onsite.bracket.matches_v2.filter((match) => match.slots.some((slot) => slot.registration_id === mineId));
  expect(cards).toHaveLength(mine.length);
  expect(cards.every((card) => card.getAttribute("data-mine") === "true")).toBe(true);
  // Ecken-Klammern (#1316): deine Spiele tragen Ecken statt des Leuchtrands.
  expect(cards.every((card) => card.classList.contains("tls-you"))).toBe(true);
});

test("Ecken-Klammern (#1316): im Spielplan tragen nur deine Spiele Ecken und „Du“", async () => {
  mockGenerated(generated.onsite);
  renderSchedule();
  const cards = await screen.findAllByTestId(/^schedule-match-/);
  const mineId = generated.onsite.bracket.registrations.find((reg) => reg.is_mine).id;
  const mineIds = new Set(generated.onsite.bracket.matches_v2.filter((match) => match.slots.some((slot) => slot.registration_id === mineId)).map((match) => match.id));
  expect(mineIds.size).toBeGreaterThan(0);
  expect(cards.length).toBeGreaterThan(mineIds.size);
  for (const card of cards) {
    const own = mineIds.has(card.getAttribute("data-testid").replace("schedule-match-", ""));
    expect([card.getAttribute("data-testid"), card.classList.contains("tls-you")]).toEqual([card.getAttribute("data-testid"), own]);
  }
});

test("ohne eigene Anmeldung und ohne Stationen gibt es weder Filter noch Stations-Sicht", async () => {
  mockGenerated({ ...generated.groups, bracket: { ...generated.groups.bracket, registrations: generated.groups.bracket.registrations.map(({ is_mine: _mine, ...reg }) => reg) } });
  renderSchedule();
  await screen.findAllByTestId(/^schedule-match-/);
  expect(screen.queryByTestId("schedule-only-mine")).toBeNull();
  expect(screen.queryByTestId("schedule-view-stations")).toBeNull();
  // Gruppen: jede Karte nennt ihre Gruppe.
  expect(screen.getAllByText(/Gruppe A · /).length).toBeGreaterThan(0);
});

test("Live-Warteschlange (#1556): je Station „Jetzt“ und „Als Nächstes“ aus dem Server, oben der Verzug und dein nächstes Spiel", async () => {
  const user = (await import("@testing-library/user-event")).default.setup();
  const set = generated.onsite;
  const live = set.bracket.matches_v2.find((match) => match.status === "in_progress");
  const queue = {
    applies: true,
    summary: { delay_minutes: 11, last: { label: "Finale", forecast_at: "2026-10-31T19:51:00Z" } },
    stations: [{
      id: live.station_id, name: "PC 1", station_text: "PC 1", status: "busy", waiting: 1,
      running: { match_id: live.id, state: "running", names: ["NeonFalke", "PixelPaula"], label: "Viertelfinale", started_at: "2026-10-31T16:00:00Z", duration_minutes: 30 },
      next: { match_id: "x2", state: "called", names: ["LuckyLion", "Jo"], label: "Halbfinale", called_at: "2026-10-31T16:28:00Z", report_by: "2026-10-31T16:30:00Z" },
      after: null,
    }],
    matches: {},
  };
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: { ...set.tournament, slug: "cup" } });
    if (path === `/tournaments/${set.tournament.id}/bracket`) return Promise.resolve({ data: set.bracket });
    if (path === `/tournaments/${set.tournament.id}/matchdays`) return Promise.resolve({ data: { applies: false, matchdays: [] } });
    if (path === `/tournaments/${set.tournament.id}/live-queue`) return Promise.resolve({ data: queue });
    if (path === `/tournaments/${set.tournament.id}/live-queue/me`) return Promise.resolve({ data: { applies: true, entries: [{ match_id: "x9", state: "queued", position: 1, station_text: "PC 2", forecast_at: "2026-10-31T17:40:00Z" }] } });
    return Promise.reject(new Error(path));
  });
  renderSchedule();
  expect(await screen.findByTestId("live-queue-status")).toHaveTextContent("Du bist als Nächstes an PC 2");
  await user.click(await screen.findByTestId("schedule-view-stations"));
  expect(await screen.findByTestId("schedule-live-summary")).toHaveTextContent("+11 Min. · Finale jetzt ca. 20:51");
  const now = screen.getByTestId(`schedule-now-${live.station_id}`);
  expect(now).toHaveTextContent("Jetzt");
  expect(now).toHaveTextContent("NeonFalke gegen PixelPaula");
  expect(now).toHaveTextContent("Als Nächstes");
  expect(now).toHaveTextContent("Aufgerufen · antreten bis 17:30");

  // #2440: Scheitert das Nachladen der Warteschlange (Server 503), bleiben „Jetzt“/„Als Nächstes“ und die eigene Zeile -
  // mit „Letzter Stand vor X s“. Nach 3 Minuten ohne Erfolg fällt der alte Stand weg (kein falsches „Du bist dran“).
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  try {
    const answer = apiMock.get.getMockImplementation();
    apiMock.get.mockImplementation((path, ...rest) => (String(path).includes("/live-queue")
      ? Promise.reject(Object.assign(new Error("503"), { response: { status: 503, data: {} } }))
      : answer(path, ...rest)));
    await act(async () => { await Promise.all([...refreshes].map((load) => load())); });
    expect(screen.getByTestId(`schedule-now-${live.station_id}`)).toHaveTextContent("NeonFalke gegen PixelPaula");
    expect(screen.getByTestId("live-queue-status")).toHaveTextContent("Du bist als Nächstes an PC 2");
    expect(screen.getByTestId("schedule-live-stale")).toHaveTextContent("Letzter Stand vor");
    expect(screen.getByTestId("live-queue-status-stale")).toHaveTextContent("Letzter Stand vor");
    act(() => { vi.advanceTimersByTime(3 * 60 * 1000 + 1000); });
    expect(screen.queryByTestId("schedule-live-summary")).toBeNull();
    expect(screen.queryByTestId("schedule-live-stale")).toBeNull();
    expect(screen.queryByTestId("live-queue-status")).toBeNull();
    expect(screen.queryByTestId(`schedule-now-${live.station_id}`)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

// #2440 (Nachprüfung): Scheitert schon der Baum (WLAN ohne Internet), gilt der Stand der Warteschlange als alt - mit
// Hinweis und nach 3 Minuten weg.
test("scheitert schon /bracket, zeigt der Spielplan „Letzter Stand“ und blendet die Warteschlange nach 3 Minuten aus", async () => {
  const user = (await import("@testing-library/user-event")).default.setup();
  const set = generated.onsite;
  const live = set.bracket.matches_v2.find((match) => match.status === "in_progress");
  const queue = {
    applies: true, summary: null, matches: {},
    stations: [{ id: live.station_id, name: "PC 1", station_text: "PC 1", status: "busy", waiting: 0,
      running: { match_id: live.id, state: "running", names: ["NeonFalke", "PixelPaula"], label: "Viertelfinale", started_at: "2026-10-31T16:00:00Z", duration_minutes: 30 }, next: null, after: null }],
  };
  let bracketDown = false;
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: { ...set.tournament, slug: "cup" } });
    if (path === `/tournaments/${set.tournament.id}/bracket`) return bracketDown ? Promise.reject(Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" })) : Promise.resolve({ data: set.bracket });
    if (String(path).endsWith("/matchdays")) return Promise.resolve({ data: { applies: false, matchdays: [] } });
    if (path === `/tournaments/${set.tournament.id}/live-queue`) return Promise.resolve({ data: queue });
    return Promise.reject(new Error(path));
  });
  const earlier = new Set(refreshes);
  renderSchedule();
  await user.click(await screen.findByTestId("schedule-view-stations"));
  expect(await screen.findByTestId(`schedule-now-${live.station_id}`)).toHaveTextContent("NeonFalke gegen PixelPaula");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  try {
    bracketDown = true;
    // Alles, was diese Seite im Takt lädt.
    await act(async () => { await Promise.all([...refreshes].filter((load) => !earlier.has(load)).map((load) => Promise.resolve(load()).catch(() => {}))); });
    expect(screen.getByTestId("schedule-live-stale")).toHaveTextContent("Letzter Stand vor");
    act(() => { vi.advanceTimersByTime(3 * 60 * 1000 + 1000); });
    expect(screen.queryByTestId(`schedule-now-${live.station_id}`)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

// #2440 (Review): Nach einem Turnierwechsel zeigt der Spielplan nicht die Stationen des vorigen Turniers - auch nicht,
// wenn der erste Abruf der Warteschlange des neuen scheitert.
test("Turnierwechsel: scheitert der erste Abruf des neuen Turniers, bleibt nichts vom vorigen stehen", async () => {
  const user = (await import("@testing-library/user-event")).default.setup();
  const set = generated.onsite;
  const live = set.bracket.matches_v2.find((match) => match.status === "in_progress");
  const queue = {
    applies: true, summary: null, matches: {},
    stations: [{ id: live.station_id, name: "PC 1", station_text: "PC 1", status: "busy", waiting: 0,
      running: { match_id: live.id, state: "running", names: ["NeonFalke", "PixelPaula"], label: "Viertelfinale", started_at: "2026-10-31T16:00:00Z", duration_minutes: 30 }, next: null, after: null }],
  };
  apiMock.get.mockImplementation((path) => {
    if (path === "/tournaments/cup") return Promise.resolve({ data: { ...set.tournament, slug: "cup" } });
    if (path === "/tournaments/cup2") return Promise.resolve({ data: { ...set.tournament, id: "t-second", slug: "cup2" } });
    if (path === `/tournaments/${set.tournament.id}/bracket` || path === "/tournaments/t-second/bracket") return Promise.resolve({ data: set.bracket });
    if (String(path).endsWith("/matchdays")) return Promise.resolve({ data: { applies: false, matchdays: [] } });
    if (path === `/tournaments/${set.tournament.id}/live-queue`) return Promise.resolve({ data: queue });
    if (path === "/tournaments/t-second/live-queue") return Promise.reject(Object.assign(new Error("503"), { response: { status: 503, data: {} } }));
    return Promise.reject(new Error(path));
  });
  render(
    <MemoryRouter initialEntries={["/tournaments/cup/matches"]}>
      <Link to="/tournaments/cup2/matches" data-testid="go-second">Zweites</Link>
      <Routes><Route path="/tournaments/:slug/matches" element={<TournamentSchedulePage />} /></Routes>
    </MemoryRouter>,
  );
  await user.click(await screen.findByTestId("schedule-view-stations"));
  expect(await screen.findByTestId(`schedule-now-${live.station_id}`)).toHaveTextContent("NeonFalke gegen PixelPaula");
  await user.click(screen.getByTestId("go-second"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/tournaments/t-second/live-queue", expect.anything()));
  await waitFor(() => expect(screen.queryByTestId(`schedule-now-${live.station_id}`)).toBeNull());
  expect(screen.queryByTestId("schedule-live-stale")).toBeNull();
});

// #1801: Der Spielplan lädt nur bei Änderungen seines Turniers nach - und, weil sich die Turniere eines Events Stationen
// teilen, bei denen der anderen Turniere desselben Events. Bis das Turnier geladen ist, bei jeder.
test("hört nach dem Laden auf das eigene Turnier und sein Event", async () => {
  mockApi({ ...bracket({ status: "scheduled", results: [] }), tournament: { ...tournament, event_id: "e1" } });
  renderSchedule();
  expect(liveOptions.tournamentId).toBeFalsy();
  await screen.findByTestId("schedule-match-m1");
  await waitFor(() => expect(liveOptions).toMatchObject({ tournamentId: "t1", eventId: "e1" }));
});
