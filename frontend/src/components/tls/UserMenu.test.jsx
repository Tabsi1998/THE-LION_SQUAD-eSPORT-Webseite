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
  // Mein Konto: alles Persönliche steht im Menü - Mitgliedschaft nur für Mitglieder.
  expect(screen.getByTestId("nav-account-invoices")).toHaveAttribute("href", "/profile?tab=invoices");
  expect(screen.getByTestId("nav-account-penalties")).toHaveAttribute("href", "/my/penalties");
  expect(screen.getByTestId("nav-account-prizes")).toHaveAttribute("href", "/my/prizes");
  expect(screen.getByTestId("nav-account-notifications")).toHaveAttribute("href", "/notifications");
  expect(screen.getByTestId("nav-account-help")).toHaveAttribute("href", "/contact");
  expect(screen.queryByTestId("nav-account-membership")).toBeNull();
  expect(screen.queryByTestId("nav-member-area")).toBeNull();
  expect(screen.queryByTestId("nav-admin")).toBeNull();
});

test("Mitglieder sehen den Mitgliederbereich, Admins den Adminbereich", async () => {
  const user = userEvent.setup();
  authState.isClubMember = true;
  authState.isAdmin = true;
  renderMenu();

  await user.click(screen.getByTestId("nav-user"));
  expect(screen.getByTestId("nav-member-area")).toHaveAttribute("href", "/members/area");
  expect(screen.getByTestId("nav-account-membership")).toHaveAttribute("href", "/members/membership");
  expect(screen.getByTestId("nav-admin")).toHaveAttribute("href", "/admin");
  // Gold, Blau und Rot ohne das weisse `text-white/80` daneben (#431) - sonst bleibt alles weiss.
  expect(screen.getByTestId("nav-member-area").className).toMatch(/text-\[#FFD700\]/);
  expect(screen.getByTestId("nav-member-area").className).not.toMatch(/text-white/);
  expect(screen.getByTestId("nav-admin").className).toMatch(/text-\[#29B6E8\]/);
  expect(screen.getByTestId("nav-logout").className).toMatch(/text-\[#FF3B30\]/);
  expect(screen.getByTestId("nav-logout").className).not.toMatch(/text-white/);
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
