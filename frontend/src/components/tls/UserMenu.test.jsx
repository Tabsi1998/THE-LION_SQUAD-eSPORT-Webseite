import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Das Benutzermenü im Kopf (#282, #516): jeder Eintrag ein Ziel, Reihenfolge nach Häufigkeit, Strafen
// und Gewinne nur mit Zähler, „Mitglied werden“ für Nicht-Mitglieder, Mitgliederbereich nur für
// Mitglieder, Admin nur für Admins, Abmelden ruft die Sitzung ab.

const authState = { user: { id: "u-1", username: "lionfan", display_name: "Lion Fan" }, logout: vi.fn(), isAdmin: false, isClubMember: false };
const apiMock = { get: vi.fn() };

vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/lib/api", () => ({ resolveMediaUrl: (value) => value || "", api: apiMock }));

const { UserMenu } = await import("./UserMenu");
const { resetAccountBadges } = await import("@/hooks/useAccountBadges");

function renderMenu() {
  return render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>
  );
}

function mockBadges({ standing = { strike_count: 0, active: null }, prizes = [] } = {}) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/moderation/me/standing") return { data: standing };
    if (url === "/prizes/me") return { data: prizes };
    throw new Error(url);
  });
}

beforeEach(() => {
  authState.isAdmin = false;
  authState.isClubMember = false;
  authState.logout.mockReset();
  resetAccountBadges();
  mockBadges();
});

test("das Menü öffnet sich in der abgesprochenen Reihenfolge; ohne Strafen und Gewinne fehlen die Einträge", async () => {
  const user = userEvent.setup();
  renderMenu();

  expect(screen.queryByTestId("nav-user-menu")).toBeNull();
  await user.click(screen.getByTestId("nav-user"));
  await waitFor(() => expect(apiMock.get).toHaveBeenCalledWith("/prizes/me"));
  const items = screen.getAllByRole("menuitem").map((el) => el.getAttribute("data-testid"));
  expect(items).toEqual(["nav-dashboard", "nav-profile", "nav-public-profile", "nav-messages-menu", "nav-account-notifications", "nav-account-join", "nav-account-invoices", "nav-account-help", "nav-logout"]);
  expect(screen.getByTestId("nav-profile")).toHaveAttribute("href", "/profile");
  expect(screen.getByTestId("nav-public-profile")).toHaveAttribute("href", "/u/lionfan");
  expect(screen.getByTestId("nav-account-notifications")).toHaveAttribute("href", "/notifications");
  expect(screen.getByTestId("nav-account-join")).toHaveAttribute("href", "/membership/join");
  expect(screen.getByTestId("nav-account-invoices")).toHaveAttribute("href", "/profile?tab=invoices");
  expect(screen.getByTestId("nav-account-help")).toHaveAttribute("href", "/contact");
  expect(screen.queryByTestId("nav-account-penalties")).toBeNull();
  expect(screen.queryByTestId("nav-account-prizes")).toBeNull();
  expect(screen.queryByTestId("nav-member-area")).toBeNull();
  expect(screen.queryByTestId("nav-admin")).toBeNull();
});

test("Strafen und Gewinne stehen mit Zähler da, sobald es welche gibt", async () => {
  mockBadges({ standing: { strike_count: 2, active: { action: "chat_block" } }, prizes: [{ id: "p1", status: "ready" }, { id: "p2", status: "collected" }] });
  const user = userEvent.setup();
  renderMenu();
  await user.click(screen.getByTestId("nav-user"));
  expect(await screen.findByTestId("nav-account-penalties")).toHaveTextContent("Meine Strafen (2)");
  expect(screen.getByTestId("nav-account-penalties")).toHaveAttribute("href", "/my/penalties");
  expect(screen.getByTestId("nav-account-prizes")).toHaveTextContent("Gewinne (1)");
  expect(screen.getByTestId("nav-account-prizes")).toHaveAttribute("href", "/my/prizes");
});

test("Mitglieder sehen Mitgliedschaft und Mitgliederbereich, Admins den Adminbereich", async () => {
  const user = userEvent.setup();
  authState.isClubMember = true;
  authState.isAdmin = true;
  renderMenu();

  await user.click(screen.getByTestId("nav-user"));
  expect(screen.getByTestId("nav-account-membership")).toHaveAttribute("href", "/members/membership");
  expect(screen.queryByTestId("nav-account-join")).toBeNull();
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
