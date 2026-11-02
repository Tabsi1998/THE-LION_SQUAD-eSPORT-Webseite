import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Kader unter Mindestgröße (#2202): Wer einen Spieler aus dem Kader nimmt, sieht vor dem Speichern, was das für die Staffel
// bedeutet - und kann trotzdem speichern. Erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback, resolveMediaUrl: (url) => url }));
const confirmMock = vi.fn();
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { TeamsPanel } = await import("./TeamsPanel");

const MEMBERS = [{ id: "u1", display_name: "Mila" }, { id: "u2", display_name: "Tom" }, { id: "u3", display_name: "Ida" }];
const TEAM = { id: "t1", name: "Loewen", tag: "LOE", my_role: "leader", can_manage: true, members: MEMBERS, member_ids: MEMBERS.map((m) => m.id) };
const SQUAD = { id: "s-a", team_id: "t1", name: "Rudel A", status: "active", member_ids: ["u1", "u2"], members: MEMBERS.slice(0, 2) };

function answer(squad) {
  apiMock.get.mockImplementation((url) => {
    if (url === "/teams/my") return Promise.resolve({ data: [TEAM] });
    if (url === "/teams/t1/squads") return Promise.resolve({ data: [squad] });
    return Promise.resolve({ data: [] });
  });
}

async function openEditor() {
  render(<MemoryRouter><TeamsPanel /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("team-squad-roles-s-a")).toBeInTheDocument());
  const card = screen.getByTestId("team-squad-roles-s-a").parentElement;
  fireEvent.click(within(card).getAllByRole("button")[0]);
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.patch.mockReset();
  confirmMock.mockReset();
  apiMock.patch.mockResolvedValue({ data: {} });
});

test("unter die Vorgabe der Staffel: erst die Rückfrage, dann gespeichert", async () => {
  answer({ ...SQUAD, league_requirement: { min_size: 2, title: "Staffel A" } });
  confirmMock.mockResolvedValue(true);
  await openEditor();

  fireEvent.click(screen.getByTestId("team-squad-member-u2"));
  fireEvent.click(screen.getByText("Speichern"));

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  expect(confirmMock).toHaveBeenCalledTimes(1);
  expect(confirmMock.mock.calls[0][0].description).toContain("noch 1 von mindestens 2 Spielern");
  expect(apiMock.patch.mock.calls[0][1].member_ids).toEqual(["u1"]);
});

test("Abbrechen in der Rückfrage speichert nichts und lässt das Formular offen", async () => {
  answer({ ...SQUAD, league_requirement: { min_size: 2, title: "Staffel A" } });
  confirmMock.mockResolvedValue(false);
  await openEditor();

  fireEvent.click(screen.getByTestId("team-squad-member-u2"));
  fireEvent.click(screen.getByText("Speichern"));

  await waitFor(() => expect(confirmMock).toHaveBeenCalled());
  expect(apiMock.patch).not.toHaveBeenCalled();
  expect(screen.getByTestId("team-squad-name")).toBeInTheDocument();
});

test("reicht der Kader oder verlangt keine Staffel etwas, fragt nichts nach", async () => {
  answer(SQUAD);
  await openEditor();

  fireEvent.click(screen.getByTestId("team-squad-member-u2"));
  fireEvent.click(screen.getByText("Speichern"));

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  expect(confirmMock).not.toHaveBeenCalled();
});
