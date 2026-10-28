import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Rolle abgeben (#2110, L-D11): Captain oder Vertreter geben die eigene Rolle selbst ab; „Co-Teams verwalten“ auf der
// Teamseite öffnet hier genau das Team (?team=). Erfundene Namen.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_err, fallback) => fallback, resolveMediaUrl: (url) => url }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/context/AuthContext", () => ({ useOptionalAuth: () => ({ user: { id: "u2" } }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const { TeamsPanel } = await import("./TeamsPanel");

const MEMBERS = [{ id: "u1", display_name: "Mila" }, { id: "u2", display_name: "Tom" }, { id: "u3", display_name: "Ida" }];
const OTHER = { id: "t0", name: "Erstes Team", tag: "ERS", my_role: "member", can_manage: false, members: [], member_ids: [] };
const TEAM = { id: "t1", name: "Loewen", tag: "LOE", my_role: "member", can_manage: false, members: MEMBERS, member_ids: ["u1", "u2", "u3"] };
const SQUADS = [
  { id: "s-a", team_id: "t1", name: "Rudel A", status: "active", member_ids: ["u1", "u2"], captain_id: "u1", vice_captain_id: "u2", members: MEMBERS.slice(0, 2) },
  { id: "s-b", team_id: "t1", name: "Rudel B", status: "active", member_ids: ["u2", "u3"], members: MEMBERS.slice(1) },
];

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.put.mockReset();
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/teams/my") return { data: [OTHER, TEAM] };
    if (url === "/teams/t1/squads") return { data: SQUADS };
    return { data: [] };
  });
  apiMock.put.mockResolvedValue({ data: {} });
});

test("der Vertreter gibt seine Rolle ab - nur dort, wo er eine hat; ?team= wählt das Team", async () => {
  render(<MemoryRouter initialEntries={["/teams?team=t1"]}><TeamsPanel /></MemoryRouter>);
  const resign = await screen.findByTestId("team-squad-resign-s-a");
  expect(resign).toHaveTextContent("Rolle abgeben (Vertreter)");
  expect(screen.queryByTestId("team-squad-resign-s-b")).toBeNull();
  fireEvent.click(resign);
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/teams/t1/squads/s-a/roles", { vice_captain_id: null }));
});
