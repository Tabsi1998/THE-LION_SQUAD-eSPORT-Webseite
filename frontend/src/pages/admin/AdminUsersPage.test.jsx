import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Rollen und Rechte (#292): die Seite sagt je Rolle, was sie darf und was nicht,
// team_leader ist weg, und der Superadmin gibt Bereiche je Person frei.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
const authState = { isSuperAdmin: true };

vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminUsersPage = (await import("./AdminUsersPage")).default;

const USERS = [
  { id: "u-1", username: "helferin", display_name: "Helferin", email: "h@example.test", role: "player", areas: ["content"] },
  { id: "u-2", username: "turnier", display_name: "Turnierleitung", email: "t@example.test", role: "tournament_admin", areas: [] },
];

beforeEach(() => {
  vi.clearAllMocks();
  authState.isSuperAdmin = true;
  apiMock.get.mockResolvedValue({ data: USERS });
  apiMock.put.mockResolvedValue({ data: {} });
});

test("je Rolle steht, was sie darf und was nicht; team_leader gibt es nicht mehr", async () => {
  render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("user-role-helferin")).toBeInTheDocument());

  expect(screen.getByTestId("role-can-tournament_admin")).toHaveTextContent("Turniere, Events, Stationen");
  expect(screen.getByTestId("role-cannot-tournament_admin")).toHaveTextContent("News, Galerie, Sponsoren (Redaktion)");
  expect(screen.queryByTestId("role-can-team_leader")).toBeNull();
  const options = [...screen.getByTestId("user-role-helferin").querySelectorAll("option")].map((o) => o.textContent);
  expect(options).toEqual(["Spieler", "Moderator", "Turnierleitung", "Club-Admin", "Superadmin"]);
});

test("der Superadmin gibt einen Bereich frei; was die Rolle schon hat, ist gesperrt", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("user-area-helferin-content")).toBeChecked());

  await user.click(screen.getByTestId("user-area-helferin-club"));
  expect(apiMock.put).toHaveBeenCalledWith("/users/u-1/areas", { areas: ["content", "club"] });

  expect(screen.getByTestId("user-area-turnier-tournaments")).toBeChecked();
  expect(screen.getByTestId("user-area-turnier-tournaments")).toBeDisabled();
});

test("ohne Superadmin gibt es keine Freigaben zu sehen", async () => {
  authState.isSuperAdmin = false;
  render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("user-role-helferin")).toBeInTheDocument());
  expect(screen.queryByTestId("user-areas-helferin")).toBeNull();
});

test("„Einladen“ schaltet den Mitgliedsantrag für ein Konto frei (#507)", async () => {
  apiMock.post.mockResolvedValue({ data: { id: "inv-1", status: "open" } });
  const user = userEvent.setup();
  render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getAllByTestId("user-invite-helferin").length).toBeGreaterThan(0));
  await user.click(screen.getAllByTestId("user-invite-helferin")[0]);
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/admin/membership-invitations", { user_id: "u-1" }));
  expect(toastMock.success).toHaveBeenCalledWith("Helferin ist zum Mitgliedsantrag eingeladen.");
});
