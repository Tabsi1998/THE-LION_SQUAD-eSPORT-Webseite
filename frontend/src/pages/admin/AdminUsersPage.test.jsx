import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Rollen und Rechte (#292): die Seite sagt je Rolle, was sie darf und was nicht,
// team_leader ist weg, und der Superadmin gibt Bereiche je Person frei.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
const authState = { isSuperAdmin: true, user: null };

vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => async () => true }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminUsersPage = (await import("./AdminUsersPage")).default;

// `ban_protected` kommt vom Server: Adminbereich aus Rolle, Freigabe, Vorstandsposten oder Dolibarr.
const USERS = [
  { id: "u-1", username: "helferin", display_name: "Helferin", email: "h@example.test", role: "player", areas: ["content"], ban_protected: true },
  { id: "u-2", username: "turnier", display_name: "Turnierleitung", email: "t@example.test", role: "tournament_admin", areas: [], ban_protected: true },
  { id: "u-3", username: "spieler", display_name: "Spieler Eins", email: "s@example.test", role: "player", areas: [], ban_protected: false },
  { id: "u-4", username: "gesperrt", display_name: "Gesperrt", email: "g@example.test", role: "player", areas: [], ban_protected: false, is_banned: true },
];

beforeEach(() => {
  vi.clearAllMocks();
  authState.isSuperAdmin = true;
  authState.user = null;
  apiMock.get.mockResolvedValue({ data: USERS });
  apiMock.put.mockResolvedValue({ data: {} });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
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

// Bannen: Fenster auf der Seite, nennt die Person, verlangt einen Grund (mindestens 5 Zeichen).
test("Bannen fragt im Fenster nach Grund und Bestätigung - erst dann geht der Aufruf raus", async () => {
  authState.isSuperAdmin = false;
  const user = userEvent.setup();
  render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("user-ban-spieler")).toBeInTheDocument());

  await user.click(screen.getByTestId("user-ban-spieler"));
  const dialog = screen.getByTestId("ban-dialog");
  expect(dialog).toHaveTextContent("Spieler Eins bannen?");
  expect(dialog).toHaveTextContent("@spieler");
  expect(screen.getByTestId("ban-dialog-confirm")).toBeDisabled();

  await user.type(screen.getByTestId("ban-dialog-reason"), "Spam");
  expect(screen.getByTestId("ban-dialog-hint")).toHaveTextContent("Noch 1 Zeichen.");
  expect(screen.getByTestId("ban-dialog-confirm")).toBeDisabled();
  expect(apiMock.post).not.toHaveBeenCalled();

  await user.type(screen.getByTestId("ban-dialog-reason"), " im Chat");
  expect(screen.getByTestId("ban-dialog-confirm")).toBeEnabled();
  await user.click(screen.getByTestId("ban-dialog-confirm"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/users/u-3/ban", { reason: "Spam im Chat" }));
  expect(toastMock.success).toHaveBeenCalledWith("Spieler Eins ist gebannt.");
  await waitFor(() => expect(screen.queryByTestId("ban-dialog")).toBeNull());
});

test("Abbrechen schließt das Fenster ohne Aufruf", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("user-ban-spieler")).toBeInTheDocument());

  await user.click(screen.getByTestId("user-ban-spieler"));
  await user.type(screen.getByTestId("ban-dialog-reason"), "Regelverstoß");
  await user.click(screen.getByTestId("ban-dialog-cancel"));

  expect(screen.queryByTestId("ban-dialog")).toBeNull();
  expect(apiMock.post).not.toHaveBeenCalled();
});

test("Konten mit Adminbereich: ohne Superadmin kein Bannen, dafür ein Satz warum", async () => {
  authState.isSuperAdmin = false;
  render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("user-ban-spieler")).toBeInTheDocument());

  for (const name of ["helferin", "turnier"]) {
    expect(screen.queryByTestId(`user-ban-${name}`)).toBeNull();
    expect(screen.getByTestId(`user-ban-locked-${name}`)).toHaveTextContent("bannen kann nur der Superadmin");
  }
});

test("der Superadmin bannt auch Konten mit Adminbereich - nur das eigene Konto hat keinen Knopf", async () => {
  authState.user = { id: "u-2", role: "superadmin" };
  render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("user-ban-helferin")).toBeInTheDocument());

  expect(screen.queryByTestId("user-ban-locked-helferin")).toBeNull();
  expect(screen.queryByTestId("user-ban-turnier")).toBeNull();
  expect(screen.queryByTestId("user-ban-locked-turnier")).toBeNull();
});

test("Entbannen fragt nach und ruft dann entbannen auf", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
  await waitFor(() => expect(screen.getByTestId("user-ban-gesperrt")).toHaveTextContent("Entbannen"));

  await user.click(screen.getByTestId("user-ban-gesperrt"));

  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/users/u-4/unban"));
  expect(screen.queryByTestId("ban-dialog")).toBeNull();
});
