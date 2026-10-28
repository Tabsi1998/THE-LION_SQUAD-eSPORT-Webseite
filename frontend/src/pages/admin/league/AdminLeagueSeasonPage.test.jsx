import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Eine Season verwalten (docs/LIGA.md, #1622): Vorgaben mit Sperrzeiten speichern, Kalender ablesen, Liga N anlegen,
// Staffel anlegen und zur Turnierverwaltung springen, Vorgaben übertragen mit Grund für das, was nicht mehr darf.
const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), formatRequestError: () => "Fehler", resolveMediaUrl: (url) => url || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { default: AdminLeagueSeasonPage } = await import("./AdminLeagueSeasonPage");

const RULES = { match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "score_for"] };
const SEASON = {
  id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10,
  matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3,
  team_size: 4, min_squad_size: 4, game_mode_order: [], scoring_rules: RULES, result_confirm_hours: 48, lineup_amend_hours: 48,
  rules_text: "", registration_deadline: null, visibility: "off", status: "draft",
  blocked_periods: [{ start_date: "2026-12-21", end_date: "2027-01-03", label: "Weihnachtspause" }],
};
const weeks = Array.from({ length: 10 }, (_, index) => ({ number: index + 1, start_day: "2026-11-10", end_day: "2026-11-16", blocked: index === 6 || index === 7 }));
const CALENDAR = { weeks, blocked_weeks: [7, 8], active_weeks: 8, max_teams_per_staffel: 8, rounds_needed: 7 };
const BODY = {
  league: { id: "l1", name: "Probe-Liga", slug: "probe-shooter" },
  season: SEASON,
  game: { id: "g1", name: "Probe Shooter", modes: [{ mode: "snd", label: "Suchen & Zerstören" }, { mode: "stellung", label: "Stellung" }] },
  calendar: CALENDAR, library: [], map_pool: null,
  divisions: [{
    id: "d1", level: 1, nickname: null, overrides: {}, label: "Liga 1", calendar: CALENDAR,
    settings: { best_of: 3, team_size: 4, min_squad_size: 4, max_staffel_size: 8, scoring_rules: RULES },
    staffeln: [{ tournament_id: "t1", staffel: "A", status: "draft", participant_count: 3, max_participants: 8 }],
  }],
};

beforeEach(() => {
  for (const fn of [...Object.values(apiMock), ...Object.values(toastMock)]) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: BODY });
  apiMock.patch.mockResolvedValue({ data: { ...SEASON, changed: ["weeks_total"], staffeln_to_sync: 1 } });
  apiMock.post.mockResolvedValue({ data: {} });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/admin/leagues/seasons/s1"]}>
      <Routes>
        <Route path="/admin/leagues/seasons/:seasonId" element={<AdminLeagueSeasonPage />} />
        <Route path="/admin/leagues" element={<p data-testid="leagues-page">Übersicht</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

/** GET liefert die Season - und für `…/delete-plan` den angegebenen Plan (#2106). */
function withPlan(plan) {
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/delete-plan") ? plan : BODY }));
}

test("zeigt Kopf, Kalender mit Sperrwochen und die Staffel mit Weg zur Turnierverwaltung", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Probe-Liga · Season 1");
  expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s1");
  expect(screen.getByTestId("season-calendar")).toHaveTextContent("8 Spielwochen");
  expect(screen.getByTestId("season-calendar")).toHaveTextContent("höchstens 8 Teams");
  expect(screen.getByTestId("blocked-label-0")).toHaveValue("Weihnachtspause");
  expect(screen.getByTestId("staffel-manage-1-A")).toHaveAttribute("href", "/admin/tournaments/t1");
  expect(screen.getByTestId("staffel-1-A")).toHaveTextContent("3 von 8 Teams");
});

