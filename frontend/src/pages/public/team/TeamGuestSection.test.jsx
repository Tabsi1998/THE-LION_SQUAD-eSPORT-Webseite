import { fireEvent, render, screen, waitFor } from "@testing-library/react";

// Gastteam im Bearbeiten-Blatt (#1665, Nr. 286): Die Teamleitung gibt Verein oder Schule an und gibt einen Schulnamen frei - das
// Kennzeichen setzt die Liga-Leitung. Nur erfundene Namen.
const apiMock = { put: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (error, fallback) => fallback }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/useSubmissionGuard", () => ({
  useSubmissionGuard: () => ({
    submitting: false,
    submitOnce: async (task) => { try { await task(); return { started: true }; } catch (error) { return { started: true, error }; } },
  }),
}));

const { TeamGuestSection, guestStatusLine } = await import("./TeamGuestSection");

beforeEach(() => {
  apiMock.put.mockReset();
});

test("Schule mit Name und Freigabe speichern - ohne Kennzeichen wartet es auf die Liga-Leitung", async () => {
  apiMock.put.mockResolvedValue({ data: { guest_team: { kind: "school", name: "Probeschule Nord", confirmed: false, pending: true }, guest_badge: null } });
  const onSaved = vi.fn();
  render(<TeamGuestSection team={{ id: "t1" }} onSaved={onSaved} />);
  expect(screen.queryByTestId("team-guest-name")).toBeNull();
  fireEvent.change(screen.getByTestId("team-guest-kind"), { target: { value: "school" } });
  fireEvent.change(screen.getByTestId("team-guest-name"), { target: { value: "  Probeschule Nord " } });
  expect(screen.getByTestId("team-guest-school-public")).not.toBeChecked();
  fireEvent.click(screen.getByTestId("team-guest-school-public"));
  fireEvent.click(screen.getByTestId("team-guest-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/teams/t1/guest-team", { kind: "school", name: "Probeschule Nord", school_name_public: true }));
  await waitFor(() => expect(screen.getByTestId("team-guest-status")).toHaveTextContent("Wartet auf die Liga-Leitung"));
  expect(onSaved).toHaveBeenCalled();
});

test("Verein: keine Freigabe nötig; bestätigt zeigt die Plakette, wie sie in den Ligen steht", () => {
  const team = { id: "t1", guest_team: { kind: "club", name: "SV Probedorf", confirmed: true, pending: false, badge: { label: "Gast", org: "SV Probedorf" } } };
  render(<TeamGuestSection team={team} />);
  expect(screen.queryByTestId("team-guest-school-public")).toBeNull();
  expect(screen.getByTestId("team-guest-preview")).toHaveTextContent("SV Probedorf");
});

test("die Absage des Servers steht im Blatt", async () => {
  apiMock.put.mockRejectedValue(new Error("422"));
  render(<TeamGuestSection team={{ id: "t1" }} />);
  fireEvent.change(screen.getByTestId("team-guest-kind"), { target: { value: "club" } });
  fireEvent.click(screen.getByTestId("team-guest-save"));
  expect(await screen.findByText("Die Angaben ließen sich nicht speichern.")).toBeInTheDocument();
});

test("guestStatusLine: nichts angegeben, offen, bestätigt, geändert", () => {
  expect(guestStatusLine(null)).toBe("");
  expect(guestStatusLine({ kind: "club" })).toContain("Wartet auf die Liga-Leitung");
  expect(guestStatusLine({ confirmed: true })).toContain("bestätigt");
  expect(guestStatusLine({ confirmed: true, pending: true })).toContain("nur „Gast“");
});
