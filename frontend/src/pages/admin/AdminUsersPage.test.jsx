import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Alle Benutzer (#1357): die Liste ist nur zum Lesen, „Bearbeiten“ öffnet ein Blatt. Rolle und Freigaben ändert nur der
// Superadmin - erst mit „Speichern“ und einer Rückfrage mit Satz. Gesperrt wird im Blatt mit dem Grund-Fenster; Konten mit
// Adminbereich sperrt nur der Superadmin, das eigene Konto niemand, Superadmin-Konten niemand.

const apiMock = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() };
const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
const authState = { isSuperAdmin: true, user: null };
const confirmMock = vi.fn(async () => true);

vi.mock("@/lib/api", () => ({ api: apiMock, formatRequestError: (_e, fallback) => fallback }));
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/components/tls/AdminLayout", () => ({ AdminLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/ConfirmDialog", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("sonner", () => ({ toast: toastMock }));

const AdminUsersPage = (await import("./AdminUsersPage")).default;

// `ban_protected` kommt vom Server: Adminbereich aus Rolle, Freigabe, Vorstandsposten oder Dolibarr.
const USERS = [
  { id: "u-1", username: "helferin", display_name: "Erika Beispiel", email: "h@example.test", role: "player", areas: ["content"], ban_protected: true, is_club_member: true,
    membership_invitation: null },
  { id: "u-2", username: "turnier", display_name: "Turnierleitung", email: "t@example.test", role: "tournament_admin", areas: [], ban_protected: true },
  { id: "u-3", username: "spieler", display_name: "Spieler Eins", email: "s@example.test", role: "player", areas: [], ban_protected: false,
    membership_invitation: { status: "open", created_at: "2026-10-01T10:00:00+00:00" } },
  { id: "u-4", username: "gesperrt", display_name: "Gesperrt", email: "g@example.test", role: "player", areas: [], ban_protected: false, is_banned: true },
  { id: "u-5", username: "chef", display_name: "Sam Superadmin", email: "c@example.test", role: "superadmin", areas: [], ban_protected: true },
  { id: "u-6", username: "vorsitz", display_name: "Vera Vorstand", email: "v@example.test", role: "player", areas: [], ban_protected: true, areas_from_board: true },
];

function renderPage() {
  return render(<MemoryRouter><AdminUsersPage /></MemoryRouter>);
}

async function openSheet(user, username) {
  await waitFor(() => expect(screen.getByTestId(`user-edit-${username}`)).toBeInTheDocument());
  await user.click(screen.getByTestId(`user-edit-${username}`));
  return screen.findByTestId("user-sheet");
}

beforeEach(() => {
  vi.clearAllMocks();
  confirmMock.mockImplementation(async () => true);
  authState.isSuperAdmin = true;
  authState.user = { id: "u-root", role: "superadmin" };
  apiMock.get.mockResolvedValue({ data: USERS });
  apiMock.put.mockResolvedValue({ data: {} });
  apiMock.post.mockResolvedValue({ data: { ok: true } });
});

test("die Liste ist nur zum Lesen: Rolle als Wort, Bereiche als Schilder, keine Auswahl und keine Haken", async () => {
  renderPage();
  await waitFor(() => expect(screen.getByTestId("user-row-helferin")).toBeInTheDocument());
  const table = screen.getByTestId("users-table");
  expect(table.querySelectorAll("select, input")).toHaveLength(0);
  expect(screen.getByTestId("user-role-turnier")).toHaveTextContent("Turnierleitung");
  expect(screen.getByTestId("user-areas-helferin")).toHaveTextContent("Redaktion");
  expect(screen.getByTestId("user-areas-vorsitz")).toHaveTextContent("Vereinsverwaltung über Vorstand");
  expect(screen.getByTestId("user-row-gesperrt")).toHaveTextContent("gesperrt");
  // Eindeutige Kennungen: es gibt kein doppeltes „Einladen“ mehr.
  expect(screen.queryByTestId("user-invite-helferin")).toBeNull();
  expect(screen.getAllByTestId("user-edit-helferin")).toHaveLength(1);
});

test("Superadmin: eine Freigabe ändert sich erst mit „Speichern“ und Rückfrage mit Satz", async () => {
  const user = userEvent.setup();
  renderPage();
  const sheet = await openSheet(user, "helferin");
  await user.click(within(sheet).getByTestId("user-sheet-area-club"));
  expect(apiMock.put).not.toHaveBeenCalled();
  expect(within(sheet).getByTestId("user-sheet-pending")).toHaveTextContent("Erika Beispiel bekommt damit Zugriff auf Vereinsverwaltung (Mitgliederdaten, Anträge, Dokumente und Benutzer).");

  await user.click(screen.getByTestId("user-sheet-save"));
  await waitFor(() => expect(apiMock.put).toHaveBeenCalledWith("/users/u-1/areas", { areas: ["content", "club"] }));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({
    description: "Erika Beispiel bekommt damit Zugriff auf Vereinsverwaltung (Mitgliederdaten, Anträge, Dokumente und Benutzer).",
    tone: "danger",
  }));
  expect(apiMock.post).not.toHaveBeenCalledWith("/users/u-1/role", expect.anything());
});

