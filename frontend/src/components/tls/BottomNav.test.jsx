import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Die Handy-Leiste (#1143, #1144): dieselben fünf Einträge wie die App - Home · Events · Community · Verein · Profil.
// Der aktive Eintrag leuchtet auf allen seinen Seiten; ein Tipp darauf bringt auf der Übersicht ganz nach oben.

const authState = { user: null };
vi.mock("@/context/AuthContext", () => ({ useAuth: () => authState }));
const unread = { value: 0 };
vi.mock("@/hooks/useChats", () => ({ useUnreadChats: () => unread.value }));

const { BottomNav, activeSection } = await import("./BottomNav");

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <BottomNav />
    </MemoryRouter>
  );
}

beforeEach(() => {
  authState.user = null;
  unread.value = 0;
});

test("Gast: fünf Einträge, Profil führt zur Anmeldung", () => {
  renderAt("/");
  const links = ["home", "events", "community", "verein", "profile"].map((key) => screen.getByTestId(`bottom-nav-${key}`));
  expect(links.map((link) => link.textContent)).toEqual(["Home", "Events", "Community", "Verein", "Profil"]);
  expect(links.map((link) => link.getAttribute("href"))).toEqual(["/", "/events", "/community", "/verein", "/login"]);
  expect(screen.getByTestId("bottom-nav-home")).toHaveAttribute("aria-current", "page");
});

test("angemeldet: Home ist das Dashboard, Profil das eigene Profil, an Community die Zahl der ungelesenen Chats", () => {
  authState.user = { id: "u-1", username: "neonfalke" };
  unread.value = 3;
  renderAt("/dashboard");
  expect(screen.getByTestId("bottom-nav-home")).toHaveAttribute("href", "/dashboard");
  expect(screen.getByTestId("bottom-nav-profile")).toHaveAttribute("href", "/u/me");
  expect(screen.getByTestId("bottom-nav-community-count")).toHaveTextContent("3");
  expect(screen.getByTestId("bottom-nav-community")).toHaveAttribute("aria-label", "Community, 3 ungelesene Chats");
});

test("der aktive Eintrag je Adresse", () => {
  const cases = {
    "/": "home",
    "/dashboard": "home",
    "/events/herbst-lan": "events",
    "/tournaments/fc26": "events",
    "/fastlap": "events",
    "/matches/m-1": "events",
    "/community": "community",
    "/messages/u-2": "community",
    "/teams/t-1": "community",
    "/seasons/current": "community",
    "/verein": "verein",
    "/galerie": "verein",
    "/news/herbst-lan": "verein",
    "/members/area": "verein",
    "/profile": "profile",
    "/account/invoices": "profile",
    "/u/me": "profile",
  };
  for (const [path, key] of Object.entries(cases)) expect([path, activeSection(path)]).toEqual([path, key]);
  // Das eigene Profil gehört zu Profil, fremde Profile zu Community.
  expect(activeSection("/u/neonfalke", "NeonFalke")).toBe("profile");
  expect(activeSection("/u/kiwikomet", "neonfalke")).toBe("community");
});

test("Tipp auf den aktiven Eintrag: auf der Übersicht ganz nach oben statt neu laden", () => {
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  renderAt("/events");
  fireEvent.click(screen.getByTestId("bottom-nav-events"));
  expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
  scrollTo.mockClear();
  fireEvent.click(screen.getByTestId("bottom-nav-verein"));
  expect(scrollTo).not.toHaveBeenCalled();
  scrollTo.mockRestore();
});
