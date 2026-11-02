import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";

const apiMock = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn(), delete: vi.fn() }));
const confirmMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (original) => ({ ...(await original()), api: apiMock }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/tls/PersonPicker", () => ({
  PersonAvatar: () => null,
  PersonPicker: ({ onChange, testId }) => <button type="button" data-testid={testId} onClick={() => onChange({ id: "p-1", name: "Erika Beispiel" })}>Person wählen</button>,
}));

import { LeagueStaffSheet } from "./LeagueStaffSheet";

const LEAGUE = { id: "liga-1", name: "Probeliga" };
const ROW = { user_id: "u-1", display_name: "Max Muster", capabilities: ["results", "disputes"], second_factor: true };

function answer(body) {
  apiMock.get.mockResolvedValue({ data: body });
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock.put.mockResolvedValue({ data: {} });
  apiMock.delete.mockResolvedValue({ data: {} });
});

test("Vergabe: Person und mindestens eine Zuständigkeit, dann an den Server", async () => {
  answer({ staff: [], can_grant: true });
  render(<LeagueStaffSheet league={LEAGUE} onClose={() => {}} />);
  expect(await screen.findByTestId("league-staff-empty")).toBeInTheDocument();
  expect(screen.getByTestId("league-staff-grant")).toBeDisabled();

  fireEvent.click(screen.getByTestId("league-staff-person"));
  expect(screen.getByTestId("league-staff-grant")).toBeDisabled();
  fireEvent.click(screen.getByTestId("league-staff-new-results"));
  fireEvent.click(screen.getByTestId("league-staff-new-roster"));
  fireEvent.click(screen.getByTestId("league-staff-grant"));

  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/liga-1/staff/p-1", { capabilities: ["results", "roster"] }));
});

test("Liste nennt die Zuständigkeiten und sagt, wenn die Zwei-Faktor-Anmeldung fehlt", async () => {
  answer({ staff: [ROW, { ...ROW, user_id: "u-2", display_name: "Ohne 2FA", second_factor: false }], can_grant: true });
  render(<LeagueStaffSheet league={LEAGUE} onClose={() => {}} />);
  expect(await screen.findByTestId("league-staff-row-u-1")).toHaveTextContent("Ergebnisse korrigieren · Proteste");
  expect(screen.queryByTestId("league-staff-no-mfa-u-1")).toBeNull();
  expect(screen.getByTestId("league-staff-no-mfa-u-2")).toHaveTextContent("Zwei-Faktor");
});

test("Ändern setzt die neue Auswahl, ohne Häkchen geht nichts", async () => {
  answer({ staff: [ROW], can_grant: true });
  render(<LeagueStaffSheet league={LEAGUE} onClose={() => {}} />);
  fireEvent.click(await screen.findByTestId("league-staff-edit-u-1"));
  fireEvent.click(screen.getByTestId("league-staff-u-1-results"));
  fireEvent.click(screen.getByTestId("league-staff-u-1-disputes"));
  expect(screen.getByTestId("league-staff-save-u-1")).toBeDisabled();
  fireEvent.click(screen.getByTestId("league-staff-u-1-matches"));
  fireEvent.click(screen.getByTestId("league-staff-save-u-1"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/admin/leagues/liga-1/staff/u-1", { capabilities: ["matches"] }));
});

test("Entfernen fragt nach und nennt, was wegfällt", async () => {
  answer({ staff: [ROW], can_grant: true });
  confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  render(<LeagueStaffSheet league={LEAGUE} onClose={() => {}} />);
  fireEvent.click(await screen.findByTestId("league-staff-remove-u-1"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
  expect(confirmMock.mock.calls[0][0].description).toContain("Ergebnisse korrigieren · Proteste");
  expect(apiMock.delete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("league-staff-remove-u-1"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/admin/leagues/liga-1/staff/u-1"));
});

test("„Liga verwalten“ ohne Bereich sieht die Liste, aber keine Knöpfe zum Vergeben", async () => {
  answer({ staff: [ROW], can_grant: false });
  render(<LeagueStaffSheet league={LEAGUE} onClose={() => {}} />);
  expect(await screen.findByTestId("league-staff-row-u-1")).toBeInTheDocument();
  expect(screen.queryByTestId("league-staff-add")).toBeNull();
  expect(screen.queryByTestId("league-staff-edit-u-1")).toBeNull();
  expect(screen.queryByTestId("league-staff-remove-u-1")).toBeNull();
});

test("Verweigert der Server die Liste, steht sein Satz da", async () => {
  apiMock.get.mockRejectedValue({ response: { data: { detail: "Dafür fehlt dir das Recht in dieser Liga." } } });
  render(<LeagueStaffSheet league={LEAGUE} onClose={() => {}} />);
  expect(await screen.findByTestId("league-staff-error")).toHaveTextContent("Recht in dieser Liga");
});
