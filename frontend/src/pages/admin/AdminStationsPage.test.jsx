import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ConfirmDialogProvider } from "@/components/tls/ConfirmDialog";

// Spielplaner (#1552): „Zeitplan füllen“ auf der Stationsseite geht denselben Weg wie „Planen“ im Turnier -
// Vorschau, Dialog, erst „Übernehmen“ schreibt. Der alte Sofort-Planer (auto-assign?plan=true) wird nicht mehr gerufen.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };

vi.mock("@/lib/api", () => ({
  API: "http://test.local/api",
  api: apiMock,
  formatApiError: (error, fallback) => fallback || String(error),
  formatRequestError: (error, fallback) => fallback || String(error),
  resolveMediaUrl: (value) => value || "",
}));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ isTournamentLead: true, user: { id: "admin-1" }, can: () => true }) }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const liveRefresh = vi.fn();
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: (...args) => { liveRefresh(...args); return true; } }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div data-testid="admin-layout">{children}</div> }));
vi.mock("@/components/tls/results/ResultWindow", () => ({ ResultWindowLoader: () => null }));
vi.mock("@/components/tls/results/ResultUndoBar", () => ({ ResultUndoBar: () => null, useResultUndo: () => ({ pending: null, show: () => {} }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() } }));

const { default: AdminStationsPage } = await import("./AdminStationsPage");

const MATCH = { id: "m1", match_key: "A1", status: "ready", station_id: null, round: 1, slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }] };

function routeFor(url) {
  if (url.startsWith("/tournaments?")) return { data: [{ id: "t-1", title: "Winter Cup", status: "live" }] };
  if (url.includes("/stations")) return { data: [{ id: "st-1", name: "1", device_type: "switch2", status: "free", current_match_id: null }] };
  if (url.includes("/bracket")) return { data: { tournament: { id: "t-1", title: "Winter Cup" }, matches_v2: [MATCH], registrations: [] } };
  return { data: [] };
}

beforeEach(() => {
  apiMock.get.mockImplementation((url) => Promise.resolve(routeFor(String(url))));
  apiMock.post.mockImplementation((url) => {
    if (String(url).includes("/schedule/plan")) {
      return Promise.resolve({ data: { mode: "stations", fingerprint: "fp-1", planned_at: "2026-10-31T09:58:00+00:00", warnings: [], assignments: [
        { match_id: "m1", label: "A1", scheduled_at: "2026-10-31T10:00:00+00:00", station_name: "1", forecast: false, changed: true },
      ] } });
    }
    return Promise.resolve({ data: { written: 1 } });
  });
});

test("„Zeitplan füllen“ zeigt die Vorschau und schreibt erst nach „Übernehmen“ mit dem Fingerabdruck", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><ConfirmDialogProvider><AdminStationsPage /></ConfirmDialogProvider></MemoryRouter>);
  const button = await screen.findByTestId("stations-plan-schedule");
  await waitFor(() => expect(button).not.toBeDisabled());

  await user.click(button);

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(expect.stringContaining("/tournaments/t-1/schedule/plan")));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("1 Spiel bekommt Zeit und Station");
  expect(apiMock.post.mock.calls.some(([url]) => String(url).includes("auto-assign"))).toBe(false);

  await user.click(screen.getByRole("button", { name: "Übernehmen" }));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith(
    expect.stringContaining("/tournaments/t-1/schedule/apply"),
    expect.objectContaining({ fingerprint: "fp-1", planned_at: "2026-10-31T09:58:00+00:00" })
  ));
  expect(apiMock.post.mock.calls.some(([url]) => String(url).includes("auto-assign"))).toBe(false);
});

// Codex zu #1578: ohne eingefrorene Dauer rechnet die Stationsseite mit derselben Kette wie der Rest der Website.
test("offene Spiele zeigen die Dauer aus Turnier oder Spiel, auch ohne eigenen Wert", async () => {
  const game = { match_modes: [{ mode: "gp4", label: "Grand Prix", minutes: 12 }], setup_minutes: 3 };
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.includes("/bracket")) {
      return Promise.resolve({ data: {
        tournament: { id: "t-1", title: "Winter Cup", match_duration_minutes: null },
        stages: [{ id: "s1", settings: {} }],
        duration_game: game,
        matches_v2: [{ ...MATCH, stage_id: "s1" }, { ...MATCH, id: "m2", match_key: "A2", stage_id: "s1", duration_minutes: 20 }],
        registrations: [],
      } });
    }
    return Promise.resolve(routeFor(path));
  });
  render(<MemoryRouter><ConfirmDialogProvider><AdminStationsPage /></ConfirmDialogProvider></MemoryRouter>);
  expect(await screen.findByTestId("match-unassigned-m1")).toHaveTextContent("15 Min.");
  expect(screen.getByTestId("match-unassigned-m2")).toHaveTextContent("20 Min.");
});


// Stationen-Seite (#1557): alle Spieler eines Laufs, Belegung als Zeitleiste (dieselbe wie im Matchplan), live.
function withMatches(matches, registrations = []) {
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.includes("/bracket")) {
      return Promise.resolve({ data: { tournament: { id: "t-1", title: "Winter Cup", event_mode: "local" }, stages: [], matches_v2: matches, registrations } });
    }
    return Promise.resolve(routeFor(path));
  });
}

test("ein Lauf zeigt alle Spieler, nicht nur die ersten vier", async () => {
  const registrations = Array.from({ length: 6 }, (_, index) => ({ id: `r${index + 1}`, display_name: `Fahrer ${index + 1}` }));
  withMatches([{ ...MATCH, slots: registrations.map((reg, index) => ({ slot: index + 1, registration_id: reg.id })) }], registrations);
  render(<MemoryRouter><ConfirmDialogProvider><AdminStationsPage /></ConfirmDialogProvider></MemoryRouter>);
  const row = await screen.findByTestId("match-unassigned-m1");
  expect(row).toHaveTextContent("Fahrer 5");
  expect(row).toHaveTextContent("Fahrer 6");
});

test("Belegung je Station als Zeitleiste - dieselbe wie im Matchplan, mit Weg dorthin", async () => {
  withMatches([{ ...MATCH, status: "scheduled", station_id: "st-1", scheduled_at: "2026-10-31T10:00:00+00:00", schedule_source: "planner" }]);
  render(<MemoryRouter><ConfirmDialogProvider><AdminStationsPage /></ConfirmDialogProvider></MemoryRouter>);
  expect(await screen.findByTestId("mp-lane-st-1")).toBeInTheDocument();
  expect(screen.getByTestId("mp-bar-A1")).toHaveAttribute("data-state", "planned");
  expect(screen.getByRole("link", { name: "Im Matchplan öffnen" })).toHaveAttribute("href", "/admin/tournaments/t-1?tab=matchplan");
});

test("Stationen und Spiele bleiben live: Änderungsstrom mit Ersatz-Takt", async () => {
  render(<MemoryRouter><ConfirmDialogProvider><AdminStationsPage /></ConfirmDialogProvider></MemoryRouter>);
  await screen.findByTestId("stations-plan-schedule");
  const resources = liveRefresh.mock.calls.map(([, list, options]) => ({ list: list.join(","), fallback: options?.fallbackMs }));
  expect(resources).toContainEqual({ list: "stations,matches,tournaments", fallback: 15000 });
});
