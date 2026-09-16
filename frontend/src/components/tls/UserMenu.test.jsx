import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Das Benutzermenue im Kopf (#282): Profil ist erreichbar, Mitgliederbereich
// nur fuer Mitglieder, Admin nur fuer Admins, Abmelden ruft die Sitzung ab.

const authState = { user: { id: "u-1", username: "lionfan", display_name: "Lion Fan" }, logout: vi.fn(), isAdmin: false, isClubMember: false };

vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/lib/api", () => ({ resolveMediaUrl: (value) => value || "" }));

const { UserMenu } = await import("./UserMenu");

function renderMenu() {
  return render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>
  );
}

beforeEach(() => {
  authState.isAdmin = false;
  authState.isClubMember = false;
  authState.logout.mockReset();
});

test("das Menue oeffnet sich und fuehrt ins Profil", async () => {
  const user = userEvent.setup();
  renderMenu();

  expect(screen.queryByTestId("nav-user-menu")).toBeNull();
  await user.click(screen.getByTestId("nav-user"));
  expect(screen.getByTestId("nav-profile")).toHaveAttribute("href", "/profile");
  expect(screen.getByTestId("nav-dashboard")).toHaveAttribute("href", "/dashboard");
  expect(screen.getByTestId("nav-messages-menu")).toHaveAttribute("href", "/messages");
  expect(screen.queryByTestId("nav-member-area")).toBeNull();
  expect(screen.queryByTestId("nav-admin-menu")).toBeNull();
});

test("Mitglieder sehen den Mitgliederbereich, Admins den Adminbereich", async () => {
  const user = userEvent.setup();
  authState.isClubMember = true;
  authState.isAdmin = true;
  renderMenu();

  await user.click(screen.getByTestId("nav-user"));
  expect(screen.getByTestId("nav-member-area")).toHaveAttribute("href", "/members/area");
  expect(screen.getByTestId("nav-admin-menu")).toHaveAttribute("href", "/admin");
});

test("Abmelden ruft die Abmeldung auf und schliesst das Menue", async () => {
  const user = userEvent.setup();
  authState.logout.mockResolvedValue(true);
  renderMenu();

  await user.click(screen.getByTestId("nav-user"));
  await user.click(screen.getByTestId("nav-logout"));
  expect(authState.logout).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("nav-user-menu")).toBeNull();
});
