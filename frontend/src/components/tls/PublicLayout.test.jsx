import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Der Kopf der Website (#1234): zwischen 1024 und 1439 px eine kompakte Kopfzeile - Löwenkopf statt Schriftzug, Login
// als Personen-Symbol, „Beitreten“ statt „Mitglied werden“, engere Menüpunkte. Darunter und ab 1440 px wie bisher.
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

test("Logo: Schriftzug bis 1023 und ab 1440 px, dazwischen der Löwenkopf - der Rahmen schrumpft nie", () => {
  renderLayout();
  const row = screen.getByTestId("site-header-row");
  const logos = within(row).getAllByTestId("tls-logo");
  expect(logos.map((logo) => logo.dataset.variant)).toEqual(["wordmark", "mascot"]);
  const [wordmark, mascot] = logos.map((logo) => logo.closest("[data-header-logo]"));
  expect(wordmark.dataset.headerLogo).toBe("wordmark");
  expect(wordmark.className).toMatch(/(^|\s)lg:hidden(\s|$)/);
  expect(wordmark.className).toMatch(/(^|\s)min-\[1440px\]:inline-flex(\s|$)/);
  expect(mascot.className).toMatch(/(^|\s)hidden(\s|$)/);
  expect(mascot.className).toMatch(/(^|\s)lg:inline-flex(\s|$)/);
  expect(mascot.className).toMatch(/(^|\s)min-\[1440px\]:hidden(\s|$)/);
  expect(screen.getByTestId("site-header-brand").className).toMatch(/(^|\s)lg:shrink-0(\s|$)/);
});

test("Gast: Login als Personen-Symbol mit Namen, der Knopf kurz „Beitreten“ - beide einzeilig", () => {
  renderLayout();
  const login = screen.getByTestId("nav-login");
  expect(login).toHaveAccessibleName("Login");
  expect(login.querySelector("svg")).not.toBeNull();
  expect(within(login).getByText("Login").className).toMatch(/lg:sr-only/);
  const register = screen.getByTestId("nav-register");
  expect(register.className).toMatch(/whitespace-nowrap/);
  expect(within(register).getByText("Mitglied werden").className).toMatch(/lg:hidden/);
  const joinClasses = within(register).getByText("Beitreten").className.split(/\s+/);
  expect(joinClasses).toEqual(expect.arrayContaining(["hidden", "min-[1440px]:hidden"]));
  expect(joinClasses.some((name) => name.startsWith("lg:inline"))).toBe(true);
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

// Eine Grenze für beide Logos (#1234): Löwenkopf und Schriftzug schalten an derselben Stelle um - ab `lg` und ab
// `min-[1440px]`, nie mit einer max-Grenze. Sonst wären bei Zoom oder hoher DPI (Breite zwischen 1439,98 und 1440 px)
// beide aus. Die Breakpoints werden hier aus den Klassen nachgerechnet, wie Tailwind sie anwendet.
const BREAKPOINTS = [["", 0], ["sm:", 640], ["md:", 768], ["lg:", 1024], ["xl:", 1280], ["min-[1440px]:", 1440]];
function shownAt(className, width) {
  let shown = true;
  for (const [prefix, from] of BREAKPOINTS) {
    if (width < from) continue;
    for (const cls of className.split(/\s+/)) {
      if (!cls.startsWith(prefix) || cls.slice(prefix.length).includes(":")) continue;
      const value = cls.slice(prefix.length);
      if (value === "hidden") shown = false;
      else if (["inline-flex", "flex", "block", "inline", "inline-block"].includes(value)) shown = true;
    }
  }
  return shown;
}

test("an jeder Breite genau ein Logo - auch zwischen 1439,98 und 1440 px", () => {
  renderLayout();
  const boxes = [...screen.getByTestId("site-header-row").querySelectorAll("[data-header-logo]")];
  for (const box of boxes) expect(box.className).not.toMatch(/max-/);
  for (const width of [390, 1023, 1024, 1279, 1280, 1439, 1439.98, 1439.99, 1440, 1920]) {
    const shown = boxes.filter((box) => shownAt(box.className, width)).map((box) => box.dataset.headerLogo);
    expect([width, shown]).toEqual([width, [width >= 1024 && width < 1440 ? "mascot" : "wordmark"]]);
  }
});

// Mitglieder sahen in der Fußzeile „Mitglied werden“ - der Layout-Aufruf übergab den falschen Namen (#2059).
test("Fußzeile: Mitglied sieht „Mitgliederbereich“, Gast „Mitglied werden“", () => {
  const { unmount } = renderLayout();
  const guest = screen.getByTestId("footer-column-join");
  expect(within(guest).getByRole("link", { name: "Mitglied werden" })).toBeInTheDocument();
  unmount();
  Object.assign(authState, { user: { id: "u1", username: "NeonFalke" }, isClubMember: true });
  try {
    renderLayout();
    const member = screen.getByTestId("footer-column-join");
    expect(within(member).getByRole("link", { name: "Mitgliederbereich" })).toHaveAttribute("href", "/members/area");
    expect(within(member).queryByRole("link", { name: "Mitglied werden" })).toBeNull();
  } finally {
    Object.assign(authState, { user: null, isClubMember: false });
  }
});