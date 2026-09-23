import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Über den Verein (#406): Fakten aus den Vereinsdaten, gezählte Zahlen, Spiele mit Turnieren je
// Spiel, Ansprechpartner aus dem Vorstand, die letzten Treffen - und leere Blöcke bleiben weg.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/LazyImg", () => ({ LazyImg: ({ alt }) => <img alt={alt} /> }));
vi.mock("@/hooks/useCountUp", () => ({ useCountUp: (value) => [value, { current: null }] }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const { default: AboutPage, organizationFacts, gameLine } = await import("./AboutPage");

const ABOUT = {
  texts: { hero_eyebrow: "Der Verein", hero_title: "Ein Rudel.\nEine Familie.", hero_text: "Wir **fördern** eSports.", values_title: "Mehr als nur Zocken", values_text: "Absatz eins.\n\nAbsatz zwei.", pillars: ["Fairplay", "Gemeinschaft"], games_title: "Vom Casual bis zum Cup", games_text: "Text.", offline_title: "Offline", offline_text: "Grillen.", offline_items: ["Grillabende"], cta_title: "Mitmachen?", cta_text: "Komm vorbei." },
  organization: { name: "THE LION SQUAD", legal_name: "THE LION SQUAD - eSPORTS", founded_year: 2019, nonprofit: true, zvr_number: "123456789", registered_seat: "Innsbruck", purpose: "Förderung des eSports", source: "dolibarr" },
  numbers: { members: 42, tournaments: 12, events: 0, participations: 7, achievements: 120 },
  games: [{ id: "cod", name: "Call of Duty", slug: "cod", logo_url: "/uploads/cod.png", tournaments: 8, references: 2 }, { id: "rl", name: "Rocket League", slug: "rl", tournaments: 0, references: 0 }],
  offline_events: [{ id: "e1", slug: "grillen", name: "Grillabend", banner_url: "/uploads/g.jpg", start_date: "2026-08-15T16:00:00Z" }],
};
const BOARD = [{ id: "b1", is_active: true, display_title: "Obmann", user: { display_name: "Otto", avatar_url: "", slug: "otto" } }];

function mockApi(about, board = BOARD) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/home/about") return { data: about };
    if (url.startsWith("/board")) return { data: board };
    return { data: [] };
  });
}

test("Fakten, Zahlen, Spiele, Vorstand und Treffen aus den Daten", async () => {
  mockApi(ABOUT);
  render(<MemoryRouter><AboutPage /></MemoryRouter>);
  expect(await screen.findByTestId("about-facts")).toHaveTextContent("Eingetragener Verein seit 2019");
  expect(screen.getByTestId("about-fact-nonprofit")).toHaveTextContent("Gemeinnützig");
  expect(screen.getByTestId("about-fact-zvr")).toHaveTextContent("ZVR 123456789");
  expect(screen.getByTestId("about-purpose")).toHaveTextContent("Förderung des eSports");
  expect(screen.getByTestId("about-hero").querySelector("strong")).toHaveTextContent("fördern");

  expect(screen.getByTestId("about-number-members")).toHaveTextContent("42");
  expect(screen.getByTestId("about-number-achievements")).toHaveTextContent("120");
  expect(screen.queryByTestId("about-number-events")).toBeNull();

  expect(screen.getByTestId("about-game-cod")).toHaveTextContent("8 Turniere · 2 Teilnahmen");
  expect(screen.getByTestId("about-game-cod").getAttribute("href")).toBe("/tournaments");
  expect(screen.getByTestId("about-game-rl").getAttribute("href")).toBe("/esports");
  expect(screen.getByTestId("about-game-rl")).toHaveTextContent("Casual & Community");
  expect(screen.getByTestId("about-pillars")).toHaveTextContent("Gemeinschaft");

  expect(await screen.findByTestId("about-board-b1")).toHaveTextContent("Otto");
  expect(screen.getByTestId("about-offline-event-e1")).toHaveTextContent("Grillabend");
  expect(screen.getByTestId("about-offline-items")).toHaveTextContent("Grillabende");
  expect(screen.getByTestId("about-cta-join")).toBeInTheDocument();
});

test("leere Blöcke bleiben weg; Fakten ohne Gründung sagen nur „eingetragen“", async () => {
  mockApi({ ...ABOUT, organization: { name: "THE LION SQUAD", legal_name: "Verein", source: "manual" }, numbers: {}, games: [], offline_events: [], texts: { ...ABOUT.texts, pillars: [], offline_items: [] } }, []);
  render(<MemoryRouter><AboutPage /></MemoryRouter>);
  expect(await screen.findByTestId("about-fact-registered")).toHaveTextContent("Eingetragener Verein");
  expect(screen.queryByTestId("about-numbers")).toBeNull();
  expect(screen.queryByTestId("about-games")).toBeNull();
  expect(screen.queryByTestId("about-board")).toBeNull();
  expect(screen.queryByTestId("about-offline-events")).toBeNull();
  expect(screen.queryByTestId("about-offline-items")).toBeNull();
  expect(screen.queryByTestId("about-pillars")).toBeNull();
  expect(screen.queryByTestId("about-purpose")).toBeNull();
});

test("Hilfsfunktionen", () => {
  expect(organizationFacts({})).toEqual([]);
  expect(organizationFacts({ founded_year: 2019, registered_seat: "Innsbruck" }).map((f) => f.key)).toEqual(["founded", "seat"]);
  expect(gameLine({ tournaments: 1, references: 0 })).toBe("1 Turnier");
  expect(gameLine({ tournaments: 0, references: 1 })).toBe("1 Teilnahme");
});
