import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Kader und Spiel-IDs einer Season (#2108): Stand je Spieler, neue ID im Profil mit Freigabe (Grund, Protokoll),
// Stichtag für neue Spieler. Erfundene Namen und IDs.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (detail) => String(detail || "Fehler") }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));
const { SeasonRosterPanel } = await import("./SeasonRosterPanel");

const BODY = {
  season: { id: "s1", name: "Season 1", roster_deadline: null },
  fields: [{ key: "activision_id", label: "Activision-ID" }],
  counts: { missing: 1, late: 0, changed: 1 },
  squads: [{
    registration_id: "r1",
    staffel_label: "Liga 1 · Staffel A",
    display_name: "Loewen · Rudel A",
    players: [
      { id: "u1", name: "Mila", state: "locked", ok: true, text: "Testloewe#1234567", profile_text: "Neu#7654321", changed: true,
        locked_at: "2026-10-28T10:00:00+00:00", approvals: [{ at: "2026-10-27T09:00:00+00:00", by: "Turnierleitung", old_text: null, new_text: "Testloewe#1234567", reason: "Nachgemeldet" }] },
      { id: "u2", name: "Tom", state: "missing", ok: false, text: null, profile_text: null, changed: false, reason: "Activision-ID fehlt im Profil.", approvals: [] },
    ],
  }],
};

beforeEach(() => {
  for (const fn of [...Object.values(apiMock), ...Object.values(toastMock)]) fn.mockReset();
  apiMock.get.mockResolvedValue({ data: BODY });
});

test("je Co-Team die Spieler mit ID-Stand; eine neue ID im Profil wird mit Grund freigegeben", async () => {
  apiMock.post.mockResolvedValue({ data: { state: "locked" } });
  render(<SeasonRosterPanel seasonId="s1" />);

  await waitFor(() => expect(screen.getByTestId("roster-squad-r1")).toBeInTheDocument());
  expect(apiMock.get).toHaveBeenCalledWith("/admin/leagues/seasons/s1/roster");
  expect(screen.getByTestId("season-roster-counts")).toHaveTextContent("1 ohne ID · 1 mit neuer ID im Profil");
  expect(screen.getByTestId("roster-player-u1")).toHaveTextContent("Testloewe#1234567");
  expect(screen.getByTestId("roster-changed-u1")).toHaveTextContent("Im Profil steht inzwischen Neu#7654321");
  expect(screen.getByTestId("roster-player-u2")).toHaveTextContent("Activision-ID fehlt im Profil.");
  expect(screen.queryByTestId("roster-approve-u2")).not.toBeInTheDocument();
  expect(screen.getByText(/Protokoll \(1\)/)).toBeInTheDocument();

  fireEvent.click(screen.getByTestId("roster-approve-u1"));
  fireEvent.click(screen.getByTestId("roster-approve-save-u1"));
  expect(screen.getByRole("alert")).toHaveTextContent("Grund");
  expect(apiMock.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByTestId("roster-approve-reason-u1"), { target: { value: "Konto gewechselt" } });
  fireEvent.click(screen.getByTestId("roster-approve-save-u1"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/leagues/seasons/s1/roster/u1/approve", { reason: "Konto gewechselt" }));
  expect(toastMock.success).toHaveBeenCalledWith("Mila: neue ID gilt ab jetzt.");
});

test("der Stichtag für neue Spieler ist eine Einstellung der Season; leer heißt kein Stichtag", async () => {
  apiMock.put.mockResolvedValue({ data: { roster_deadline: "2026-12-01" } });
  render(<SeasonRosterPanel seasonId="s1" />);
  await waitFor(() => expect(screen.getByTestId("season-roster-deadline-input")).toBeInTheDocument());

  fireEvent.change(screen.getByTestId("season-roster-deadline-input"), { target: { value: "2026-12-01" } });
  fireEvent.click(screen.getByTestId("season-roster-deadline-save"));

  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/seasons/s1/roster-settings", { roster_deadline: "2026-12-01" }));
  expect(toastMock.success).toHaveBeenCalledWith("Stichtag gespeichert.");
});

test("ein Spiel ohne Pflicht-ID braucht keinen Kader-Abgleich", async () => {
  apiMock.get.mockResolvedValue({ data: { ...BODY, fields: [], squads: [] } });
  render(<SeasonRosterPanel seasonId="s1" />);

  await waitFor(() => expect(screen.getByTestId("season-roster-free")).toBeInTheDocument());
  expect(screen.queryByTestId("season-roster-deadline")).not.toBeInTheDocument();
});
