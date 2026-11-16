import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ConfirmDialogProvider } from "@/components/tls/ConfirmDialog";

// Reiter „Spielplan“ der Staffel-Seite (#2262, Paket B): Spielwochen mit Frist und Herkunft des Termins, „Termin setzen“ nur mit
// „Spiele betreuen“, vor dem Start Vorschau mischen und Spieltage auslosen nur mit „Season konfigurieren“, CSV und PDF.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn() };
vi.mock("@/lib/api", () => ({
  API: "http://test.local/api",
  api: apiMock,
  formatApiError: (detail) => String(detail || "Fehler"),
  formatRequestError: (_error, fallback) => fallback,
  resolveMediaUrl: (value) => value || "",
}));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { StaffelScheduleTab } = await import("./StaffelScheduleTab");

const REGS = [{ id: "r1", display_name: "Nebelwölfe" }, { id: "r2", display_name: "Sturmfalken" }];
const slots = [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }];
const LIVE = { id: "t1", status: "live", league_context: { season_id: "s1", staffel: "A" }, can_plan_matches: true, can_manage_structure: true };
const MATCHES = [{ id: "m1", match_key: "L1-1", status: "scheduled", matchday_number: 1, slots }, { id: "m2", match_key: "L2-1", status: "completed", matchday_number: 2, slots }];
const WEEKS = {
  current: 1,
  matchdays: [
    { number: 1, starts_at: "2026-11-16T00:00:00Z", ends_at: "2026-11-22T22:59:00Z", matches: [{ match_id: "m1", scheduled_at: "2026-11-20T19:00:00Z", schedule_source: "manual" }] },
    { number: 2, starts_at: "2026-11-23T00:00:00Z", ends_at: "2026-11-29T22:59:00Z", matches: [{ match_id: "m2", scheduled_at: "2026-11-27T19:00:00Z", schedule_source: "accepted" }] },
  ],
};

function serve({ weeks = WEEKS, stages = [], failWeeks = false } = {}) {
  apiMock.get.mockImplementation((url) => {
    const path = String(url);
    if (path.endsWith("/matchdays")) return failWeeks ? Promise.reject(new Error("weg")) : Promise.resolve({ data: weeks });
    if (path.endsWith("/stages")) return Promise.resolve({ data: stages });
    return Promise.resolve({ data: {} });
  });
}

function renderTab(tournament = LIVE, matches = MATCHES) {
  const onReload = vi.fn().mockResolvedValue();
  render(
    <ConfirmDialogProvider>
      <MemoryRouter><StaffelScheduleTab tournament={tournament} registrations={REGS} matches={matches} onReload={onReload} /></MemoryRouter>
    </ConfirmDialogProvider>,
  );
  return onReload;
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.post.mockResolvedValue({ data: { match_count: 6 } });
  apiMock.patch.mockResolvedValue({ data: {} });
  serve();
});

test("Spielwochen mit Frist und Herkunft des Termins in Liga-Wörtern, CSV und PDF", async () => {
  renderTab();
  const week = await screen.findByTestId("mp-week-1");
  expect(week).toHaveTextContent("Spielwoche 1");
  expect(week).toHaveTextContent("läuft");
  expect(week).toHaveTextContent("von der Liga-Leitung");
  expect(week).not.toHaveTextContent("Turnierleitung");
  expect(screen.getByTestId("mp-week-2")).toHaveTextContent("gespielt");
  expect(screen.getByTestId("staffel-csv-matchplan")).toHaveAttribute("href", "http://test.local/api/tournaments/t1/match-plan.csv");
  expect(screen.getByTestId("staffel-pdf-matches")).toHaveAttribute("href", "http://test.local/api/exports/tournaments/t1/matches.pdf");
  expect(screen.getByTestId("staffel-season-dates")).toHaveAttribute("href", "/admin/leagues/seasons/s1#termine");
  // Vor dem Start gibt es die Werkzeuge der Vorschau, danach nicht mehr.
  expect(screen.queryByTestId("staffel-remix")).toBeNull();
});

