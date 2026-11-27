import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Das Benutzermenü im Kopf (#282, #516, #1150, #2059): oben der eigene Name als Weg zum öffentlichen Profil, dann das
// Dashboard und die Gruppen von „Mein Bereich“ - direkt anspringbar. Chats stehen unter Community, die Liste der
// Benachrichtigungen hinter der Glocke, „Mitglied werden“ unter Verein. „Verein“ nur für Mitglieder, Admin nur für Admins,
// Abmelden ruft die Sitzung ab.

const authState = { user: { id: "u-1", username: "lionfan", display_name: "Lion Fan" }, logout: vi.fn(), isAdmin: false, isClubMember: false };
const apiMock = { get: vi.fn() };

vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/lib/api", () => ({ resolveMediaUrl: (value) => value || "", api: apiMock }));

const { UserMenu } = await import("./UserMenu");
const { closeFrameMenus } = await import("@/lib/mobileMenu");

function renderMenu() {
  return render(
    <MemoryRouter>
      <UserMenu />
    </MemoryRouter>
  );
}

afterEach(() => closeFrameMenus());

beforeEach(() => {
  authState.user = { id: "u-1", username: "lionfan", display_name: "Lion Fan" };
  authState.isAdmin = false;
  authState.adminNeedsSecondFactor = false;
  authState.isClubMember = false;
  authState.logout.mockReset();
  apiMock.get.mockReset();
});

test("Name, Dashboard und die Gruppen von „Mein Bereich“ - kein zweiter Weg zu Chats, Glocke oder Teams", async () => {
  const user = userEvent.setup();
  renderMenu();

  expect(screen.queryByTestId("nav-user-menu")).toBeNull();
  await user.click(screen.getByTestId("nav-user"));
  const items = screen.getAllByRole("menuitem").map((el) => el.getAttribute("data-testid"));
  expect(items).toEqual([
    "nav-profile", "nav-dashboard", "nav-account-start", "nav-account-profil", "nav-account-mitgliedschaft", "nav-account-rechnungen",
    "nav-account-benachrichtigungen", "nav-account-konto", "nav-account-datenschutz", "nav-logout",
  ]);
  expect(screen.getByTestId("nav-profile")).toHaveAttribute("href", "/u/lionfan");
  expect(screen.getByTestId("nav-profile")).toHaveTextContent("So sehen andere mich");
  expect(screen.getByTestId("nav-account-start")).toHaveAttribute("href", "/mein-bereich");
  expect(screen.getByTestId("nav-account-konto")).toHaveTextContent("Konto & Sicherheit");
  expect(screen.getByTestId("nav-account-datenschutz")).toHaveAttribute("href", "/mein-bereich/datenschutz");
  for (const href of ["/messages", "/notifications", "/profile", "/account/invoices", "/membership/join", "/my/prizes", "/teams", "/members/area"]) {
    expect(document.querySelector(`[data-testid="nav-user-menu"] a[href="${href}"]`)).toBeNull();
  }
  // Das Menü fragt keine Zähler mehr ab - Strafen und Gewinne stehen im Profil.
  expect(apiMock.get).not.toHaveBeenCalled();
});

test("Mitglieder sehen „Verein“ in „Mein Bereich“, Admins den Adminbereich", async () => {
  const user = userEvent.setup();
  authState.user = { ...authState.user, is_club_member: true };
  authState.isClubMember = true;
  authState.isAdmin = true;
  renderMenu();

  await user.click(screen.getByTestId("nav-user"));
  expect(screen.queryByTestId("nav-member-area")).toBeNull();
  expect(screen.getByTestId("nav-account-verein")).toHaveAttribute("href", "/mein-bereich/verein");
  expect(screen.getByTestId("nav-admin")).toHaveAttribute("href", "/admin");
  // Blau und Grau ohne das weisse `text-white/80` daneben (#431) - sonst bleibt alles weiss. Abmelden ist ruhig
  // (Farb-Rollen #1305: Rot nur für „läuft gerade“ und Löschen).
  expect(screen.getByTestId("nav-admin").className).toMatch(/text-\[#29B6E8\]/);
  expect(screen.getByTestId("nav-logout").className).toMatch(/text-quiet/);
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

test("ein Admin ohne Zwei-Faktor (#1028) sieht statt „Admin“ den Hinweis „2FA einrichten“", async () => {
  const user = userEvent.setup();
  authState.isAdmin = true;
  authState.adminNeedsSecondFactor = true;
  renderMenu();

  await user.click(screen.getByTestId("nav-user"));
  expect(screen.queryByTestId("nav-admin")).toBeNull();
  const hint = screen.getByTestId("nav-mfa-setup");
  expect(hint).toHaveTextContent("2FA einrichten");
  expect(hint).toHaveAttribute("href", "/mein-bereich/konto?mfa=required&next=%2Fadmin");
});

test("offen bleibt offen, wenn während des Ladens der Kopf der Seite den des Seitenwechsels ablöst (#1324)", async () => {
  const user = userEvent.setup();
  const first = renderMenu();
  await user.click(screen.getByTestId("nav-user"));
  expect(screen.getByTestId("nav-logout")).toBeInTheDocument();
  first.unmount();
  renderMenu();
  expect(screen.getByTestId("nav-logout")).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByTestId("nav-logout")).toBeNull();
});

// „Mein Dienst“ (#1352): Helfer und Moderation ohne Verwaltungsbereich bekommen ihren Eingang - Admins behalten „Admin“,
// Spieler ohne Dienst sehen keinen der beiden.
test.each([
  ["Helfer", { role: "player", has_staff_assignment: true, is_tournament_staff: true }, false, "nav-duty"],
  ["Moderator", { role: "moderator" }, false, "nav-duty"],
  ["Admin mit Zwei-Faktor", { role: "club_admin", mfa_enabled: true, auth_mfa_verified: true }, true, "nav-admin"],
  ["Spieler", { role: "player" }, false, null],
])("%s", async (_name, extra, isAdmin, expected) => {
  const user = userEvent.setup();
  authState.user = { id: "u-1", username: "lionfan", display_name: "Lion Fan", ...extra };
  authState.isAdmin = isAdmin;
  renderMenu();
  await user.click(screen.getByTestId("nav-user"));
  for (const testId of ["nav-duty", "nav-admin"]) {
    if (testId === expected) expect(screen.getByTestId(testId)).toHaveAttribute("href", "/admin");
    else expect(screen.queryByTestId(testId)).toBeNull();
  }
  if (expected === "nav-duty") expect(screen.getByTestId("nav-duty")).toHaveTextContent("Mein Dienst");
});

// Kompakte Kopfzeile (#1234): zwischen 1024 und 1439 px nur das Bild - der Name bleibt für Vorleseprogramme im Knopf.
test("kompakte Kopfzeile: der Name steht zwischen 1024 und 1439 px nicht neben dem Bild, der Knopf nennt ihn weiter", () => {
  renderMenu();
  const button = screen.getByTestId("nav-user");
  expect(button).toHaveAccessibleName("Benutzermenü Lion Fan");
  const name = [...button.querySelectorAll("span")].find((span) => span.textContent === "Lion Fan");
  expect(name.className).toMatch(/(^|\s)lg:hidden(\s|$)/);
});
