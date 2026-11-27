import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Gastteam im Eingang (#1665, Nr. 286): Die Liga-Leitung setzt und bestätigt das Kennzeichen; beim eigenen Team eine zweite Person,
// der Superadmin nur mit Grund. Nur erfundene Namen.
const apiMock = { put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatApiError: (error, fallback) => fallback }));
const toastMock = { success: vi.fn(), error: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

const { GuestTeamControl, guestInfoLine } = await import("./GuestTeamControl");

const SCHOOL = { confirmed: false, kind: "school", kind_label: "Schule", name: "Probeschule Nord", school_name_public: false, pending: true, badge: null };

beforeEach(() => {
  apiMock.put.mockReset();
  apiMock.put.mockResolvedValue({ data: {} });
  toastMock.success.mockReset();
});

test("ohne Angabe nur der leise Knopf - er setzt das Kennzeichen für die Season", async () => {
  const onChanged = vi.fn();
  render(<GuestTeamControl row={{ id: "a1", team_id: "t1" }} seasonId="s1" onChanged={onChanged} />);
  fireEvent.click(screen.getByTestId("application-guest-confirm-a1"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/teams/t1/guest-team", { confirmed: true, season_id: "s1" }));
  await waitFor(() => expect(onChanged).toHaveBeenCalled());
  expect(screen.getByTestId("application-guest-confirm-a1")).toHaveTextContent("Als Gastteam kennzeichnen");
});

test("Angabe der Teamleitung mit Schulname ohne Freigabe: die Leitung sieht ihn, öffentlich steht nur „Gast“", () => {
  render(<GuestTeamControl row={{ id: "a1", team_id: "t1", guest_team: SCHOOL }} seasonId="s1" />);
  expect(screen.getByTestId("application-guest-info-a1")).toHaveTextContent("Schule Probeschule Nord – Name nicht freigegeben, öffentlich steht nur „Gast“.");
  expect(screen.getByTestId("application-guest-pending-a1")).toHaveTextContent("Wartet auf die Bestätigung");
  expect(screen.getByTestId("application-guest-confirm-a1")).toHaveTextContent("Als Gastteam bestätigen");
});

test("bestätigt und unverändert: zurücknehmen geht, neu bestätigen braucht es nicht", async () => {
  const info = { ...SCHOOL, confirmed: true, pending: false, school_name_public: true, badge: { label: "Gast", org: "Probeschule Nord" } };
  render(<GuestTeamControl row={{ id: "a1", team_id: "t1", guest_team: info }} seasonId="s1" />);
  expect(screen.getByTestId("application-guest-badge-a1")).toHaveTextContent("Probeschule Nord");
  expect(screen.queryByTestId("application-guest-confirm-a1")).toBeNull();
  fireEvent.click(screen.getByTestId("application-guest-revoke-a1"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/teams/t1/guest-team", { confirmed: false, season_id: "s1" }));
});

test("eigenes Team: ohne Superadmin nur der Satz, als Superadmin erst mit Grund", async () => {
  const { rerender } = render(<GuestTeamControl row={{ id: "a1", team_id: "t1", own_team: true, guest_team: SCHOOL }} seasonId="s1" />);
  expect(screen.getByTestId("application-guest-own-a1")).toHaveTextContent("Über dein eigenes Team entscheidet eine andere Person.");
  expect(screen.queryByTestId("application-guest-confirm-a1")).toBeNull();

  rerender(<GuestTeamControl row={{ id: "a1", team_id: "t1", own_team: true, guest_team: SCHOOL }} seasonId="s1" superadmin />);
  expect(screen.getByTestId("application-guest-confirm-a1")).toBeDisabled();
  fireEvent.change(screen.getByTestId("application-guest-conflict-a1"), { target: { value: "Niemand sonst erreichbar" } });
  fireEvent.click(screen.getByTestId("application-guest-confirm-a1"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/teams/t1/guest-team",
    { confirmed: true, season_id: "s1", conflict_reason: "Niemand sonst erreichbar" }));
});

test("guestInfoLine: Verein, freigegebene Schule und keine Angabe", () => {
  expect(guestInfoLine({ kind: "club", kind_label: "Verein", name: "SV Probedorf" })).toBe("Verein SV Probedorf");
  expect(guestInfoLine({ ...SCHOOL, school_name_public: true })).toBe("Schule Probeschule Nord");
  expect(guestInfoLine({ confirmed: true })).toContain("nur „Gast“");
});
