import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Der Kopf der Website (#1234): zwischen 1024 und 1279 px eine kompakte Kopfzeile - Löwenkopf statt Schriftzug, Login
// als Personen-Symbol, „Beitreten“ statt „Mitglied werden“, engere Menüpunkte. Darunter und ab 1280 px wie bisher.
// Die Breiten selbst misst e2e/nav-header.spec.js; hier steht, welche Fassung bei welcher Breite gilt.

const authState = { user: null, logout: vi.fn(), isAdmin: false, adminNeedsSecondFactor: false, isClubMember: false };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
const seasonState = { ready: true, seasons: [{ key: "snow", effective: "normal" }], preference: "on", setPreference: vi.fn() };
vi.mock("@/seasons/SeasonContext", () => ({ useSeason: () => seasonState }));
vi.mock("@/lib/api", () => ({ api: { get: vi.fn(async () => ({ data: {} })) }, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useChats", () => ({ useUnreadChats: () => 0 }));
vi.mock("@/components/tls/Logo", () => ({ Logo: ({ variant = "wordmark" }) => <img data-testid="tls-logo" data-variant={variant} alt="The Lion Squad eSports" /> }));
vi.mock("@/components/tls/MainNav", () => ({ MainNav: () => <nav data-testid="main-nav" />, MobileNav: () => <div data-testid="mobile-nav" /> }));
vi.mock("@/seasons/SeasonSlots", () => ({ SeasonFooterSlot: () => null, SeasonMenuSlot: () => null, SeasonWidgetSlot: () => null }));
vi.mock("@/components/tls/DiscordNow", () => ({ DiscordLiveLine: () => null, useDiscordNow: () => null }));
vi.mock("@/components/tls/CookieConsent", () => ({ openCookieSettings: vi.fn() }));
for (const [path, name] of [
  ["@/components/tls/NotificationBell", "NotificationBell"], ["@/components/tls/InvitationBanner", "InvitationBanner"],
  ["@/components/tls/CrownCelebration", "CrownCelebration"], ["@/components/tls/LevelUpCelebration", "LevelUpCelebration"],
  ["@/components/tls/SponsorTicker", "SponsorTicker"], ["@/components/tls/PartnerTicker", "PartnerTicker"],
  ["@/components/tls/GlobalSearch", "GlobalSearch"], ["@/components/tls/StoreButton", "StoreButton"],
  ["@/components/tls/OfflineBar", "OfflineBar"], ["@/components/tls/RouteProgress", "RouteProgress"],
]) {
  vi.doMock(path, () => ({ [name]: () => null }));
}
vi.mock("@/components/tls/UserMenu", () => ({ UserMenu: () => <button type="button" data-testid="nav-user">NeonFalke</button> }));

const { PublicLayout } = await import("./PublicLayout");

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <PublicLayout><p>Inhalt</p></PublicLayout>
    </MemoryRouter>
  );
}

beforeEach(() => {
  authState.user = null;
  seasonState.seasons = [{ key: "snow", effective: "normal" }];
  seasonState.setPreference.mockClear();
});

test("Logo: Schriftzug bis 1023 und ab 1280 px, dazwischen der Löwenkopf - der Rahmen schrumpft nie", () => {
  renderLayout();
  const row = screen.getByTestId("site-header-row");
  const logos = within(row).getAllByTestId("tls-logo");
  expect(logos.map((logo) => logo.dataset.variant)).toEqual(["wordmark", "mascot"]);
  const [wordmark, mascot] = logos.map((logo) => logo.closest("[data-header-logo]"));
  expect(wordmark.dataset.headerLogo).toBe("wordmark");
  expect(wordmark.className).toMatch(/(^|\s)lg:hidden(\s|$)/);
  expect(wordmark.className).toMatch(/(^|\s)xl:inline-flex(\s|$)/);
  expect(mascot.className).toMatch(/(^|\s)hidden(\s|$)/);
  expect(mascot.className).toMatch(/(^|\s)lg:max-xl:inline-flex(\s|$)/);
  expect(screen.getByTestId("site-header-brand").className).toMatch(/(^|\s)lg:max-xl:shrink-0(\s|$)/);
});

test("Gast: Login als Personen-Symbol mit Namen, der Knopf kurz „Beitreten“ - beide einzeilig", () => {
  renderLayout();
  const login = screen.getByTestId("nav-login");
  expect(login).toHaveAccessibleName("Login");
  expect(login.querySelector("svg")).not.toBeNull();
  expect(within(login).getByText("Login").className).toMatch(/lg:max-xl:sr-only/);
  const register = screen.getByTestId("nav-register");
  expect(register.className).toMatch(/whitespace-nowrap/);
  expect(within(register).getByText("Mitglied werden").className).toMatch(/lg:max-xl:hidden/);
  expect(within(register).getByText("Beitreten").className).toMatch(/(^|\s)hidden(\s|$).*lg:max-xl:inline/);
});

// Saison-Deko-Schalter (#1239): Gäste finden ihn am Handy unten im Menü (bis 1023 px gilt das Handy-Menü), am PC in der
// Fußzeile - je Gerät genau ein Platz. Angemeldete stellen die Deko unter Einstellungen → Darstellung ein (#1146).
function openMobileMenu() {
  fireEvent.click(screen.getByTestId("nav-mobile-toggle"));
  return document.getElementById("mobile-navigation");
}

test("Gast mit laufender Saison: Schalter unten im Handy-Menü, in der Fußzeile erst ab 1024 px", () => {
  renderLayout();
  const menu = openMobileMenu();
  const inMenu = within(menu).getByTestId("menu-deco-switch");
  expect(inMenu).toHaveAccessibleName("Saisonale Deko");
  expect(within(inMenu).getByTestId("menu-deco-on")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(inMenu).getByTestId("menu-deco-subtle"));
  expect(seasonState.setPreference).toHaveBeenCalledWith("subtle");
  // Unten: nach Login und Registrieren.
  const register = within(menu).getByText("Registrieren");
  expect(register.compareDocumentPosition(inMenu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const footer = within(document.querySelector("footer")).getByTestId("season-deco-switch");
  expect(footer.className).toMatch(/(^|\s)hidden(\s|$)/);
  expect(footer.className).toMatch(/(^|\s)lg:inline-flex(\s|$)/);
});

test("angemeldet: kein Schalter im Menü und keiner in der Fußzeile", () => {
  authState.user = { id: "u-1", username: "neonfalke" };
  renderLayout();
  const menu = openMobileMenu();
  expect(within(menu).queryByTestId("menu-deco-switch")).toBeNull();
  expect(screen.queryByTestId("season-deco-switch")).toBeNull();
});

test("ohne laufende Saison kein Schalter", () => {
  seasonState.seasons = [];
  renderLayout();
  const menu = openMobileMenu();
  expect(within(menu).queryByTestId("menu-deco-switch")).toBeNull();
  expect(screen.queryByTestId("season-deco-switch")).toBeNull();
});
