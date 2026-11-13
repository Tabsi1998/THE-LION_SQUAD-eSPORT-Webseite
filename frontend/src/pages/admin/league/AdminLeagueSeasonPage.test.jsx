import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Eine Season verwalten (docs/LIGA.md, #1622) - seit #2267 in Reitern: Überblick mit Ablauf und Prüfung, Speichern je Reiter (nur die
// eigenen Felder), Punkt bei Ungespeichertem, Rückfrage beim Reiterwechsel, Sprungmarken (auch die alte #anmeldungen), Kalender,
// Modus je Map, Liga N und Staffeln, Übertragen, Löschen und Archivieren.
const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler"), formatRequestError: () => "Fehler", resolveMediaUrl: (url) => url || "" }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
const confirmMock = vi.fn();
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { role: "superadmin" } }) }));

const { default: AdminLeagueSeasonPage } = await import("./AdminLeagueSeasonPage");

const RULES = { match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "score_for"] };
const SEASON = {
  id: "s1", league_id: "l1", number: 1, name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10,
  matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3,
  team_size: 4, min_squad_size: 4, game_mode_order: [], scoring_rules: RULES, result_confirm_hours: 48, lineup_amend_hours: 48,
  rules_text: "", registration_deadline: null, visibility: "off", status: "draft", updated_at: "2026-11-01T10:00:00Z",
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

// Prüfung vor der Veröffentlichung (#2207): eigener Abruf der Seite.
const READINESS = { ok: false, superadmin: true, max_maps: 3, total: null, requirements: [], warnings: [],
  problems: [{ code: "pool_missing", text: "Die Season hat keinen Map-Pool." }] };

let body = BODY;
let extra = {};
function routeGet(url) {
  if (url in extra) return Promise.resolve({ data: extra[url] });
  if (url.endsWith("/readiness")) return Promise.resolve({ data: READINESS });
  if (url === "/admin/leagues/seasons/s1") return Promise.resolve({ data: body });
  return Promise.resolve({ data: {} });
}

beforeEach(() => {
  for (const fn of [...Object.values(apiMock), ...Object.values(toastMock), confirmMock]) fn.mockReset();
  body = BODY;
  extra = {};
  confirmMock.mockResolvedValue(true);
  apiMock.get.mockImplementation(routeGet);
  apiMock.patch.mockResolvedValue({ data: { ...SEASON, changed: ["weeks_total"], staffeln_to_sync: 1 } });
  apiMock.post.mockResolvedValue({ data: {} });
});

function Where() {
  const location = useLocation();
  return <span data-testid="where">{location.pathname}{location.hash}</span>;
}

function renderPage(hash = "") {
  return render(
    <MemoryRouter initialEntries={[`/admin/leagues/seasons/s1${hash}`]}>
      <Routes>
        <Route path="/admin/leagues/seasons/:seasonId" element={<><AdminLeagueSeasonPage /><Where /></>} />
        <Route path="/admin/leagues" element={<p data-testid="leagues-page">Übersicht</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const panel = (key) => screen.getByTestId(`season-panel-${key}`);

// ---------------------------------------------------------------- Reiter (#2267)

test("Reiter per Sprungmarke: ohne Marke der Überblick, #termine öffnet Termine, die alte Marke #anmeldungen den Reiter Anmeldung", async () => {
  const first = renderPage();
  expect(await screen.findByTestId("season-tab-ueberblick")).toHaveAttribute("aria-selected", "true");
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(
    ["Überblick", "Leitstand", "Spielbetrieb", "Termine", "Anmeldung und Kader", "Tabelle", "Proteste", "Strafen", "Regelwerk und Sperrliste", "Ligen und Staffeln", "Abschluss"]);
  first.unmount();
  const second = renderPage("#termine");
  expect(await screen.findByTestId("season-form-weeks")).toBeInTheDocument();
  expect(screen.getByTestId("season-tab-termine")).toHaveAttribute("aria-selected", "true");
  second.unmount();
  renderPage("#anmeldungen");
  expect(await screen.findByTestId("season-tab-anmeldung")).toHaveAttribute("aria-selected", "true");
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s1/applications"));
});

test("Leitstand (E.4) als zweiter Reiter, per #leitstand und #protokoll erreichbar", async () => {
  extra = { "/admin/leagues/seasons/s1/desk": { season: { id: "s1" }, groups: [], total: 0, mine: 0, can_broadcast: false },
    "/admin/leagues/seasons/s1/desk/log": { items: [], page: 1, pages: 1, total: 0 } };
  const first = renderPage("#leitstand");
  expect(await screen.findByTestId("season-tab-leitstand")).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByTestId("desk-empty")).toHaveTextContent("Alles erledigt");
  first.unmount();
  renderPage("#protokoll");
  expect(await screen.findByTestId("season-tab-leitstand")).toHaveAttribute("aria-selected", "true");
});

test("Überblick: Ablaufleiste, Sichtbarkeit und Stand mit einem Satz, was sie bewirken", async () => {
  renderPage();
  expect(await screen.findByTestId("season-phases")).toBeInTheDocument();
  expect(screen.getAllByTestId(/^season-phase-/).map((row) => row.textContent)).toEqual(expect.arrayContaining([expect.stringContaining("Vorbereitung")]));
  expect(screen.getByTestId("season-visibility-effect")).toHaveTextContent("Niemand sieht die Season");
  fireEvent.change(screen.getByTestId("season-form-visibility"), { target: { value: "members" } });
  expect(screen.getByTestId("season-visibility-effect")).toHaveTextContent("Veröffentlicht für angemeldete Mitglieder");
  expect(await screen.findByTestId("season-visibility-blocked")).toBeInTheDocument();
  expect(screen.getByTestId("season-status-effect")).toHaveTextContent("Nur jetzt lässt sich die Season noch löschen");
});

test("#2324: „Auf der Startseite bewerben“ steht im Überblick, Vorgabe an, ausgeschaltet geht false mit", async () => {
  renderPage();
  const toggle = await screen.findByTestId("season-form-promote-home");
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);
  fireEvent.click(screen.getByTestId("season-save-ueberblick"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  expect(apiMock.patch.mock.calls[0][1].promote_on_home).toBe(false);
});

test("die Prüfung steht im Überblick, jeder Punkt springt in seinen Reiter, der Grund der Notausnahme geht mit dem Veröffentlichen mit", async () => {
  renderPage();
  expect(await screen.findByTestId("season-readiness-problems")).toHaveTextContent("keinen Map-Pool");
  fireEvent.change(screen.getByTestId("season-readiness-override"), { target: { value: "Saisonstart trotz Lücke" } });
  fireEvent.change(screen.getByTestId("season-form-visibility"), { target: { value: "members" } });
  fireEvent.click(screen.getByTestId("season-save-ueberblick"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  // „Auf der Startseite bewerben“ (#2324) gehört zum Überblick - Vorgabe an.
  expect(apiMock.patch.mock.calls[0][1]).toEqual({ name: "Season 1", visibility: "members", status: "draft", promote_on_home: true, emblem_url: null,
    banner_url: null, banner_focus: null, prizes: null, readiness_override_reason: "Saisonstart trotz Lücke" });

  fireEvent.click(screen.getByTestId("season-readiness-problems-go-pool_missing"));
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/admin/leagues/seasons/s1#modi"));
  expect(screen.getByTestId("season-tab-spielbetrieb")).toHaveAttribute("aria-selected", "true");
});

test("Speichern je Reiter: Termine schickt nur Termine - ungespeicherte Tabelle bleibt mit Punkt erhalten", async () => {
  renderPage("#tabelle");
  fireEvent.change(await screen.findByTestId("season-form-points-win"), { target: { value: "2" } });
  expect(screen.getByTestId("season-tab-dirty-tabelle")).toBeInTheDocument();

  // Reiterwechsel mit Ungespeichertem: Rückfrage - „Später speichern“ wechselt, die Eingabe bleibt.
  confirmMock.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByTestId("season-tab-termine"));
  await waitFor(() => expect(screen.getByTestId("season-tab-termine")).toHaveAttribute("aria-selected", "true"));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "„Tabelle“ ist nicht gespeichert", confirmLabel: "Jetzt speichern" }));
  expect(apiMock.patch).not.toHaveBeenCalled();

  fireEvent.change(screen.getByTestId("season-form-weeks"), { target: { value: "11" } });
  fireEvent.click(screen.getByTestId("blocked-add"));
  fireEvent.click(screen.getByTestId("season-save-termine"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  const [url, sent] = apiMock.patch.mock.calls[0];
  expect(url).toBe("/admin/leagues/seasons/s1");
  expect(sent).toEqual({ start_date: "2026-11-09T23:00:00.000Z", weeks_total: 11, matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00",
    round_robin_legs: 1, blocked_periods: [{ start_date: "2026-12-21", end_date: "2027-01-03", label: "Weihnachtspause" }], match_schedule_response_hours: null });
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Termine gespeichert."));
  expect(screen.getByTestId("season-tab-dirty-tabelle")).toBeInTheDocument();
  expect(screen.getByTestId("season-form-points-win")).toHaveValue(2);
});

test("Rückfrage beim Reiterwechsel: „Jetzt speichern“ speichert den Reiter und wechselt dann", async () => {
  renderPage("#tabelle");
  fireEvent.change(await screen.findByTestId("season-form-points-win"), { target: { value: "2" } });
  fireEvent.click(screen.getByTestId("season-tab-ligen"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  expect(Object.keys(apiMock.patch.mock.calls[0][1])).toEqual(["scoring_rules"]);
  expect(apiMock.patch.mock.calls[0][1].scoring_rules.match_points).toEqual({ win: 2, draw: 1, loss: 0 });
  await waitFor(() => expect(screen.getByTestId("season-tab-ligen")).toHaveAttribute("aria-selected", "true"));
});

test("Punkte nach gewonnenen Maps (#2312): Wechsel schlägt Reihenfolge und kampflos 3:0 vor, beides bleibt änderbar", async () => {
  renderPage("#tabelle");
  const mode = await screen.findByTestId("season-form-points-mode");
  expect(mode).toHaveValue("result");
  fireEvent.change(mode, { target: { value: "maps" } });
  expect(screen.queryByTestId("season-form-points-win")).toBeNull();
  expect(screen.getByTestId("season-form-forfeit-score")).toBeDisabled();
  expect(screen.getByTestId("tiebreaker-wins")).toBeChecked();

  // Zurück auf Sieg/Remis/Niederlage: nur die Art, die Reihenfolge bleibt.
  fireEvent.change(screen.getByTestId("season-form-points-mode"), { target: { value: "result" } });
  expect(screen.getByTestId("season-form-points-win")).toHaveValue(3);
  expect(screen.getByTestId("tiebreaker-wins")).toBeChecked();
  expect(screen.getByTestId("season-form-forfeit-score")).not.toBeDisabled();

  // Wieder auf Map-Punkte und änderbar: „Entscheid der Leitung“ abwählen, dann speichern.
  fireEvent.change(screen.getByTestId("season-form-points-mode"), { target: { value: "maps" } });
  fireEvent.click(screen.getByTestId("tiebreaker-lead_decision"));
  fireEvent.click(within(panel("tabelle")).getByTestId("season-save-tabelle"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  const rules = apiMock.patch.mock.calls[0][1].scoring_rules;
  expect(rules).toMatchObject({ match_points_mode: "maps", table_tiebreakers: ["wins", "head_to_head", "score_diff"], forfeit_score: "best_of" });
  expect(rules.match_points).toEqual({ win: 3, draw: 1, loss: 0 });
});

test("Verwerfen setzt nur den Reiter zurück", async () => {
  renderPage("#termine");
  fireEvent.change(await screen.findByTestId("season-form-weeks"), { target: { value: "12" } });
  expect(within(panel("termine")).getByTestId("season-unsaved-termine")).toBeInTheDocument();
  fireEvent.click(within(panel("termine")).getByTestId("admin-form-cancel"));
  expect(screen.getByTestId("season-form-weeks")).toHaveValue(10);
  expect(screen.queryByTestId("season-tab-dirty-termine")).toBeNull();
});

// ---------------------------------------------------------------- Spielbetrieb: Modi an einer Stelle

test("Spielbetrieb: Modi der Season anhaken, Ergebnisregeln nur für sie, Hinweis wenn Reihenfolge und Pool nicht passen", async () => {
  const library = [{ id: "hafen", name: "Hafenkante", modes: ["snd", "stellung"] }];
  const pool = { id: "p1", version: 1, stale: false, outdated_map_ids: [], modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "hafen", name: "Hafenkante" }] }] };
  body = { ...BODY, library, map_pool: pool, season: { ...SEASON, game_mode_order: ["snd", "stellung", "snd"] } };
  extra["/admin/leagues/seasons/s1/result-rules"] = { scores_required: true, staffeln: 0, rules: [
    { mode: "snd", label: "Suchen & Zerstören", status: "active", season_rule: null, game_rule: null, differs: false },
    { mode: "stellung", label: "Stellung", status: "active", season_rule: null, game_rule: null, differs: false }] };
  renderPage("#spielbetrieb");
  expect(await screen.findByTestId("season-pool-pick-snd")).toBeChecked();
  expect(screen.getByTestId("season-pool-pick-stellung")).not.toBeChecked();
  expect(await screen.findByTestId("result-rules-snd")).toBeInTheDocument();
  expect(screen.queryByTestId("result-rules-stellung")).toBeNull();
  expect(screen.getByTestId("season-mode-order-hints")).toHaveTextContent("„Stellung“ steht in „Modus je Map“, hat aber keine Maps im Pool.");

  fireEvent.click(screen.getByTestId("season-pool-pick-stellung"));
  expect(await screen.findByTestId("result-rules-stellung")).toBeInTheDocument();
  // Ungespeicherter Pool: Punkt am Reiter.
  fireEvent.click(within(screen.getByTestId("season-pool-mode-stellung")).getByLabelText("Hafenkante in Stellung"));
  expect(screen.getByTestId("season-tab-dirty-spielbetrieb")).toBeInTheDocument();
  expect(screen.queryByTestId("season-mode-order-hints")).toBeNull();

  // Nur der Pool ist ungespeichert: Der Reiterwechsel fragt trotzdem - „Zurück zum Map-Pool“ bleibt, „Später speichern“ wechselt.
  confirmMock.mockResolvedValueOnce(true);
  fireEvent.click(screen.getByTestId("season-tab-termine"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Modi und Maps sind nicht gespeichert" })));
  expect(screen.getByTestId("season-tab-spielbetrieb")).toHaveAttribute("aria-selected", "true");
  confirmMock.mockResolvedValueOnce(false);
  fireEvent.click(screen.getByTestId("season-tab-termine"));
  await waitFor(() => expect(screen.getByTestId("season-tab-termine")).toHaveAttribute("aria-selected", "true"));
  expect(screen.getByTestId("season-tab-dirty-spielbetrieb")).toBeInTheDocument();
});

test("eine laufende Season mit alter, zu kurzer Reihenfolge lässt sich speichern - unverändert, mit Warnung (#2207)", async () => {
  const running = { ...SEASON, status: "active", game_mode_order: ["snd", "stellung"] };
  body = { ...BODY, season: running };
  apiMock.patch.mockResolvedValue({ data: { ...running, changed: ["team_size"], staffeln_to_sync: 0, warnings: ["Modus je Map: Die Reihenfolge hat 2 Einträge."] } });
  renderPage("#spielbetrieb");
  expect(await screen.findByTestId("season-mode-order-note")).toHaveTextContent("2 Einträge");
  fireEvent.change(screen.getByTestId("season-form-team-size"), { target: { value: "5" } });
  fireEvent.click(screen.getByTestId("season-save-spielbetrieb"));

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  expect(apiMock.patch.mock.calls[0][1].game_mode_order).toEqual(["snd", "stellung"]);
  expect(apiMock.patch.mock.calls[0][1].team_size).toBe(5);
  expect(toastMock.error).not.toHaveBeenCalled();
  await waitFor(() => expect(toastMock.warning).toHaveBeenCalledWith("Modus je Map: Die Reihenfolge hat 2 Einträge."));
});

test("Modus je Map halb gesetzt: nicht speichern, sondern sagen, was fehlt (#2207)", async () => {
  renderPage("#spielbetrieb");
  fireEvent.change(await screen.findByTestId("mode-order-0"), { target: { value: "snd" } });
  expect(screen.getByTestId("season-mode-order")).toHaveTextContent("Bitte für jede Map einen Modus wählen");
  fireEvent.click(screen.getByTestId("season-save-spielbetrieb"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalled());
  expect(apiMock.patch).not.toHaveBeenCalled();
});

test("„Modus je Map“ ist so lang wie die längste Serie einer Liga N (#2207)", async () => {
  body = { ...BODY, divisions: [{ ...BODY.divisions[0], overrides: { best_of: 5 } }] };
  renderPage("#spielbetrieb");
  expect(await screen.findByTestId("mode-order-4")).toBeInTheDocument();
});

// #2129, SP2: Ein entfernter Modus bleibt in der Reihenfolge sichtbar und gilt weiter, statt still auf „frei“ zu springen.
test("Modus je Map: ein Modus, den das Spiel nicht mehr hat, bleibt gesetzt und wird mitgeschickt", async () => {
  const pool = { id: "p1", version: 1, stale: false, outdated_map_ids: [], modes: [{ mode: "kontrolle", label: "Kontrolle", maps: [] }] };
  body = { ...BODY, season: { ...SEASON, game_mode_order: ["snd", "kontrolle", "snd"] }, map_pool: pool };
  renderPage("#spielbetrieb");
  const select = await screen.findByTestId("mode-order-1");
  expect(select).toHaveValue("kontrolle");
  expect([...select.options].map((option) => option.textContent)).toContain("Kontrolle (nicht mehr im Spiel)");
  fireEvent.change(screen.getByTestId("season-form-team-size"), { target: { value: "5" } });
  fireEvent.click(screen.getByTestId("season-save-spielbetrieb"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  expect(apiMock.patch.mock.calls[0][1].game_mode_order).toEqual(["snd", "kontrolle", "snd"]);
});

// #2206: Ein inaktiver Modus bleibt, wo die Season ihn hat; neu wählen lässt er sich nicht, ein archivierter fehlt ganz.
test("Modus je Map: inaktive nur, wo die Season sie schon hat", async () => {
  const game = { ...BODY.game, modes: [{ mode: "snd", label: "Suchen & Zerstören", status: "inactive" }, { mode: "stellung", label: "Stellung" },
    { mode: "alt", label: "Altmodus", status: "archived" }] };
  body = { ...BODY, game, season: { ...SEASON, game_mode_order: ["snd", "stellung", "snd"] } };
  const first = renderPage("#spielbetrieb");
  const select = await screen.findByTestId("mode-order-0");
  expect(select).toHaveValue("snd");
  expect([...select.options].map((option) => option.textContent)).toEqual(["frei", "Suchen & Zerstören (inaktiv)", "Stellung"]);
  body = { ...BODY, game };
  first.unmount();
  renderPage("#spielbetrieb");
  const fresh = await screen.findByTestId("mode-order-0");
  expect([...fresh.options].map((option) => option.textContent)).toEqual(["frei", "Stellung"]);
});

// ---------------------------------------------------------------- Termine, Anmeldung, Regelwerk

test("Termine: Kalender mit Sperrwochen", async () => {
  renderPage("#termine");
  expect(await screen.findByTestId("season-calendar")).toHaveTextContent("8 Spielwochen");
  expect(screen.getByTestId("season-calendar")).toHaveTextContent("höchstens 8 Teams");
  expect(screen.getByTestId("blocked-label-0")).toHaveValue("Weihnachtspause");
});

test("Anmeldung und Kader: Mindestkader steht beim Höchstkader, Meldeschluss nur ohne Anmeldefenster", async () => {
  renderPage("#anmeldung");
  fireEvent.change(await screen.findByTestId("season-form-min-squad"), { target: { value: "5" } });
  expect(screen.getByTestId("season-form-deadline")).toBeInTheDocument();
  fireEvent.change(screen.getByTestId("season-form-application-opens"), { target: { value: "2026-11-01T10:00" } });
  expect(screen.queryByTestId("season-form-deadline")).toBeNull();
  fireEvent.change(screen.getByTestId("season-form-application-opens"), { target: { value: "" } });
  fireEvent.click(screen.getByTestId("season-save-anmeldung"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  const sent = apiMock.patch.mock.calls[0][1];
  expect(sent.min_squad_size).toBe(5);
  expect(sent).not.toHaveProperty("weeks_total");
  expect(sent).not.toHaveProperty("visibility");
});

test("Regelwerk: kein Freitextfeld mehr - mit Regelwerk nur der Stand, ohne ein Hinweis und der alte Text zum Lesen", async () => {
  body = { ...BODY, season: { ...SEASON, rules_text: "## Alte Regeln" } };
  extra["/admin/league-rules/league_season/s1"] = { current: null, inherited: null, versions: [], draft: null, data_changes: null };
  const first = renderPage("#regelwerk");
  expect(await screen.findByTestId("season-rules-missing")).toBeInTheDocument();
  expect(screen.getByTestId("season-rules-legacy")).toHaveTextContent("## Alte Regeln");
  expect(screen.queryByTestId("season-form-rules")).toBeNull();
  expect(screen.getByTestId("season-rules-link")).toHaveAttribute("href", "/admin/leagues/rules/league_season/s1");
  first.unmount();

  extra["/admin/league-rules/league_season/s1"] = { current: { label: "Version 2", valid_from: "2026-11-01" }, inherited: null, versions: [{}], draft: null,
    data_changes: { label: "Version 2", rows: [{ block: "map_pool" }] } };
  renderPage("#regelwerk");
  await waitFor(() => expect(screen.getByTestId("season-rules-state")).toHaveTextContent("Gültig: Version 2, gilt ab 01.11.2026"));
  expect(screen.queryByTestId("season-rules-legacy")).toBeNull();
  expect(screen.queryByTestId("season-rules-missing")).toBeNull();
  // Im Überblick: „Regelwerk muss freigegeben werden“.
  fireEvent.click(screen.getByTestId("season-tab-ueberblick"));
  expect(await screen.findByTestId("season-rules-notice")).toHaveTextContent("Regelwerk muss freigegeben werden");
  expect(screen.getByTestId("season-rules-notice")).toHaveTextContent("1 Baustein");
});

// ---------------------------------------------------------------- Ligen und Staffeln

test("Ligen und Staffeln: Staffel mit Weg zur Turnierverwaltung, Vorgaben übertragen", async () => {
  apiMock.post.mockResolvedValue({ data: { staffeln: [{ tournament_id: "t1", title: "Staffel A", applied: ["always"], changed: ["rules"],
    skipped: [{ group: "before_start", label: "Termine und Kalender", reason: "Die Staffel hat schon begonnen." }] }] } });
  renderPage("#ligen");
  expect(await screen.findByTestId("staffel-manage-1-A")).toHaveAttribute("href", "/admin/tournaments/t1");
  expect(screen.getByTestId("staffel-1-A")).toHaveTextContent("3 von 8 Teams");
  fireEvent.click(screen.getByTestId("season-sync-run"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/sync"));
  const results = await screen.findByTestId("sync-results");
  expect(results).toHaveTextContent("1 Wert übernommen");
  expect(results).toHaveTextContent("Nicht übertragen – Termine und Kalender: Die Staffel hat schon begonnen.");
});

test("nach dem Speichern bietet die Seite das Übertragen an - in jedem Reiter", async () => {
  renderPage("#ligen");
  fireEvent.change(await screen.findByTestId("season-form-staffel-size"), { target: { value: "6" } });
  fireEvent.click(screen.getByTestId("season-save-ligen"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/admin/leagues/seasons/s1", { max_staffel_size: 6 }));
  apiMock.post.mockResolvedValue({ data: { staffeln: [{ tournament_id: "t1", title: "Staffel A", applied: ["always"], changed: ["rules"], skipped: [] }] } });
  fireEvent.click(await screen.findByTestId("season-sync-now"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/sync"));
  // Das Ergebnis steht dort, wo übertragen wurde - oben, nicht versteckt in einem anderen Reiter.
  expect(within(await screen.findByTestId("season-sync-top")).getByTestId("sync-results")).toHaveTextContent("Staffel A");
});

test("Staffel anlegen und Liga 2 mit eigener Teamgröße anlegen", async () => {
  apiMock.post.mockResolvedValueOnce({ data: { tournament_id: "t2", staffel: "B" } });
  renderPage("#ligen");
  fireEvent.click(await screen.findByTestId("staffel-add-1"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/divisions/d1/staffeln", {}));

  fireEvent.click(screen.getByTestId("division-add"));
  const sheet = screen.getByTestId("division-sheet");
  fireEvent.change(within(sheet).getByTestId("division-nickname"), { target: { value: "Elite" } });
  expect(within(sheet).getByTestId("division-nickname")).toBeInTheDocument();
  fireEvent.change(within(sheet).getByTestId("override-team-size"), { target: { value: "5" } });
  fireEvent.click(within(sheet).getByTestId("division-save"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/divisions", { nickname: "Elite", overrides: { team_size: 5 } }));
});

test("Beiname „Liga 1“: freundlicher Hinweis, dass die Stufe von selbst zählt (#2267)", async () => {
  body = { ...BODY, divisions: [{ ...BODY.divisions[0], nickname: "Liga 1", label: "Liga 1 · Liga 1" }] };
  renderPage("#ligen");
  expect(await screen.findByTestId("division-nickname-repeat-1")).toHaveTextContent("wiederholt die Stufe");
  fireEvent.click(screen.getByTestId("division-edit-1"));
  const sheet = screen.getByTestId("division-sheet");
  expect(within(sheet).getByTestId("division-nickname-repeat")).toHaveTextContent("„Liga 1 · Liga 1“");
  fireEvent.change(within(sheet).getByTestId("division-nickname"), { target: { value: "Elite" } });
  expect(within(sheet).queryByTestId("division-nickname-repeat")).toBeNull();
  expect(sheet).toHaveTextContent("Anzeige: „Liga 1 · Elite“");
});

// ---------------------------------------------------------------- Korrigieren, archivieren, löschen (#2106)

/** GET liefert die Season - und für `…/delete-plan` den angegebenen Plan (#2106). */
function withPlan(plan) {
  apiMock.get.mockImplementation((url) => (url.endsWith("/delete-plan") ? Promise.resolve({ data: plan }) : routeGet(url)));
}

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

test("409 beim Löschen: das Blatt holt den Plan neu und bietet Archivieren an", async () => {
  const deletable = { kind: "division", id: "d1", name: "Liga 1", deletable: true, blockers: [], archived: false, seasons: [], divisions: [],
    staffeln: [{ tournament_id: "t1", title: "Staffel A", staffel: "A" }] };
  const blockedPlan = { ...deletable, deletable: false, staffeln: [], blockers: ["Staffel A hat schon Co-Teams zugeteilt"] };
  let plans = 0;
  apiMock.get.mockImplementation((url) => (url.endsWith("/delete-plan") ? Promise.resolve({ data: plans++ ? blockedPlan : deletable }) : routeGet(url)));
  apiMock.delete.mockRejectedValue({ response: { status: 409, data: { detail: "Löschen geht nicht: Staffel A hat schon Co-Teams zugeteilt." } } });
  renderPage("#ligen");
  fireEvent.click(await screen.findByTestId("division-delete-1"));
  await screen.findByTestId("league-delete-list");
  fireEvent.change(screen.getByTestId("league-delete-reason"), { target: { value: "Doppelt angelegt" } });
  fireEvent.click(screen.getByTestId("league-delete-confirm"));
  expect(await screen.findByTestId("league-delete-blocked")).toHaveTextContent("Staffel A hat schon Co-Teams zugeteilt");
  expect(toastMock.error).toHaveBeenCalledWith("Löschen geht nicht: Staffel A hat schon Co-Teams zugeteilt.");
  expect(screen.getByTestId("league-delete-archive")).toBeEnabled();
});

test("Liga N mit gespielter Staffel: Archivieren statt löschen, mit Knopf", async () => {
  withPlan({ kind: "division", id: "d1", name: "Liga 1", deletable: false, archived: false, seasons: [], divisions: [], staffeln: [],
    blockers: ["Probe-Liga Season 1 · Liga 1 · Staffel A hat schon begonnen oder Spiele"] });
  apiMock.patch.mockResolvedValue({ data: { id: "d1", status: "archived" } });
  renderPage("#ligen");
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
  renderPage("#ligen");
  fireEvent.click(await screen.findByTestId("staffel-delete-1-A"));
  const list = await screen.findByTestId("league-delete-list");
  expect(list).toHaveTextContent("Die 3 zugeteilten Co-Teams werden dabei aus der Staffel genommen.");
  fireEvent.change(screen.getByTestId("league-delete-reason"), { target: { value: "Zu wenige Teams" } });
  fireEvent.click(screen.getByTestId("league-delete-confirm"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/leagues/staffeln/t1", { data: { reason: "Zu wenige Teams" } }));
  expect(apiMock.get).not.toHaveBeenCalledWith(expect.stringContaining("delete-plan"));
});

test("eine gestartete Staffel hat keinen Löschknopf - dort gilt Abgesagt oder Archiviert", async () => {
  body = { ...BODY, divisions: [{ ...BODY.divisions[0], staffeln: [{ ...BODY.divisions[0].staffeln[0], status: "live" }] }] };
  renderPage("#ligen");
  await screen.findByTestId("staffel-1-A");
  expect(screen.queryByTestId("staffel-delete-1-A")).toBeNull();
});

test("Liga N bearbeiten schickt den Stand mit, Antwortfrist je Liga N und als Season-Wert", async () => {
  apiMock.patch.mockResolvedValue({ data: {} });
  renderPage("#ligen");
  fireEvent.click(await screen.findByTestId("division-edit-1"));
  const sheet = screen.getByTestId("division-sheet");
  fireEvent.change(within(sheet).getByTestId("division-status"), { target: { value: "archived" } });
  fireEvent.change(within(sheet).getByTestId("override-response"), { target: { value: "24" } });
  fireEvent.click(within(sheet).getByTestId("division-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/admin/leagues/divisions/d1",
    { nickname: null, overrides: { match_schedule_response_hours: 24 }, status: "archived" }));

  apiMock.patch.mockResolvedValue({ data: { ...SEASON, changed: [], staffeln_to_sync: 0 } });
  fireEvent.click(screen.getByTestId("season-tab-termine"));
  // Season von vor #2106: das Feld ist leer und bleibt beim Speichern leer.
  expect(await screen.findByTestId("season-form-response")).toHaveValue(null);
  fireEvent.click(screen.getByTestId("season-save-termine"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenLastCalledWith("/admin/leagues/seasons/s1", expect.objectContaining({ match_schedule_response_hours: null })));
  await waitFor(() => expect(screen.getByTestId("season-save-termine")).toHaveTextContent("Termine speichern"));
  fireEvent.change(screen.getByTestId("season-form-response"), { target: { value: "48" } });
  fireEvent.click(screen.getByTestId("season-save-termine"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenLastCalledWith("/admin/leagues/seasons/s1", expect.objectContaining({ match_schedule_response_hours: 48 })));
});

const PLATFORM_VIEW = { settings: { platform_field: "platform", allowed_platforms: ["PC"], crossplay: null, input_device: null },
  fields: [{ key: "platform", label: "Plattform", options: ["PC", "PlayStation"], retired: [], required: true }], field_missing: false,
  input_devices: [], game: { id: "g1", name: "Probe Shooter" }, divisions: [] };

test("Plattform je Season (#2270): Abschnitt im Reiter Anmeldung und Kader, #plattform springt hin, gespeichert mit dem Reiter", async () => {
  body = { ...BODY, season: { ...SEASON, platform_field: "platform", allowed_platforms: ["PC"] } };
  extra["/admin/leagues/seasons/s1/platform"] = PLATFORM_VIEW;
  renderPage("#plattform");

  expect(await screen.findByTestId("season-tab-anmeldung")).toHaveAttribute("aria-selected", "true");
  expect(await screen.findByTestId("season-platform-allowed-PC")).toBeChecked();
  fireEvent.click(screen.getByTestId("season-platform-allowed-PlayStation"));
  fireEvent.change(screen.getByTestId("season-platform-crossplay"), { target: { value: "off" } });
  expect(screen.getByTestId("season-tab-dirty-anmeldung")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("season-save-anmeldung"));

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  expect(apiMock.patch.mock.calls[0][1]).toMatchObject({ platform_field: "platform", allowed_platforms: ["PC", "PlayStation"], crossplay: false, input_device: null });
  expect(apiMock.patch.mock.calls[0][1]).not.toHaveProperty("weeks_total");
});

test("Plattform je Season (#2270): Liga N weicht im Blatt ab und behält die Abweichung beim Speichern", async () => {
  body = { ...BODY, divisions: [{ ...BODY.divisions[0], overrides: { allowed_platforms: ["PlayStation"], crossplay: false } }] };
  extra["/admin/leagues/seasons/s1/platform"] = PLATFORM_VIEW;
  apiMock.patch.mockResolvedValue({ data: {} });
  renderPage("#ligen");

  fireEvent.click(await screen.findByTestId("division-edit-1"));
  const sheet = screen.getByTestId("division-sheet");
  expect(await within(sheet).findByTestId("override-platform-own")).toBeChecked();
  expect(within(sheet).getByTestId("override-platforms-PlayStation")).toBeChecked();
  fireEvent.change(within(sheet).getByTestId("override-best-of"), { target: { value: "5" } });
  fireEvent.click(within(sheet).getByTestId("division-save"));

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/admin/leagues/divisions/d1",
    { nickname: null, overrides: { best_of: 5, allowed_platforms: ["PlayStation"], crossplay: false }, status: "active" }));
});

test("Liga N in einer Map-Season (#2312, #2318): keine eigenen Punkte, ein alter Wert fällt beim Speichern weg", async () => {
  const mapRules = { ...RULES, match_points_mode: "maps" };
  body = { ...BODY, season: { ...SEASON, scoring_rules: mapRules },
    divisions: [{ ...BODY.divisions[0], overrides: { scoring_rules: { match_points: { win: 2, draw: 0, loss: 0 } } }, settings: { ...BODY.divisions[0].settings, scoring_rules: mapRules } }] };
  apiMock.patch.mockResolvedValue({ data: {} });
  renderPage("#ligen");
  fireEvent.click(await screen.findByTestId("division-edit-1"));
  const sheet = screen.getByTestId("division-sheet");
  expect(within(sheet).queryByTestId("override-points-win")).toBeNull();
  expect(within(sheet).getByTestId("override-points-maps")).toHaveTextContent("je gewonnene Map ein Punkt");
  fireEvent.click(within(sheet).getByTestId("division-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/admin/leagues/divisions/d1", { nickname: null, overrides: {}, status: "active" }));
});

test("Fehler beim Anlegen der Staffel steht als Meldung da", async () => {
  apiMock.post.mockRejectedValueOnce({ response: { data: { detail: "Mit bis zu 9 Teams braucht die Staffel 9 Spielwochen" } } });
  renderPage("#ligen");
  fireEvent.click(await screen.findByTestId("staffel-add-1"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Mit bis zu 9 Teams braucht die Staffel 9 Spielwochen"));
});

// Gestaltung und Gewinne (#2107): im Überblick; Season-Gewinne im Formular, eigene Gewinne je Liga N, Emblem/Banner der Liga als Erbe.
test("Gewinne der Season gehen mit „Überblick speichern“ mit, leere Zeilen fallen weg", async () => {
  apiMock.patch.mockResolvedValue({ data: { ...SEASON, changed: ["prizes"], staffeln_to_sync: 0 } });
  body = { ...BODY, league: { ...BODY.league, emblem_url: "/api/static/uploads/liga.png" },
    look: { emblem_url: "/api/static/uploads/liga.png", banner: null, accent_color: null } };
  renderPage();
  const look = await screen.findByTestId("season-look");
  expect(within(look).getByTestId("season-emblem-sizes").querySelector("img")).toHaveAttribute("src", expect.stringContaining("liga.png"));
  fireEvent.click(within(look).getByTestId("season-prizes-add"));
  fireEvent.change(within(look).getByTestId("season-prizes-text-0"), { target: { value: "Pokal und Trikot" } });
  fireEvent.click(within(look).getByTestId("season-prizes-add"));
  fireEvent.click(screen.getByTestId("season-save-ueberblick"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/admin/leagues/seasons/s1", expect.objectContaining({
    prizes: [{ place: 1, text: "Pokal und Trikot", image_url: null }], emblem_url: null, banner_url: null })));
});

test("Liga N: eigene Gewinne nur, wenn sie sich ändern; leer heißt wie die Season", async () => {
  apiMock.patch.mockResolvedValue({ data: {} });
  body = { ...BODY, season: { ...SEASON, prizes: [{ place: 1, text: "Pokal" }] } };
  renderPage("#ligen");
  fireEvent.click(await screen.findByTestId("division-edit-1"));
  const sheet = screen.getByTestId("division-sheet");
  expect(within(sheet).getByTestId("division-prizes")).toHaveTextContent("Wie die Season: 1. Pokal");
  fireEvent.click(within(sheet).getByTestId("division-prizes-add"));
  fireEvent.change(within(sheet).getByTestId("division-prizes-text-0"), { target: { value: "Aufstieg" } });
  fireEvent.click(within(sheet).getByTestId("division-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/admin/leagues/divisions/d1",
    { nickname: null, overrides: {}, status: "active", prizes: [{ place: 1, text: "Aufstieg", image_url: null }] }));
});

// ---------------------------------------------------------------- Zuständigkeiten (#2203)

test("Zuständigkeit „Regeln veröffentlichen“: Weg zum Regelwerk, kein Formular der Season", async () => {
  body = { ...BODY, capabilities: ["rules"] };
  renderPage("#regelwerk");
  expect(await screen.findByTestId("season-rules-link")).toHaveAttribute("href", "/admin/leagues/rules/league_season/s1");
  expect(screen.queryByTestId("season-tab-termine")).toBeNull();
  expect(screen.queryByTestId("season-tab-anmeldung")).toBeNull();
  for (const id of ["season-form-name", "season-form-visibility", "season-pool", "season-sync", "division-add", "season-delete", "season-form-rules"]) {
    expect(screen.queryByTestId(id), id).toBeNull();
  }
});

test("Zuständigkeit „Kader prüfen“: kein Formular, Liga N und Staffeln nur zum Ansehen, Kader im Reiter Anmeldung", async () => {
  body = { ...BODY, capabilities: ["roster"] };
  renderPage("#ligen");
  expect(await screen.findByTestId("season-divisions")).toBeInTheDocument();
  expect(screen.queryByTestId("season-form-ligen")).toBeNull();
  expect(screen.queryByTestId("season-rules-link")).toBeNull();
  for (const id of ["division-edit-1", "division-delete-1", "staffel-add-1", "staffel-delete-1-A", "season-delete"]) {
    expect(screen.queryByTestId(id), id).toBeNull();
  }
  expect(screen.getByTestId("staffel-manage-1-A")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("season-tab-anmeldung"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s1/roster"));
  expect(screen.queryByTestId("season-form-anmeldung")).toBeNull();
});

// Neue Season aus dem Vorgänger (F.2, #1627): Vorschau mit Teams je Liga, Anlegen mit Beginn, danach in die neue Season.
const SUCCESSOR = {
  season: { id: "s1", name: "Season 1" }, can_create: true, problems: [], successor: null, suggested: { number: 2, name: "Season 2" },
  copied: ["Spielbetrieb: Best of, Teamgröße"], dates_to_set: ["Beginn der ersten Spielwoche", "Sperrzeiten"], map_pool: { version: 3 }, loadout_bans: null,
  rules: { kind: "draft", label: "Version 2" }, carried: 2, relegation_note: "Relegationsplätze sind vorbereitet.",
  divisions: [{ level: 1, label: "Liga 1", zones_label: "oberste Liga: kein Aufstieg · 1 Absteiger", teams: [
    { squad_id: "q1", display_name: "Lions · Eins", movement: "stay", from_label: "Liga 1", from_staffel: "A", rank: 1 },
    { squad_id: "q2", display_name: "Falken · Eins", movement: "up", from_label: "Liga 2", from_staffel: "A", rank: 1 }] }],
  dropped: [{ registration_id: "r9", display_name: "Raben · Eins", reason: "Disqualifiziert", from_label: "Liga 1", from_staffel: "A", rank: 4 }],
};

test("Neue Season aus …: Vorschau mit Teams, Anlegen mit Beginn, danach die neue Season", async () => {
  extra = { "/admin/leagues/seasons/s1/successor": SUCCESSOR, "/admin/leagues/seasons/s2": { ...BODY, season: { ...SEASON, id: "s2", name: "Season 2" } } };
  apiMock.post.mockResolvedValueOnce({ data: { ok: true, replay: false, carried: 2, season: { id: "s2", name: "Season 2" } } });
  renderPage();
  fireEvent.click(await screen.findByTestId("season-successor"));
  const sheet = await screen.findByTestId("successor-sheet");
  expect(await within(sheet).findByTestId("successor-team-q2")).toHaveTextContent("Aufstieg · Liga 2 · Staffel A, Platz 1");
  expect(within(sheet).getByTestId("successor-dropped")).toHaveTextContent("Raben · Eins – Disqualifiziert");
  expect(within(sheet).getByTestId("successor-rules")).toHaveTextContent("Version 2 als Entwurf");
  expect(within(sheet).getByTestId("successor-create")).toBeDisabled();
  fireEvent.change(within(sheet).getByTestId("successor-start"), { target: { value: "2027-01-05" } });
  fireEvent.click(within(sheet).getByTestId("successor-create"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/successor", expect.objectContaining({ confirm: true })));
  expect(apiMock.post.mock.calls[0][1].start_date).toMatch(/^2027-01-0[45]T/);
  await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/admin/leagues/seasons/s2"));
  expect(await screen.findByRole("heading", { name: /Season 2/ })).toBeInTheDocument();
});

test("Neue Season aus …: nicht abgeschlossen - der Grund statt des Knopfs", async () => {
  extra = { "/admin/leagues/seasons/s1/successor": { ...SUCCESSOR, can_create: false, problems: ["Die Season ist noch nicht abgeschlossen."] } };
  renderPage();
  fireEvent.click(await screen.findByTestId("season-successor"));
  const sheet = await screen.findByTestId("successor-sheet");
  expect(await within(sheet).findByTestId("successor-problems")).toHaveTextContent("noch nicht abgeschlossen");
  expect(within(sheet).queryByTestId("successor-start")).toBeNull();
  expect(within(sheet).getByTestId("successor-create")).toBeDisabled();
});

test("Zonen je Liga N (F.2): Satz an der Liga, Ändern schickt nur geänderte Zonen", async () => {
  body = { ...BODY, divisions: [{ ...BODY.divisions[0], zones: { promote: 1, relegate: 1, playoff_promote: 0, playoff_relegate: 0 },
    zones_effective: { promote: 0, relegate: 0, playoff_promote: 0, playoff_relegate: 0, top: true, bottom: true } }] };
  apiMock.patch.mockResolvedValue({ data: {} });
  renderPage("#ligen");
  expect(await screen.findByTestId("division-zones-1")).toHaveTextContent("oberste Liga: kein Aufstieg · unterste Liga: kein Abstieg");
  fireEvent.click(screen.getByTestId("division-edit-1"));
  const sheet = screen.getByTestId("division-sheet");
  fireEvent.change(within(sheet).getByTestId("zones-relegate"), { target: { value: "2" } });
  fireEvent.click(within(sheet).getByTestId("division-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/admin/leagues/divisions/d1", expect.objectContaining({
    zones: { promote: 1, relegate: 2, playoff_promote: 0, playoff_relegate: 0 } })));
});