test("Superadmin: sagt die Rückfrage nein, ändert sich nichts", async () => {
  confirmMock.mockImplementation(async () => false);
  const user = userEvent.setup();
  renderPage();
  const sheet = await openSheet(user, "spieler");
  await user.selectOptions(within(sheet).getByTestId("user-sheet-role"), "club_admin");
  await user.click(screen.getByTestId("user-sheet-save"));
  await waitFor(() => expect(confirmMock).toHaveBeenCalled());
  expect(apiMock.post).not.toHaveBeenCalled();
  expect(apiMock.put).not.toHaveBeenCalled();
});

test("Vereinsverwaltung: Rolle und Bereiche als Text, keine Auswahl, kein Speichern", async () => {
  authState.isSuperAdmin = false;
  authState.user = { id: "u-board", role: "player" };
  const user = userEvent.setup();
  renderPage();
  const sheet = await openSheet(user, "helferin");
  expect(within(sheet).getByTestId("user-sheet-rights-read")).toHaveTextContent("Spieler");
  expect(within(sheet).getByTestId("user-sheet-rights-read")).toHaveTextContent("Redaktion");
  expect(within(sheet).queryByTestId("user-sheet-role")).toBeNull();
  expect(screen.queryByTestId("user-sheet-save")).toBeNull();
  expect(within(sheet).queryByTestId("user-sheet-more")).toBeNull();
  // Konto mit Adminbereich: ein Satz statt des Knopfs.
  expect(within(sheet).getByTestId("user-sheet-ban-locked")).toHaveTextContent("Konto mit Adminbereich – sperren kann nur der Superadmin.");
});

test("Sperren im Blatt mit Grund-Fenster – die Person bekommt den Grund per Mail", async () => {
  authState.isSuperAdmin = false;
  authState.user = { id: "u-board", role: "player" };
  const user = userEvent.setup();
  renderPage();
  const sheet = await openSheet(user, "spieler");
  expect(within(sheet).getByTestId("user-sheet-invitation")).toHaveTextContent("Zum Mitgliedsantrag eingeladen am 1.10.2026 – noch offen.");
  await user.click(within(sheet).getByTestId("user-sheet-ban-open"));
  const dialog = screen.getByTestId("ban-dialog");
  expect(dialog).toHaveTextContent("Spieler Eins sperren?");
  expect(dialog).toHaveTextContent("bekommt eine Mail mit dem Grund");
  expect(screen.getByTestId("ban-dialog-confirm")).toBeDisabled();
  await user.type(screen.getByTestId("ban-dialog-reason"), "Spam");
  expect(screen.getByTestId("ban-dialog-hint")).toHaveTextContent("Noch 1 Zeichen.");
  await user.type(screen.getByTestId("ban-dialog-reason"), " im Chat");
  await user.click(screen.getByTestId("ban-dialog-confirm"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/users/u-3/ban", { reason: "Spam im Chat" }));
  expect(toastMock.success).toHaveBeenCalledWith("Spieler Eins ist gesperrt.");
});

test("Superadmin-Konten und das eigene Konto haben keinen Sperr-Knopf, sondern einen Satz", async () => {
  authState.user = { id: "u-2", role: "superadmin" };
  const user = userEvent.setup();
  renderPage();
  let sheet = await openSheet(user, "chef");
  expect(within(sheet).getByTestId("user-sheet-ban-locked")).toHaveTextContent("Superadmin-Konten lassen sich nicht bannen – zuerst die Rolle ändern.");
  await user.click(screen.getByTestId("user-sheet-close"));
  sheet = await openSheet(user, "turnier");
  expect(within(sheet).getByTestId("user-sheet-ban-locked")).toHaveTextContent("Das eigene Konto lässt sich nicht sperren.");
});

test("Entsperren fragt nach und ruft dann entsperren auf", async () => {
  const user = userEvent.setup();
  renderPage();
  const sheet = await openSheet(user, "gesperrt");
  await user.click(within(sheet).getByTestId("user-sheet-unban"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/users/u-4/unban"));
});

test("Mehr: Zugangs-Mail erneut senden mit Rückfrage, Löschen erst nach Eintippen des Namens", async () => {
  const user = userEvent.setup();
  apiMock.delete.mockResolvedValue({ data: { ok: true } });
  renderPage();
  const sheet = await openSheet(user, "spieler");
  await user.click(within(sheet).getByTestId("user-sheet-more-toggle"));
  await user.click(within(sheet).getByTestId("user-sheet-resend-access"));
  await waitFor(() => expect(apiMock.post).toHaveBeenCalledWith("/users/u-3/invite"));
  expect(confirmMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Zugangs-Mail erneut senden?" }));

  expect(within(sheet).getByTestId("user-sheet-delete")).toBeDisabled();
  await user.type(within(sheet).getByTestId("user-sheet-delete-name"), "Spieler Ein");
  expect(within(sheet).getByTestId("user-sheet-delete")).toBeDisabled();
  await user.type(within(sheet).getByTestId("user-sheet-delete-name"), "s");
  await user.click(within(sheet).getByTestId("user-sheet-delete"));
  await waitFor(() => expect(apiMock.delete).toHaveBeenCalledWith("/users/u-3"));
});

test("je Rolle steht, was sie darf und was nicht", async () => {
  renderPage();
  await waitFor(() => expect(screen.getByTestId("user-row-helferin")).toBeInTheDocument());
  expect(screen.getByTestId("role-can-tournament_admin")).toHaveTextContent("Turniere, Events, Stationen");
  expect(screen.getByTestId("role-cannot-superadmin")).toHaveTextContent("andere Superadmin-Konten bannen");
  expect(screen.queryByTestId("role-can-team_leader")).toBeNull();
});
