import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Turnier bearbeiten (#1938): „Planung prüfen“ warnt bei widersprüchlichen Zeiten - wie beim Anlegen. Gespeichert wird
// trotzdem; die Warnung sagt nur, was nicht zusammenpasst.

const apiMock = { get: vi.fn(() => Promise.resolve({ data: [] })), patch: vi.fn(), post: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (e, f) => f || String(e), formatRequestError: (_e, f) => f, resolveMediaUrl: (u) => u }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => ({ can: () => false }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true, usePrompt: () => async () => null }));

const { TournamentEditForm } = await import("./TournamentEditForm");

const BASE = { id: "t-1", title: "Probe-Cup", status: "check_in", format: "single_elim", team_mode: "solo", start_date: "2026-10-31T17:00:00+00:00" };

test("Check-in endet vor seiner Öffnung: die Warnung steht bei den Zeiten", async () => {
  render(<TournamentEditForm tournament={{ ...BASE, check_in_from: "2026-10-31T16:50:00+00:00", check_in_until: "2026-10-31T16:30:00+00:00" }} onSaved={() => {}} />);
  expect(await screen.findByTestId("tr-edit-planning-warnings")).toHaveTextContent("Der Check-in endet vor seiner Öffnung.");
});

test("stimmige Zeiten: keine Warnung - sie erscheint, sobald das Ende vor den Beginn rutscht", async () => {
  render(<TournamentEditForm tournament={{ ...BASE, check_in_from: "2026-10-31T16:00:00+00:00", check_in_until: "2026-10-31T16:45:00+00:00" }} onSaved={() => {}} />);
  const until = await screen.findByTestId("tr-edit-checkin-until");
  expect(screen.queryByTestId("tr-edit-planning-warnings")).toBeNull();
  fireEvent.change(until, { target: { value: "2026-10-31T19:30" } });
  expect(screen.getByTestId("tr-edit-planning-warnings")).toHaveTextContent("Der Check-in endet nach dem Turnierstart.");
});

// Liga-Staffel (#2109): was die Season vorgibt, steht nur lesend da; was es in der Liga nicht gibt, fehlt. Seit #2106
// gehört auch die Antwortfrist auf Terminvorschläge dazu. Das Feld „Status“ gibt es im Formular nicht mehr (alle Turniere).
const STAFFEL = {
  id: "t-s", title: "Probe-Liga Season 1 · Liga 1 · Staffel A", status: "draft", format: "league", team_mode: "team",
  team_size: 4, best_of: 3, max_participants: 8, min_participants: 2, start_date: "2026-11-09T23:00:00+00:00",
  matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", match_schedule_response_hours: 72,
  result_confirm_hours_league: 48, visibility: "internal", is_public: false, rules: "Fair spielen.",
  registration_enabled: false, discord_registration: false, discord_skip: true, season_weight: 0,
  league_context: { league_id: "l-1", season_id: "s-1", division_id: "d-1", staffel: "A" },
};

function renderStaffel(tournament = STAFFEL) {
  return render(<MemoryRouter><TournamentEditForm tournament={tournament} onSaved={() => {}} /></MemoryRouter>);
}

test("kein Statusfeld mehr im Formular - der Status steht nur oben", async () => {
  render(<TournamentEditForm tournament={BASE} onSaved={() => {}} />);
  await screen.findByTestId("tr-edit-title");
  expect(screen.queryByLabelText("Status")).toBeNull();
});

test("Staffel: Season-Werte nur lesend mit Weg zur Season, Liga-fremde Felder fehlen", async () => {
  renderStaffel();
  const values = await screen.findByTestId("tr-edit-season-values");
  expect(values).toHaveTextContent("Aus der Season");
  expect(screen.getByTestId("tr-edit-season-bo")).toHaveTextContent("Best of 3");
  expect(screen.getByTestId("tr-edit-season-team-size")).toHaveTextContent("4");
  expect(screen.getByTestId("tr-edit-season-default-match")).toHaveTextContent("Sonntag · 20:00");
  expect(screen.getByTestId("tr-edit-season-rules")).toHaveTextContent("Fair spielen.");
  expect(within(values).getByRole("link", { name: "Season öffnen" })).toHaveAttribute("href", "/admin/leagues/seasons/s-1");
  for (const testId of ["tr-edit-start", "tr-edit-reg-from", "tr-edit-checkin-from", "tr-edit-discord-registration", "tr-edit-auto-start",
    "tr-edit-discord-skip", "tr-edit-team-size", "tr-edit-max", "tr-edit-min", "tr-edit-bo", "tr-edit-season-weight", "tr-edit-advancement",
    "tr-edit-matchday-days", "tr-edit-matchday-time", "tr-edit-rules", "tr-edit-prizes", "tr-edit-create-prizes", "tr-edit-award-1",
    "tr-edit-deadlines", "tr-edit-discord", "tr-edit-save-rebuild"]) {
    expect(screen.queryByTestId(testId)).toBeNull();
  }
  for (const label of ["Turnierstruktur", "Teilnahme", "Spiel", "Sichtbarkeit", "Austragung", "Ergebniserfassung", "Terminplanung", "Seeding"]) {
    expect(screen.queryByLabelText(label)).toBeNull();
  }
  expect(screen.getByTestId("tr-edit-staffel-remix")).toHaveTextContent("Vorschau neu mischen");
});

test("Staffel: die Antwortfrist auf Terminvorschläge kommt seit #2106 aus der Season - nur lesend", async () => {
  apiMock.patch.mockResolvedValue({ data: {} });
  renderStaffel({ ...STAFFEL, match_schedule_response_hours: 24 });
  expect(await screen.findByTestId("tr-edit-season-response")).toHaveTextContent("24 Std.");
  expect(screen.queryByTestId("tr-edit-response-hours")).toBeNull();
  expect(screen.queryByTestId("tr-edit-staffel-matchdays")).toBeNull();
  fireEvent.change(screen.getByTestId("tr-edit-title"), { target: { value: "Staffel A (Probe)" } });
  fireEvent.click(screen.getByTestId("tr-edit-save"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalledWith("/tournaments/t-s", { title: "Staffel A (Probe)" }));
});

test("Staffel nach dem Start: kein Neu-Mischen mehr", async () => {
  renderStaffel({ ...STAFFEL, status: "live" });
  await screen.findByTestId("tr-edit-season-values");
  expect(screen.queryByTestId("tr-edit-staffel-remix")).toBeNull();
  expect(screen.queryByTestId("tr-edit-save-rebuild")).toBeNull();
});
// Gewinne erst nach dem Ergebnis (#2123, TA23): vor „Beendet“ ist der Knopf gesperrt und sagt warum.
test("„Gewinne erzeugen“ erst ab Beendet", async () => {
  const prizes = [{ group: "overall", place: 1, label: "1. Platz", value: "Pokal" }];
  const { unmount } = render(<TournamentEditForm tournament={{ ...BASE, status: "live", prize_places: prizes }} onSaved={() => {}} />);
  expect(await screen.findByTestId("tr-edit-create-prizes")).toBeDisabled();
  expect(screen.getByTestId("tr-edit-create-prizes-hint")).toHaveTextContent("sobald das Turnier beendet ist");
  unmount();
  render(<TournamentEditForm tournament={{ ...BASE, status: "completed", prize_places: prizes }} onSaved={() => {}} />);
  expect(await screen.findByTestId("tr-edit-create-prizes")).toBeEnabled();
  expect(screen.getByTestId("tr-edit-create-prizes-hint")).toHaveTextContent("Sonderpreise vergebt ihr dort von Hand");
});
