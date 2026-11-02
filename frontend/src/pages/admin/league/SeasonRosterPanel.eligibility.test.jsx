import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { seasonPayload, seasonToForm } from "@/lib/league";

// Spielberechtigung in der Kaderübersicht (#2204): Stand, Wartezeit aufheben, Transfers entscheiden. Erfundene Namen.

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/api", () => ({
  api: { get: (...args) => get(...args), post: (...args) => post(...args), put: vi.fn() },
  formatApiError: (value) => value || "Fehler",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("./SquadKaderSheet", () => ({ SquadKaderSheet: () => null }));

const { SeasonRosterPanel } = await import("./SeasonRosterPanel");

const player = (id, name, eligibility) => ({ id, name, state: "locked", ok: true, text: `${name}#1`, profile_text: `${name}#1`, changed: false, approvals: [], eligibility });
const ROSTER = {
  season: { id: "s1" },
  rules: { min_squad_size: 3, max_squad_size: 50, one_team_per_season: true, min_age: 18, new_player_wait_days: 7, transfer_windows: [], transfer_open: false },
  fields: [{ key: "id", label: "Spiel-ID" }],
  counts: { waiting: 1, age: 1 },
  squads: [{
    registration_id: "r1", squad_id: "sq1", display_name: "Loewen · Rudel A", staffel_label: "Liga 1",
    players: [
      player("u1", "Mila", { state: "waiting", ok: false, reason: "Neu im Kader: darf ab 09.11.2026, 12:00 spielen.", until: "2026-11-09T11:00:00+00:00", age: "met" }),
      player("u2", "Tom", { state: "age_missing", ok: false, reason: "Geburtsdatum fehlt.", until: null, age: "missing" }),
      player("u3", "Ida", { state: "locked", ok: true, reason: null, until: null, age: "met" }),
    ],
  }],
};
const TRANSFERS = [
  { id: "t1", status: "pending", user_name: "Rio", from_squad_name: "Rudel B", to_squad_name: "Rudel A" },
  { id: "t2", status: "rejected", user_name: "Lea", reason: "Kein Grund", decided_at: "2026-11-01T10:00:00+00:00" },
];

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  get.mockImplementation(async (url) => ({ data: url.endsWith("/transfers") ? { items: TRANSFERS } : ROSTER }));
  post.mockResolvedValue({ data: {} });
});

test("zeigt den Stand ohne Datum und zählt", async () => {
  render(<SeasonRosterPanel seasonId="s1" />);

  const waiting = await screen.findByTestId("roster-eligibility-u1");
  expect(waiting.textContent).toContain("darf ab");
  expect(screen.getByTestId("roster-eligibility-u2").textContent).toContain("Geburtsdatum fehlt");
  expect(screen.getByTestId("roster-eligibility-u3").textContent).toContain("Alter erfüllt");
  expect(screen.getByTestId("season-roster-counts").textContent).toContain("1 in der Wartezeit");
  expect(screen.getByTestId("season-roster-rules").textContent).toContain("Mindestalter: 18");
});

test("die Wartezeit lässt sich nur mit Grund aufheben", async () => {
  render(<SeasonRosterPanel seasonId="s1" />);

  fireEvent.click(await screen.findByTestId("roster-waive-u1"));
  fireEvent.click(screen.getByTestId("roster-waive-save-u1"));
  expect(screen.getByRole("alert").textContent).toContain("Grund");
  expect(post).not.toHaveBeenCalled();

  fireEvent.change(screen.getByTestId("roster-waive-reason-u1"), { target: { value: "Team sonst nicht spielfähig" } });
  fireEvent.click(screen.getByTestId("roster-waive-save-u1"));

  await waitFor(() => expect(post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/roster/u1/waive-wait", { squad_id: "sq1", reason: "Team sonst nicht spielfähig" }));
});

test("Transfers genehmigt die Leitung, eine Ablehnung braucht einen Grund", async () => {
  render(<SeasonRosterPanel seasonId="s1" />);

  fireEvent.click(await screen.findByTestId("season-transfer-reject-t1"));
  fireEvent.click(screen.getByTestId("season-transfer-reject-save-t1"));
  expect(post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("season-transfer-reason-t1"), { target: { value: "Fenster falsch verstanden" } });
  fireEvent.click(screen.getByTestId("season-transfer-reject-save-t1"));
  await waitFor(() => expect(post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/transfers/t1/reject", { reason: "Fenster falsch verstanden" }));

  post.mockClear();
  fireEvent.click(await screen.findByTestId("season-transfer-approve-t1"));
  await waitFor(() => expect(post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/transfers/t1/approve", { reason: null }));
});

test("ohne Regeln und ohne Pflicht-ID bleibt die einfache Liste", async () => {
  get.mockResolvedValue({ data: { ...ROSTER, fields: [], rules: { one_team_per_season: false, min_age: 0, new_player_wait_days: 0 } } });
  render(<SeasonRosterPanel seasonId="s1" />);

  expect(await screen.findByTestId("season-roster-free")).toBeTruthy();
  expect(screen.queryByTestId("season-transfers")).toBeNull();
});

test("eine ältere Season schickt leere Regeln und bleibt, wie sie ist", () => {
  const body = seasonPayload(seasonToForm({ name: "Alt", team_size: 4, min_squad_size: 4 }));
  expect(body.max_squad_size).toBeNull();
  expect(body.min_age).toBeNull();
  expect(body.new_player_wait_days).toBeNull();
  expect(body.lineup_min_players).toBeNull();
  expect(body).not.toHaveProperty("lineup_mode");
  expect(body).not.toHaveProperty("one_team_per_season");
  expect(body).not.toHaveProperty("unique_game_ids");
});

test("eine neue Season behält ihre Regeln im Formular", () => {
  const body = seasonPayload(seasonToForm({ name: "Neu", min_squad_size: 3, max_squad_size: 50, one_team_per_season: true, new_player_wait_days: 7, min_age: 18, unique_game_ids: true, lineup_mode: "series", lineup_min_players: 3,
    transfer_windows: [{ start_date: "2027-04-01", end_date: "2027-04-07" }, { start_date: "", end_date: "" }] }));
  expect(body).toMatchObject({ min_squad_size: 3, max_squad_size: 50, one_team_per_season: true, new_player_wait_days: 7, min_age: 18, unique_game_ids: true, lineup_mode: "series", lineup_min_players: 3 });
  expect(body.transfer_windows).toEqual([{ start_date: "2027-04-01", end_date: "2027-04-07" }]);
});