test("speichert die Vorgaben und bietet danach das Übertragen an", async () => {
  apiMock.post.mockResolvedValue({ data: { staffeln: [{ tournament_id: "t1", title: "Staffel A", applied: ["always"], changed: ["rules"],
    skipped: [{ group: "before_start", label: "Termine und Kalender", reason: "Die Staffel hat schon begonnen." }] }] } });
  renderPage();
  fireEvent.change(await screen.findByTestId("season-form-weeks"), { target: { value: "11" } });
  fireEvent.click(screen.getByTestId("blocked-add"));
  fireEvent.click(screen.getByTestId("season-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  const [url, body] = apiMock.patch.mock.calls[0];
  expect(url).toBe("/admin/leagues/seasons/s1");
  expect(body.weeks_total).toBe(11);
  expect(body.blocked_periods).toEqual([{ start_date: "2026-12-21", end_date: "2027-01-03", label: "Weihnachtspause" }]);
  expect(body.start_date).toBe("2026-11-09T23:00:00.000Z");

  fireEvent.click(await screen.findByTestId("season-sync-now"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/sync"));
  const results = await screen.findByTestId("sync-results");
  expect(results).toHaveTextContent("1 Wert übernommen");
  expect(results).toHaveTextContent("Nicht übertragen – Termine und Kalender: Die Staffel hat schon begonnen.");
});

test("Modus je Map halb gesetzt: nicht speichern, sondern sagen, was fehlt", async () => {
  renderPage();
  fireEvent.change(await screen.findByTestId("mode-order-0"), { target: { value: "snd" } });
  expect(screen.getByTestId("season-mode-order")).toHaveTextContent("Bitte für jede Map einen Modus wählen");
  fireEvent.click(screen.getByTestId("season-save"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  expect(apiMock.patch).not.toHaveBeenCalled();
});

test("Staffel anlegen und Liga 2 mit eigener Teamgröße anlegen", async () => {
  apiMock.post.mockResolvedValueOnce({ data: { tournament_id: "t2", staffel: "B" } });
  renderPage();
  fireEvent.click(await screen.findByTestId("staffel-add-1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/divisions/d1/staffeln", {}));

  fireEvent.click(screen.getByTestId("division-add"));
  const sheet = screen.getByTestId("division-sheet");
  fireEvent.change(within(sheet).getByTestId("division-nickname"), { target: { value: "Elite" } });
  fireEvent.change(within(sheet).getByTestId("override-team-size"), { target: { value: "5" } });
  fireEvent.click(within(sheet).getByTestId("division-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/divisions", { nickname: "Elite", overrides: { team_size: 5 } }));
});

// ---------------------------------------------------------------- Korrigieren, archivieren, löschen (#2106)

test("Season löschen: Bestätigung in der Seite mit Auflistung und Grund, danach zurück zur Übersicht", async () => {
  const confirmSpy = vi.spyOn(window, "confirm");
  withPlan({ kind: "season", id: "s1", name: "Season 1", deletable: true, blockers: [], archived: false, seasons: [],
    divisions: [{ id: "d1", label: "Liga 1" }], staffeln: [{ tournament_id: "t1", title: "Probe-Liga Season 1 · Liga 1 · Staffel A", staffel: "A" }] });
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
  renderPage();
  fireEvent.click(await screen.findByTestId("season-delete"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s1/delete-plan"));
  const list = await screen.findByTestId("league-delete-list");
  expect(list).toHaveTextContent("Liga 1");
  expect(list).toHaveTextContent("Leere Staffeln (Entwurf)");
  expect(list).toHaveTextContent("Staffel A");
  const confirmButton = screen.getByTestId("league-delete-confirm");
  expect(confirmButton).toBeDisabled();
  fireEvent.change(screen.getByTestId("league-delete-reason"), { target: { value: "Doppelt angelegt" } });
  expect(confirmButton).toBeEnabled();
  fireEvent.click(confirmButton);
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/leagues/seasons/s1", { data: { reason: "Doppelt angelegt" } }));
  expect(await screen.findByTestId("leagues-page")).toBeInTheDocument();
  expect(confirmSpy).not.toHaveBeenCalled();
  confirmSpy.mockRestore();
});

test("Liga N mit gespielter Staffel: Archivieren statt löschen, mit Knopf", async () => {
  withPlan({ kind: "division", id: "d1", name: "Liga 1", deletable: false, archived: false, seasons: [], divisions: [], staffeln: [],
    blockers: ["Probe-Liga Season 1 · Liga 1 · Staffel A hat schon begonnen oder Spiele"] });
  apiMock.patch.mockResolvedValue({ data: { id: "d1", status: "archived" } });
  renderPage();
  fireEvent.click(await screen.findByTestId("division-delete-1"));
  const blocked = await screen.findByTestId("league-delete-blocked");
  expect(blocked).toHaveTextContent("Archivieren statt löschen");
  expect(blocked).toHaveTextContent("Staffel A hat schon begonnen oder Spiele");
  expect(screen.queryByTestId("league-delete-confirm")).toBeNull();
  fireEvent.click(screen.getByTestId("league-delete-archive"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/admin/leagues/divisions/d1", { status: "archived" }));
  expect(apiMock.delete).not.toHaveBeenCalled();
});

test("Staffel im Entwurf direkt auf der Season-Seite löschen - mit Hinweis auf die zugeteilten Co-Teams", async () => {
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
  renderPage();
  fireEvent.click(await screen.findByTestId("staffel-delete-1-A"));
  const list = await screen.findByTestId("league-delete-list");
  expect(list).toHaveTextContent("Die 3 zugeteilten Co-Teams werden dabei aus der Staffel genommen.");
  fireEvent.change(screen.getByTestId("league-delete-reason"), { target: { value: "Zu wenige Teams" } });
  fireEvent.click(screen.getByTestId("league-delete-confirm"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/leagues/staffeln/t1", { data: { reason: "Zu wenige Teams" } }));
  expect(apiMock.get).not.toHaveBeenCalledWith(expect.stringContaining("delete-plan"));
});

test("eine gestartete Staffel hat keinen Löschknopf - dort gilt Abgesagt oder Archiviert", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, divisions: [{ ...BODY.divisions[0], staffeln: [{ ...BODY.divisions[0].staffeln[0], status: "live" }] }] } });
  renderPage();
  await screen.findByTestId("staffel-1-A");
  expect(screen.queryByTestId("staffel-delete-1-A")).toBeNull();
});

test("Liga N bearbeiten schickt den Stand mit, Antwortfrist je Liga N und als Season-Wert", async () => {
  apiMock.patch.mockResolvedValue({ data: {} });
  renderPage();
  fireEvent.click(await screen.findByTestId("division-edit-1"));
  const sheet = screen.getByTestId("division-sheet");
  fireEvent.change(within(sheet).getByTestId("division-status"), { target: { value: "archived" } });
  fireEvent.change(within(sheet).getByTestId("override-response"), { target: { value: "24" } });
  fireEvent.click(within(sheet).getByTestId("division-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/admin/leagues/divisions/d1",
    { nickname: null, overrides: { match_schedule_response_hours: 24 }, status: "archived" }));

  apiMock.patch.mockResolvedValue({ data: { ...SEASON, changed: [], staffeln_to_sync: 0 } });
  // Season von vor #2106: das Feld ist leer und bleibt beim Speichern leer.
  expect(screen.getByTestId("season-form-response")).toHaveValue(null);
  fireEvent.click(screen.getByTestId("season-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenLastCalledWith("/admin/leagues/seasons/s1", expect.objectContaining({ match_schedule_response_hours: null })));
  await waitFor(() => expect(screen.getByTestId("season-save")).toHaveTextContent("Season speichern"));
  fireEvent.change(screen.getByTestId("season-form-response"), { target: { value: "48" } });
  fireEvent.click(screen.getByTestId("season-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenLastCalledWith("/admin/leagues/seasons/s1", expect.objectContaining({ match_schedule_response_hours: 48 })));
});

test("Fehler beim Anlegen der Staffel steht als Meldung da", async () => {
  apiMock.post.mockRejectedValueOnce({ response: { data: { detail: "Mit bis zu 9 Teams braucht die Staffel 9 Spielwochen" } } });
  renderPage();
  fireEvent.click(await screen.findByTestId("staffel-add-1"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Mit bis zu 9 Teams braucht die Staffel 9 Spielwochen"));
});
