import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Gesamtwertung verwalten (F.5, #2215): Einstellungen speichern nur ihre Felder, Zeiträume mit „höchstens einem Zeitraum je Season“,
// Abschluss mit Sperrgründen, Gleichstand und Bestätigung, Lesen ohne Recht ohne Knöpfe. Nur erfundene Namen.
const apiMock = { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API: "/api", resolveMediaUrl: (url) => url || "", formatApiError: (d) => String(d || "Fehler") }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ user: { id: "a1", role: "superadmin" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const { default: AdminLeagueOverallPage } = await import("./AdminLeagueOverallPage");

const SETTINGS = {
  league: { id: "l1", name: "Probe-Liga", slug: "probe-liga" }, can_edit: true, enabled: true,
  settings: { points_mode: "teams", points_table: [], champion_bonus: 2, counting: "all", best_count: null, tiebreakers: ["wins", "best_place", "latest"], reward_players: "fielded" },
  rewards: [], periods: [{ id: "p1", name: "2027", season_ids: ["s1"], closed_levels: [] }],
  seasons: [{ id: "s1", name: "Season 1", number: 1, visibility: "public" }, { id: "s2", name: "Season 2", number: 2, visibility: "off" }],
};
const row = (key, name, place, total, extra = {}) => ({ key, name, team_id: null, place, total, tie: false, wins: 0, lead_decision: null, climbed: false,
  seasons: [{ season_id: "s1", played: true, points: total, place, of: 2, counted: true, champion: place === 1 }], ...extra });
const COCKPIT = {
  period: { id: "p1", name: "2027" }, seasons: [{ id: "s1", name: "Season 1" }], can_act: true, superadmin: false, methods: {},
  settings: { points_mode: "teams", champion_bonus: 2, counting: "all", tiebreakers: [] },
  levels: [{ level: 1, label: "Liga 1", closed: false, final: null, season_ids: ["s1"], blockers: [
    { code: "leader_tie", label: "Gleichstand auf Platz 1", text: "Wer gewinnt, steht nicht fest.", count: 1, items: [{ text: "Nordlicht – Sturmfalken" }] }],
  teams: [row("squad:a", "Nordlicht", 1, 4, { tie: true }), row("squad:b", "Sturmfalken", 1, 4, { tie: true })], players: [],
  ties: [{ place: 1, keys: ["squad:a", "squad:b"], names: ["Nordlicht", "Sturmfalken"], total: 4, own_team: false }], decisions: [],
  own_team: false, closed_by_me: false, rewards: 0, can_close: false, can_reopen: false, can_decide: true, history: [] }],
};

function renderPage(hash = "") {
  return render(
    <MemoryRouter initialEntries={[`/admin/leagues/l1/gesamtwertung${hash}`]}>
      <Routes><Route path="/admin/leagues/:leagueId/gesamtwertung" element={<AdminLeagueOverallPage />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  Object.values(apiMock).forEach((fn) => fn.mockReset());
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/overall") ? SETTINGS : COCKPIT }));
  apiMock.put.mockImplementation((_url, body) => Promise.resolve({ data: { ...SETTINGS, settings: { ...SETTINGS.settings, ...body } } }));
  apiMock.post.mockResolvedValue({ data: { ok: true, rewards: 0 } });
});

test("Einstellungen: eigene Punkte und beste X - gespeichert werden nur die Punkte-Felder", async () => {
  renderPage();
  const panel = await screen.findByTestId("overall-panel-einstellungen");
  expect(within(panel).getByTestId("overall-settings-save")).toBeDisabled();
  fireEvent.click(within(panel).getByTestId("overall-points-mode-table"));
  expect(within(panel).getByTestId("overall-settings-bar")).toHaveTextContent("mindestens Platz 1");
  fireEvent.click(within(panel).getByTestId("overall-points-add"));
  fireEvent.click(within(panel).getByTestId("overall-counting-best"));
  fireEvent.change(within(panel).getByTestId("overall-best"), { target: { value: "3" } });
  fireEvent.click(within(panel).getByTestId("overall-settings-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
  const [url, body] = apiMock.put.mock.calls[0];
  expect(url).toBe("/admin/leagues/l1/overall");
  expect(body).toMatchObject({ points_mode: "table", points_table: [0], counting: "best", best_count: 3 });
  // Gegenprobe: Zeiträume und Belohnungen bleiben unberührt.
  expect(body).not.toHaveProperty("periods");
  expect(body).not.toHaveProperty("rewards");
});

test("Zeiträume: eine Season in einem anderen Zeitraum ist gesperrt", async () => {
  renderPage("#zeitraeume");
  const panel = await screen.findByTestId("overall-panel-zeitraeume");
  fireEvent.click(within(panel).getByTestId("overall-period-add"));
  expect(within(panel).getByTestId("overall-period-1-season-1")).toBeDisabled();
  expect(panel).toHaveTextContent("in „2027“");
  expect(within(panel).getByTestId("overall-periods-bar")).toHaveTextContent("Namen");
  fireEvent.change(within(panel).getByTestId("overall-period-name-1"), { target: { value: "2028" } });
  fireEvent.click(within(panel).getByTestId("overall-period-1-season-2"));
  fireEvent.click(within(panel).getByTestId("overall-periods-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
  expect(apiMock.put.mock.calls[0][1]).toEqual({ periods: [{ id: "p1", name: "2027", season_ids: ["s1"] }, { name: "2028", season_ids: ["s2"] }] });
});

test("Abschluss: Sperrgrund, Gleichstand entscheiden und Knopf gesperrt", async () => {
  renderPage("#abschluss");
  const card = await screen.findByTestId("overall-level-1");
  expect(within(card).getByTestId("overall-level-1-state")).toHaveTextContent("Noch offen");
  expect(within(card).getByTestId("overall-level-1-blocker-leader_tie")).toHaveTextContent("Nordlicht – Sturmfalken");
  expect(within(card).getByTestId("overall-level-1-close")).toBeDisabled();
  fireEvent.click(within(card).getByTestId("overall-level-1-decide-1"));
  const sheet = await screen.findByTestId("overall-decide-sheet");
  fireEvent.click(within(sheet).getByRole("button", { name: "Sturmfalken nach oben" }));
  fireEvent.change(within(sheet).getByTestId("overall-decide-method"), { target: { value: "lot" } });
  fireEvent.change(within(sheet).getByTestId("overall-decide-reason"), { target: { value: "Los gezogen" } });
  fireEvent.click(within(sheet).getByTestId("overall-decide-confirm"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalled());
  expect(apiMock.put.mock.calls[0]).toEqual(["/admin/leagues/l1/overall/p1/levels/1/decision", { keys: ["squad:b", "squad:a"], method: "lot", reason: "Los gezogen" }]);
});

test("Abschluss bestätigen schickt die Bestätigung; ohne Recht keine Knöpfe", async () => {
  const ready = { ...COCKPIT, levels: [{ ...COCKPIT.levels[0], blockers: [], ties: [], can_close: true, teams: [row("squad:a", "Nordlicht", 1, 6)] }] };
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/overall") ? SETTINGS : ready }));
  const view = renderPage("#abschluss");
  fireEvent.click(await screen.findByTestId("overall-level-1-close"));
  const sheet = await screen.findByTestId("overall-close-sheet");
  expect(within(sheet).getByTestId("overall-close-leader")).toHaveTextContent("Nordlicht");
  fireEvent.click(within(sheet).getByTestId("overall-close-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/l1/overall/p1/levels/1/close", { confirm: true }));
  view.unmount();
  apiMock.get.mockImplementation((url) => Promise.resolve({ data: url.endsWith("/overall") ? { ...SETTINGS, can_edit: false } : { ...ready, can_act: false } }));
  renderPage("#abschluss");
  const card = await screen.findByTestId("overall-level-1");
  expect(within(card).queryByTestId("overall-level-1-close")).toBeNull();
  expect(card).toHaveTextContent("„Season konfigurieren“");
});
