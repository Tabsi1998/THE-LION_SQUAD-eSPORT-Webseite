// „Zuletzt“ ganz oben im Admin-Menü (#1291).

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ADMIN_RECENT_MAX, readRecentAdminPages, rememberRecentAdminPage } from "@/lib/adminRecent";

const authState = { user: null, logout: () => {} };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
vi.mock("@/hooks/usePublicSiteSettings", () => ({ usePublicSiteSettings: () => ({}) }));

const { AdminLayout, ADMIN_GROUPS, recentNavItems, scrollMenuToActive } = await import("./AdminLayout");

const MFA = { mfa_enabled: true, auth_mfa_verified: true };
const SYSTEM = { id: "sys-1", role: "superadmin", ...MFA };
const CLUB = { id: "club-1", role: "player", areas: ["club"], ...MFA };

beforeAll(() => {
  window.Element.prototype.scrollIntoView = () => {};
});
beforeEach(() => window.localStorage.clear());
afterEach(() => {
  authState.user = null;
  vi.restoreAllMocks();
});

function renderLayout(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AdminLayout><div>inhalt</div></AdminLayout>
    </MemoryRouter>,
  );
}

test("Zuletzt: neueste zuerst, jede Seite einmal, höchstens fünf, ohne die gerade offene Seite", () => {
  const recents = ["/admin/news", "/admin/tournaments", "/admin/gallery", "/admin/news", "/admin/f1", "/admin/games", "/admin/prizes", "/admin/seasons"];
  const items = recentNavItems(SYSTEM, recents, "/admin/tournaments");
  expect(items.map((item) => item.to)).toEqual(["/admin/news", "/admin/gallery", "/admin/f1", "/admin/games", "/admin/prizes"]);
  expect(items).toHaveLength(ADMIN_RECENT_MAX);
  expect(items[0].label).toBe("News");
});

test("Zuletzt zeigt nur Seiten, die die eigene Rolle sehen darf - und keine Wegweiser oder unbekannten Wege", () => {
  const recents = ["/admin/finance", "/admin/members", "/admin/settings/seo", "/admin/dolibarr?tab=links", "/admin/gibtsnicht", "/admin/documents"];
  expect(recentNavItems(CLUB, recents, "/admin").map((item) => item.to)).toEqual(["/admin/members", "/admin/documents"]);
  expect(recentNavItems(null, recents, "/admin")).toEqual([]);
});

test("gemerkt wird je Konto; ohne Browser-Speicher bleibt die Liste leer statt zu brechen", () => {
  rememberRecentAdminPage("a", "/admin/news");
  rememberRecentAdminPage("a", "/admin/f1");
  rememberRecentAdminPage("b", "/admin/members");
  expect(readRecentAdminPages("a")).toEqual(["/admin/f1", "/admin/news"]);
  expect(readRecentAdminPages("b")).toEqual(["/admin/members"]);
  expect(readRecentAdminPages(undefined)).toEqual([]);

  vi.spyOn(window.Storage.prototype, "getItem").mockImplementation(() => { throw new Error("gesperrt"); });
  vi.spyOn(window.Storage.prototype, "setItem").mockImplementation(() => { throw new Error("gesperrt"); });
  expect(readRecentAdminPages("a")).toEqual([]);
  expect(rememberRecentAdminPage("a", "/admin/news", [])).toEqual(["/admin/news"]);
});

test("das Menü zeigt „Zuletzt“ ganz oben und merkt sich die geöffnete Seite (auch Unterseiten über ihren Menüpunkt)", async () => {
  authState.user = SYSTEM;
  rememberRecentAdminPage(SYSTEM.id, "/admin/gallery");
  rememberRecentAdminPage(SYSTEM.id, "/admin/news");
  renderLayout("/admin/tournaments/t-1");

  const nav = document.querySelector("nav.admin-scroll");
  const firstGroup = nav.querySelector("[data-testid^='admin-nav-group-']");
  expect(firstGroup).toHaveAttribute("data-testid", "admin-nav-group-Zuletzt");
  const recent = screen.getByTestId("admin-nav-recent");
  expect(within(recent).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/admin/news", "/admin/gallery"]);
  // Die Unterseite eines Turniers zählt als „Turniere“.
  expect(readRecentAdminPages(SYSTEM.id)[0]).toBe("/admin/tournaments");
  // „Zuletzt“ ist kein fester Eintrag: die Links tragen ein eigenes Merkmal und doppeln keine Test-Kennung.
  expect(screen.getAllByTestId("admin-nav-news")).toHaveLength(1);

  // Während einer Suche zählt nur die Suche.
  await userEvent.setup().type(screen.getByTestId("admin-nav-search"), "galerie");
  expect(screen.queryByTestId("admin-nav-recent")).toBeNull();
});

test("ohne zuletzt geöffnete Seiten gibt es keine leere Gruppe", () => {
  authState.user = SYSTEM;
  renderLayout("/admin");
  expect(screen.queryByTestId("admin-nav-group-Zuletzt")).toBeNull();
  expect(ADMIN_GROUPS.some((group) => group.label === "Zuletzt")).toBe(false);
});

// Handy-Menü (#1291 nach Abnahme): beim Führen zum aktiven Eintrag wird „Zuletzt“ nie angeschnitten.
function fakeMenu({ navTop = 0, recentBox, withRecent = true }) {
  const nav = document.createElement("nav");
  nav.innerHTML = `${withRecent ? '<div data-testid="admin-nav-recent"></div>' : ""}<a aria-current="page">Mitglieder</a>`;
  nav.scrollTop = 40;
  nav.getBoundingClientRect = () => ({ top: navTop, bottom: navTop + 600 });
  const recent = nav.querySelector("[data-testid='admin-nav-recent']");
  const active = nav.querySelector("a");
  active.scrollIntoView = vi.fn(() => { nav.scrollTop = 300; });
  if (recent) recent.getBoundingClientRect = () => recentBox(nav.scrollTop);
  return { nav, active };
}

test("steht „Zuletzt“ da, beginnt die Liste bei ihr und bleibt dort, wenn der aktive Eintrag sichtbar ist", () => {
  const { nav, active } = fakeMenu({ recentBox: () => ({ top: 12, bottom: 150 }) });
  active.scrollIntoView = vi.fn();
  scrollMenuToActive(nav);
  expect(nav.scrollTop).toBe(0);
  expect(active.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
});

test("ragt „Zuletzt“ nach dem Nachführen nur halb ins Bild, rückt die Liste die Gruppe ganz hinaus", () => {
  // Nach dem Nachführen (scrollTop 300) stünde „Zuletzt“ von -80 bis 70 - die Überschrift wäre abgeschnitten.
  const { nav } = fakeMenu({ recentBox: (scrollTop) => ({ top: 220 - scrollTop, bottom: 370 - scrollTop }) });
  scrollMenuToActive(nav);
  expect(nav.scrollTop).toBe(370);
});

test("ohne „Zuletzt“ nur das Nachführen wie bisher", () => {
  const { nav, active } = fakeMenu({ withRecent: false });
  scrollMenuToActive(nav);
  expect(active.scrollIntoView).toHaveBeenCalledWith({ block: "nearest" });
  expect(nav.scrollTop).toBe(300);
});
