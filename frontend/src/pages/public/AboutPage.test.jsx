import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// Über den Verein (#406, #1253): Fakten aus den Vereinsdaten, gezählte Zahlen mit der kleinen Vitrine (#1334), eigener
// Kopf statt des Startseiten-Satzes, Vereinsfoto, Zeitstrahl, Werte mit Satz und Beispiel samt Zielen, das Spiele-Regal
// (#1333), Ansprechpartner, die letzten Treffen - und leere Blöcke bleiben weg.

const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/components/tls/LazyImg", () => ({ LazyImg: ({ alt }) => <img alt={alt} /> }));
vi.mock("@/hooks/useCountUp", () => ({ useCountUp: (value) => [value, { current: null }] }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
let authState = null;
vi.mock("@/context/AuthContext", () => ({ useOptionalAuth: () => authState }));

const { default: AboutPage, organizationFacts, gameLine, heroTitle } = await import("./AboutPage");

const ABOUT = {
  texts: {
    hero_eyebrow: "Über uns", hero_title: "", hero_text: "Wir **fördern** eSports.", values_title: "Mehr als nur Zocken", values_text: "Absatz eins.\n\nAbsatz zwei.",
    values: [{ title: "Fairplay", text: "Wir gratulieren auch, wenn wir verlieren.", example: "Nach jedem Match ein „GG“." }, { title: "Ambition", text: "Wir wollen besser werden.", example: "" }],
    goals: ["**Eine Heimat schaffen** für alle Plattformen."],
    timeline: [{ year: "2023", title: "Gründung", text: "Sieben Leute, ein Discord.", image_url: "" }, { year: "2024", title: "Erste LAN", text: "", image_url: "/api/static/uploads/lan.jpg" }],
    club_photo: { url: "/api/static/uploads/team.jpg", focus_x: 30, focus_y: 70 },
    games_title: "Vom Casual bis zum Cup", games_text: "Text.", offline_title: "Offline", offline_text: "Grillen.", offline_items: ["Grillabende"], cta_title: "Mitmachen?", cta_text: "Komm vorbei.",
  },
  organization: { name: "THE LION SQUAD", legal_name: "THE LION SQUAD - eSPORTS", founded_year: 2019, nonprofit: true, zvr_number: "123456789", registered_seat: "Innsbruck", purpose: "Förderung des eSports", source: "dolibarr" },
  numbers: { members: 42, tournaments: 12, tournaments_completed: 9, prizes: 31, prize_money_eur: 250, years_active: 7, events: 0, participations: 7, achievements: 120 },
  numbers_shown: ["prizes", "tournaments_completed", "members", "years_active", "events"],
  games: [{ id: "cod", name: "Call of Duty", slug: "cod", logo_url: "/uploads/cod.png", tournaments: 8, references: 2 }, { id: "rl", name: "Rocket League", slug: "rl", tournaments: 0, references: 0 }],
  offline_events: [{ id: "e1", slug: "grillen", name: "Grillabend", banner_url: "/uploads/g.jpg", start_date: "2026-08-15T16:00:00Z" }],
};
const BOARD = [{ id: "b1", is_active: true, display_title: "Obmann", user: { display_name: "Otto", avatar_url: "", slug: "otto" } }];
const REFERENCES = { items: [
  { id: "r-alt", title: "Alt-Cup", best_placement: 1, start_date: "2023-01-01", entries: [] },
  { id: "r-neu", title: "Neu-Cup", best_placement: 2, start_date: "2026-05-01", entries: [{ placement: 2, team_count: 11 }] },
  { id: "r-mitte", title: "Mitte-Cup", best_placement: 3, start_date: "2025-05-01", entries: [] },
  { id: "r-davor", title: "Davor-Cup", best_placement: 3, start_date: "2024-05-01", entries: [] },
  { id: "r-fuenf", title: "Ohne Podest", best_placement: 5, start_date: "2026-06-01", entries: [] },
] };

function mockApi(about, board = BOARD, servers = { linked: true, servers: [] }, references = REFERENCES) {
  apiMock.get.mockImplementation(async (url) => {
    if (url === "/home/about") return { data: about };
    if (url.startsWith("/board")) return { data: board };
    if (url === "/references") return { data: references };
    if (url === "/membership/discord-servers") return { data: servers };
    return { data: [] };
  });
}

beforeEach(() => {
  authState = null;
  apiMock.get.mockReset();
});

test("eigener Kopf, Vereinsfoto, Fakten, Zahlen mit Vitrine, Zeitstrahl, Werte und Ziele", async () => {
  mockApi(ABOUT);
  render(<MemoryRouter><AboutPage /></MemoryRouter>);
  expect(await screen.findByTestId("about-facts")).toHaveTextContent("Eingetragener Verein seit 2019");
  expect(screen.getByTestId("about-title")).toHaveTextContent("Seit 2019 ein Rudel");
  expect(screen.getByTestId("about-title")).not.toHaveTextContent("Eine Familie");
  expect(screen.getByTestId("about-photo").querySelector("img")).toHaveStyle({ objectPosition: "30% 70%" });
  expect(screen.getByTestId("about-fact-zvr")).toHaveTextContent("ZVR 123456789");
  expect(screen.getByTestId("about-purpose")).toHaveTextContent("Förderung des eSports");
  expect(screen.getByTestId("about-hero").querySelector("strong")).toHaveTextContent("fördern");

  expect(screen.getByTestId("about-number-members")).toHaveTextContent("42");
  expect(screen.getByTestId("about-number-prizes")).toHaveTextContent("Preise vergeben");
  expect(screen.queryByTestId("about-number-achievements")).toBeNull();
  expect(screen.queryByTestId("about-number-events")).toBeNull();
  // Die kleine Vitrine: die drei neuesten Pokale, ohne Teilnahmen ohne Podest.
  await waitFor(() => expect(screen.getByTestId("about-trophies")).toBeInTheDocument());
  expect(screen.getAllByTestId(/^about-trophy-r-/).map((node) => node.dataset.testid)).toEqual(["about-trophy-r-neu", "about-trophy-r-mitte", "about-trophy-r-davor"]);

  expect(screen.getByTestId("about-timeline-0")).toHaveTextContent("2023Gründung");
  expect(screen.getByTestId("about-timeline-0")).toHaveAttribute("data-side", "left");
  expect(screen.getByTestId("about-timeline-1")).toHaveAttribute("data-side", "right");
  expect(screen.getByTestId("about-values")).toHaveAttribute("id", "werte");
  expect(screen.getByTestId("about-value-0")).toHaveTextContent("FairplayWir gratulieren auch, wenn wir verlieren.Zum Beispiel: Nach jedem Match ein „GG“.");
  expect(screen.getByTestId("about-goals")).toHaveTextContent("Eine Heimat schaffen für alle Plattformen.");
});

test("Spiele-Regal: Wettkampf als Karte zur Turnierliste, Spaß als Chip; Vorstand und Treffen", async () => {
  mockApi(ABOUT);
  render(<MemoryRouter><AboutPage /></MemoryRouter>);
  expect(await screen.findByTestId("about-game-cod")).toHaveTextContent("Call of Duty8 Turniere · 2 Teilnahmen");
  expect(screen.getByTestId("about-game-cod")).toHaveAttribute("href", "/tournaments?game=cod");
  expect(screen.getByTestId("about-game-fun")).toContainElement(screen.getByTestId("about-game-rl"));
  expect(await screen.findByTestId("about-board-b1")).toHaveTextContent("Otto");
  expect(screen.getByTestId("about-offline-event-e1")).toHaveTextContent("Grillabend");
  expect(screen.getByTestId("about-offline-items")).toHaveTextContent("Grillabende");
  expect(screen.getByTestId("about-cta-join")).toBeInTheDocument();
});

test("leere Blöcke bleiben weg; ohne Gründung „Wer wir sind“", async () => {
  mockApi({ ...ABOUT, organization: { name: "THE LION SQUAD", legal_name: "Verein", source: "manual" }, numbers: {}, games: [], offline_events: [],
    texts: { ...ABOUT.texts, values: [], goals: [], timeline: [], club_photo: null, values_title: "", offline_items: [] } }, [], { linked: true, servers: [] }, { items: [] });
  render(<MemoryRouter><AboutPage /></MemoryRouter>);
  expect(await screen.findByTestId("about-fact-registered")).toHaveTextContent("Eingetragener Verein");
  expect(screen.getByTestId("about-title")).toHaveTextContent("Wer wir sind");
  for (const id of ["about-numbers", "about-photo", "about-timeline", "about-values", "about-game", "about-board", "about-offline-events", "about-offline-items", "about-purpose"]) {
    expect(screen.queryByTestId(id)).toBeNull();
  }
});

test("Discord des Spiels unter der Karte (#626): Einladung für alle, „Du bist dabei“ nur angemeldet", async () => {
  const cod = { available: true, guild_id: "1", name: "COD Lions", member_count: 40, invite_url: "https://discord.gg/cod", main: false };
  const withServer = { ...ABOUT, games: [{ ...ABOUT.games[0], discord: cod }, ABOUT.games[1]] };
  mockApi(withServer);
  const { unmount } = render(<MemoryRouter><AboutPage /></MemoryRouter>);
  expect(await screen.findByTestId("about-game-cod-discord-join")).toHaveAttribute("href", "https://discord.gg/cod");
  expect(screen.getByTestId("about-game-cod").contains(screen.getByTestId("about-game-cod-discord-join"))).toBe(false);
  expect(apiMock.get).not.toHaveBeenCalledWith("/membership/discord-servers");
  unmount();

  authState = { user: { id: "u1" } };
  mockApi(withServer, BOARD, { linked: true, servers: [{ ...cod, member: true }] });
  render(<MemoryRouter><AboutPage /></MemoryRouter>);
  expect(await screen.findByTestId("about-game-cod-discord-joined")).toHaveTextContent("Du bist dabei");
});

test("Hilfsfunktionen", () => {
  expect(organizationFacts({})).toEqual([]);
  expect(organizationFacts({ founded_year: 2019, registered_seat: "Innsbruck" }).map((f) => f.key)).toEqual(["founded", "seat"]);
  expect(gameLine({ tournaments: 1, references: 0 })).toBe("1 Turnier");
  expect(gameLine({ tournaments: 0, references: 1 })).toBe("1 Teilnahme");
  expect(gameLine({})).toBe("Casual & Community");
  expect(heroTitle({ hero_title: "Unsere Geschichte" }, { founded_year: 2019 })).toBe("Unsere Geschichte");
  expect(heroTitle({}, { founded_year: 2023 })).toBe("Seit 2023 ein Rudel");
});
