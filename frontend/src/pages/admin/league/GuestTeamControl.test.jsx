import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Gastteam im Eingang (#1665, Nr. 286): Die Liga-Leitung setzt und bestätigt das Kennzeichen; beim eigenen Team eine zweite Person,
// der Superadmin nur mit Grund. Nur erfundene Namen.
const apiMock = { put: vi.fn() };
vi.mock("@/lib/api", async (importOriginal) => ({ ...(await importOriginal()), api: apiMock }));
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

  // Der Grund kommt aus dem einen Feld der Anmeldung; steht keins darüber, bringt die Steuerung es selbst mit.
  function WithReason() {
    const [reason, setReason] = useState("");
    return <GuestTeamControl row={{ id: "a1", team_id: "t1", own_team: true, guest_team: SCHOOL }} seasonId="s1" superadmin
      conflictReason={reason} onConflictReason={setReason} />;
  }
  rerender(<WithReason />);
  expect(screen.getByTestId("application-guest-confirm-a1")).toBeDisabled();
  fireEvent.change(screen.getByTestId("application-conflict-reason-a1"), { target: { value: "Niemand sonst erreichbar" } });
  fireEvent.click(screen.getByTestId("application-guest-confirm-a1"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/teams/t1/guest-team",
    { confirmed: true, season_id: "s1", conflict_reason: "Niemand sonst erreichbar" }));
});

test("guestInfoLine: Verein, freigegebene Schule und keine Angabe", () => {
  expect(guestInfoLine({ kind: "club", kind_label: "Verein", name: "SV Probedorf" })).toBe("Verein SV Probedorf");
  expect(guestInfoLine({ ...SCHOOL, school_name_public: true })).toBe("Schule Probeschule Nord");
  expect(guestInfoLine({ confirmed: true })).toContain("nur „Gast“");
});

/** Ein Fehler wie von axios: Status und deutscher Satz des Servers im Inhalt, die Nachricht ist die englische von axios. */
function serverRefusal(status, detail) {
  const error = new Error(`Request failed with status code ${status}`);
  error.response = { status, data: { detail } };
  return error;
}

test("eine Absage des Servers steht mit seinem deutschen Satz da - nicht „Request failed with status code 403“", async () => {
  apiMock.put.mockRejectedValue(serverRefusal(403, "Über dein eigenes Team entscheidet eine andere Person."));
  render(<GuestTeamControl row={{ id: "a1", team_id: "t1", guest_team: SCHOOL }} seasonId="s1" />);
  fireEvent.click(screen.getByTestId("application-guest-confirm-a1"));
  await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Über dein eigenes Team entscheidet eine andere Person."));
});

test("eigenes Team als Superadmin, Grund steht im Feld darunter: der gesperrte Knopf sagt, warum", () => {
  render(<GuestTeamControl row={{ id: "a1", team_id: "t1", own_team: true, guest_team: SCHOOL }} seasonId="s1" superadmin />);
  const button = screen.getByTestId("application-guest-confirm-a1");
  expect(button).toBeDisabled();
  const hint = document.getElementById(button.getAttribute("aria-describedby"));
  expect(hint).toHaveTextContent("Zuerst unten den Grund für die Notausnahme eintragen.");
});

test("mit Grund oder ohne Befangenheit kein Hinweis am Knopf", () => {
  const { rerender } = render(<GuestTeamControl row={{ id: "a1", team_id: "t1", own_team: true, guest_team: SCHOOL }} seasonId="s1" superadmin
    conflictReason="Sonst niemand da" />);
  expect(screen.getByTestId("application-guest-confirm-a1")).not.toHaveAttribute("aria-describedby");
  rerender(<GuestTeamControl row={{ id: "a1", team_id: "t1", guest_team: SCHOOL }} seasonId="s1" />);
  expect(screen.getByTestId("application-guest-confirm-a1")).not.toHaveAttribute("aria-describedby");
});

