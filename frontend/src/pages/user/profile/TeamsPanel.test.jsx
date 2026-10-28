import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Captain und Vertreter je Co-Team (#1649): die Karte sagt, wer handelt; im Formular wählt die Teamleitung beide aus
// dem Kader, und wer eine Rolle hat, lässt sich erst nach der Neuvergabe abwählen. Erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback, resolveMediaUrl: (url) => url }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { TeamsPanel } = await import("./TeamsPanel");

const MEMBERS = [
  { id: "u1", display_name: "Mila" },
  { id: "u2", display_name: "Tom" },
  { id: "u3", display_name: "Ida" },
  { id: "u4", display_name: "Ben" },
];
const TEAM = { id: "t1", name: "Loewen", tag: "LOE", my_role: "leader", can_manage: true, members: MEMBERS, member_ids: MEMBERS.map((m) => m.id), squad_count: 2 };
const SQUADS = [
  { id: "s-a", team_id: "t1", name: "Rudel A", status: "active", member_ids: ["u1", "u2", "u3"], captain_id: "u1", vice_captain_id: "u2", members: MEMBERS.slice(0, 3) },
  { id: "s-b", team_id: "t1", name: "Rudel B", status: "active", member_ids: ["u3", "u4"], members: MEMBERS.slice(2) },
];

function respond(url) {
  if (url === "/teams/my") return Promise.resolve({ data: [TEAM] });
  if (url === "/teams/t1/squads") return Promise.resolve({ data: SQUADS });
  return Promise.resolve({ data: [] });
}

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.patch.mockReset();
  apiMock.get.mockImplementation(respond);
  apiMock.patch.mockResolvedValue({ data: {} });
});

async function renderPanel() {
  render(<MemoryRouter><TeamsPanel /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("team-squad-roles-s-a")).toBeInTheDocument());
}

test("die Karte nennt Captain und Vertreter - ohne beide den Hinweis auf die Teamleitung", async () => {
  await renderPanel();
  expect(screen.getByTestId("team-squad-roles-s-a")).toHaveTextContent("Captain: Mila · Vertreter: Tom");
  expect(screen.getByTestId("team-squad-roles-s-b")).toHaveTextContent("Ohne Captain – im Liga-Spiel handelt die Teamleitung.");
  expect(screen.getByTitle("Captain")).toBeInTheDocument();
  expect(screen.getByTitle("Vertreter")).toBeInTheDocument();
});

test("Captain und Vertreter kommen aus dem Kader, Rollen sperren das Abwählen bis zur Neuvergabe", async () => {
  await renderPanel();
  const card = screen.getByTestId("team-squad-roles-s-a").parentElement;
  fireEvent.click(within(card).getAllByRole("button")[0]);

  const captain = screen.getByTestId("team-squad-captain_id");
  const vice = screen.getByTestId("team-squad-vice_captain_id");
  expect(captain).toHaveValue("u1");
  expect(vice).toHaveValue("u2");
  // Kein Doppel: wer Vertreter ist, steht nicht zur Wahl als Captain - und wer nicht im Kader ist, auch nicht.
  expect([...captain.options].map((option) => option.value)).toEqual(["", "u1", "u3"]);
  expect(screen.getByTestId("team-squad-member-u1")).toBeDisabled();
  expect(screen.getByTestId("team-squad-member-u3")).not.toBeDisabled();

  // Neu vergeben, dann lässt sich Mila abwählen.
  fireEvent.change(captain, { target: { value: "u3" } });
  expect(screen.getByTestId("team-squad-member-u1")).not.toBeDisabled();
  fireEvent.click(screen.getByTestId("team-squad-member-u1"));
  fireEvent.click(screen.getByText("Speichern"));

  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  const [url, payload] = apiMock.patch.mock.calls[0];
  expect(url).toBe("/teams/t1/squads/s-a");
  expect(payload.member_ids).toEqual(["u2", "u3"]);
  expect(payload.captain_id).toBe("u3");
  expect(payload).not.toHaveProperty("vice_captain_id"); // unverändert - nicht mitschicken
  expect(payload).not.toHaveProperty("members");
});

test("„Niemand“ nimmt eine Rolle weg", async () => {
  await renderPanel();
  const card = screen.getByTestId("team-squad-roles-s-a").parentElement;
  fireEvent.click(within(card).getAllByRole("button")[0]);
  fireEvent.change(screen.getByTestId("team-squad-vice_captain_id"), { target: { value: "" } });
  fireEvent.click(screen.getByText("Speichern"));
  await waitFor(() => expect(apiMock.patch).toHaveBeenCalled());
  expect(apiMock.patch.mock.calls[0][1].vice_captain_id).toBeNull();
});
