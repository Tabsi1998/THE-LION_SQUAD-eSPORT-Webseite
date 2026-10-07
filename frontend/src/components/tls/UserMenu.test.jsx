import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Das Benutzermenü im Kopf (#282, #516, #1150): Dashboard, Mein Profil, Einstellungen - jedes Thema an genau einem Ort.
// Chats stehen unter Community, Benachrichtigungen hinter der Glocke, Rechnungen, Gewinne und Strafen im eigenen Profil
// („Nur für dich“), „Mitglied werden“ unter Verein, Hilfe & Kontakt im Hauptmenü. Mitgliederbereich nur für Mitglieder,
// Admin nur für Admins, Abmelden ruft die Sitzung ab.

const authState = { user: { id: "u-1", username: "lionfan", display_name: "Lion Fan" }, logout: vi.fn(), isAdmin: false, isClubMember: false };
const apiMock = { get: vi.fn() };

vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/lib/api", () => ({ resolveMediaUrl: (value) => value || "", api: apiMock }));

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
  apiMock.get.mockReset();
});

test("drei Einträge: Dashboard, Mein Profil, Einstellungen - kein zweiter Weg zu Chats, Glocke oder Rechnungen", async () => {
  const user = userEvent.setup();
  renderMenu();

  expect(screen.queryByTestId("nav-user-menu")).toBeNull();
  await user.click(screen.getByTestId("nav-user"));
  const items = screen.getAllByRole("menuitem").map((el) => el.getAttribute("data-testid"));
  expect(items).toEqual(["nav-dashboard", "nav-profile", "nav-account-settings", "nav-logout"]);
  expect(screen.getByTestId("nav-profile")).toHaveAttribute("href", "/u/lionfan");
  expect(screen.getByTestId("nav-account-settings")).toHaveAttribute("href", "/profile");
  for (const href of ["/messages", "/notifications", "/profile?tab=invoices", "/account/invoices", "/membership/join", "/my/prizes", "/teams"]) {
    expect(document.querySelector(`[data-testid="nav-user-menu"] a[href="${href}"]`)).toBeNull();
  }
  // Das Menü fragt keine Zähler mehr ab - Strafen und Gewinne stehen im Profil.
  expect(apiMock.get).not.toHaveBeenCalled();
});

test("Mitglieder sehen den Mitgliederbereich, Admins den Adminbereich", async () => {
  const user = userEvent.setup();
  authState.isClubMember = true;
  authState.isAdmin = true;
  renderMenu();

  await user.click(screen.getByTestId("nav-user"));
  expect(screen.queryByTestId("nav-account-membership")).toBeNull();
  expect(screen.getByTestId("nav-member-area")).toHaveAttribute("href", "/members/area");
  expect(screen.getByTestId("nav-admin")).toHaveAttribute("href", "/admin");
  // Gold, Blau und Rot ohne das weisse `text-white/80` daneben (#431) - sonst bleibt alles weiss.
  expect(screen.getByTestId("nav-member-area").className).toMatch(/text-\[#FFD700\]/);
  expect(screen.getByTestId("nav-member-area").className).not.toMatch(/text-white/);
  expect(screen.getByTestId("nav-admin").className).toMatch(/text-\[#29B6E8\]/);
  expect(screen.getByTestId("nav-logout").className).toMatch(/text-\[#FF3B30\]/);
  expect(screen.getByTestId("nav-logout").className).not.toMatch(/text-white/);
});

test("Abmelden ruft die Abmeldung auf und schließt das Menü", async () => {
  const user = userEvent.setup();
  authState.logout.mockResolvedValue(true);
  renderMenu();

  await user.click(screen.getByTestId("nav-user"));
  await user.click(screen.getByTestId("nav-logout"));
  expect(authState.logout).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId("nav-user-menu")).toBeNull();
});