test("Termin setzen mit „Spiele betreuen“: PATCH auf das Spiel, danach neu laden", async () => {
  const user = userEvent.setup();
  const onReload = renderTab();
  const week = await screen.findByTestId("mp-week-1");
  const toggle = within(week).getByRole("button", { name: "L1-1 ändern" });
  expect(toggle.className).toContain("mp-btn--touch");
  await user.click(toggle);
  const editor = await screen.findByTestId("mp-editor");
  expect(within(editor).queryByLabelText("Station")).toBeNull();
  await user.click(within(editor).getByRole("button", { name: "Speichern" }));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/matches/m1", expect.objectContaining({ duration_minutes: null })));
  await waitFor(() => expect(onReload).toHaveBeenCalled());
  // Gespielte Partien ändert niemand.
  expect(within(screen.getByTestId("mp-week-2")).queryByRole("button", { name: "L2-1 ändern" })).toBeNull();
});

test("ohne „Spiele betreuen“ und im eigenen Spiel kein „ändern“", async () => {
  renderTab({ ...LIVE, can_plan_matches: false });
  const week = await screen.findByTestId("mp-week-1");
  expect(within(week).queryByRole("button", { name: "L1-1 ändern" })).toBeNull();
});

test("im eigenen Spiel setzt eine zweite Person den Termin - der Satz steht darunter", async () => {
  renderTab(LIVE, [{ ...MATCHES[0], viewer_involved: true, viewer_override: false }, MATCHES[1]]);
  const week = await screen.findByTestId("mp-week-1");
  expect(within(week).queryByRole("button", { name: "L1-1 ändern" })).toBeNull();
  expect(screen.getByTestId("staffel-own-matches")).toHaveTextContent("zweite Person");
});

test("Spielwochen nicht ladbar: sichtbarer Hinweis statt leerer Fläche", async () => {
  serve({ failWeeks: true });
  renderTab();
  expect(await screen.findByTestId("mp-remote-error")).toHaveTextContent("Spielwochen konnten nicht geladen werden");
});

test("vor dem Start mit „Season konfigurieren“: Vorschau neu mischen mit Rückfrage, Spieltage neu auslosen", async () => {
  const user = userEvent.setup();
  const preview = [
    { id: "p1", is_preview: true, status: "pending", matchday_number: 1, slots, settings: { randomize_advancement_rounds: true } },
    { id: "p2", is_preview: true, status: "pending", matchday_number: 2, slots, settings: { randomize_advancement_rounds: true } },
  ];
  serve({ stages: [{ id: "st1", stage_type: "league" }] });
  const onReload = renderTab({ ...LIVE, status: "draft" }, preview);
  expect(screen.getByTestId("staffel-preview-tools")).toHaveTextContent("Die Vorschau hat 2 Spiele.");
  expect(await screen.findByTestId("redraw-league")).toHaveTextContent("Spieltage neu auslosen");
  expect(apiMock.get).not.toHaveBeenCalledWith("/tournaments/t1/matchdays");
  await user.click(screen.getByTestId("staffel-remix"));
  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent("Vorschau neu mischen?");
  await user.click(within(dialog).getByRole("button", { name: "Neu mischen" }));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/tournaments/t1/bracket/from-format?preview=true&force=true"));
  await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Vorschau mit 6 Spielen neu gemischt."));
  expect(onReload).toHaveBeenCalled();
});

test("vor dem Start ohne „Season konfigurieren“: nur der Satz, keine Knöpfe", () => {
  renderTab({ ...LIVE, status: "draft", can_manage_structure: false }, []);
  expect(screen.getByTestId("staffel-preview-note")).toHaveTextContent("Season konfigurieren");
  expect(screen.queryByTestId("staffel-remix")).toBeNull();
  expect(screen.queryByTestId("redraw-league")).toBeNull();
  expect(apiMock.get).not.toHaveBeenCalledWith("/tournaments/t1/stages");
});
