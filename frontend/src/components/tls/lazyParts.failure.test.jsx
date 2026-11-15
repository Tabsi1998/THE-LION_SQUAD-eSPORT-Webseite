import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Nachgeladene Teile (#936): Lädt die Glocke, die Kronen-Feier oder die Karten „Heute im Einsatz“ nicht, fehlt nur
// dieser Teil - still, ohne Hinweis. Die Seite darunter bleibt stehen, die Kopfzeile behält den Platz der Glocke.

const authState = { user: null, logout: vi.fn(), isAdmin: false, adminNeedsSecondFactor: false, isClubMember: false };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/seasons/SeasonContext", () => ({ useSeason: () => ({ ready: true, seasons: [], preference: "on", setPreference: vi.fn() }) }));
const apiMock = vi.hoisted(() => ({ get: vi.fn(async () => ({ data: {} })) }));
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/lib/clientLog", () => ({ reportCaughtError: vi.fn(async () => null), scrubClientLogText: (text) => text }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useChats", () => ({ useUnreadChats: () => 0 }));
vi.mock("@/components/tls/Logo", () => ({ Logo: () => <img data-testid="tls-logo" alt="Logo" /> }));
vi.mock("@/components/tls/MainNav", () => ({ MainNav: () => <nav data-testid="main-nav" />, MobileNav: () => null }));
vi.mock("@/seasons/SeasonSlots", () => ({ SeasonFooterSlot: () => null, SeasonMenuSlot: () => null, SeasonWidgetSlot: () => null }));
vi.mock("@/components/tls/DiscordNow", () => ({ DiscordLiveLine: () => null, useDiscordNow: () => null }));
vi.mock("@/components/tls/CookieConsent", () => ({ openCookieSettings: vi.fn() }));
for (const [path, name] of [
  ["@/components/tls/InvitationBanner", "InvitationBanner"], ["@/components/tls/LevelUpCelebration", "LevelUpCelebration"],
  ["@/components/tls/SponsorTicker", "SponsorTicker"], ["@/components/tls/PartnerTicker", "PartnerTicker"],
  ["@/components/tls/GlobalSearch", "GlobalSearch"], ["@/components/tls/StoreButton", "StoreButton"],
  ["@/components/tls/OfflineBar", "OfflineBar"], ["@/components/tls/RouteProgress", "RouteProgress"],
]) {
  vi.doMock(path, () => ({ [name]: () => null }));
}
vi.mock("@/components/tls/UserMenu", () => ({ UserMenu: () => <button type="button" data-testid="nav-user">NeonFalke</button> }));

// Die nachgeladenen Teile selbst sind kaputt.
vi.mock("@/components/tls/NotificationBell", () => { throw new Error("Glocke kaputt"); });
vi.mock("./CrownCelebrationCard", () => { throw new Error("Feier kaputt"); });
vi.mock("@/components/tls/HomeTodayCards", () => { throw new Error("Karten kaputt"); });

const { PublicLayout } = await import("./PublicLayout");
const { HomeTodayStrip } = await import("./HomeTodayStrip");

const settle = () => act(async () => { for (let i = 0; i < 5; i += 1) await new Promise((done) => setTimeout(done, 0)); });

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

test("Glocke lädt nicht: Kopfzeile und Seite bleiben, an ihrer Stelle der gleich große Platzhalter", async () => {
  authState.user = { id: "u1", username: "neonfalke" };
  render(<MemoryRouter><PublicLayout><p>Inhalt</p></PublicLayout></MemoryRouter>);
  await settle();
  expect(screen.getByText("Inhalt")).toBeInTheDocument();
  expect(screen.getByTestId("nav-user")).toBeInTheDocument();
  expect(screen.getByTestId("notification-bell-placeholder").className).toMatch(/w-10 h-10/);
  expect(screen.queryByTestId("optional-error")).toBeNull();
  authState.user = null;
});

test("Kronen-Feier lädt nicht: kein Absturz, kein Hinweis, die Seite bleibt", async () => {
  render(<MemoryRouter><PublicLayout><p>Inhalt</p></PublicLayout></MemoryRouter>);
  act(() => { window.dispatchEvent(new CustomEvent("tls-crown-celebration", { detail: { variant: "gold" } })); });
  await settle();
  expect(screen.getByText("Inhalt")).toBeInTheDocument();
  expect(screen.queryByTestId("crown-celebration-overlay")).toBeNull();
  expect(screen.queryByTestId("optional-error")).toBeNull();
});

test("Karten „Heute im Einsatz“ laden nicht: kein Streifen, die Startseite bleibt", async () => {
  apiMock.get.mockResolvedValue({ data: { items: [{ today: true, lineage: { slug: "a", title: "A" }, series: { season_slug: "2026" }, next: {} }] } });
  render(<MemoryRouter><HomeTodayStrip /><p>Startseite</p></MemoryRouter>);
  await settle();
  expect(screen.getByText("Startseite")).toBeInTheDocument();
  expect(screen.queryByTestId("home-today")).toBeNull();
});
