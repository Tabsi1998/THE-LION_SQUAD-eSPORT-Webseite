import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Ligaseite (docs/LIGA.md, P5, #1625): Kopf mit Pausen, Liga N mit Staffel-Reitern, Tabelle, Spielwochen mit Pause,
// Ergebnis mit Maps, Teams mit Teamseite, Regeln aufklappbar. Nur erfundene Namen.
const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API: "/api", resolveMediaUrl: (url) => url || "", formatApiError: (d) => String(d || "Fehler") }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const { default: LeagueSeasonPage } = await import("./LeagueSeasonPage");

const SEASON_VIEW = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter" } },
  season: {
    name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", end_date: "2027-01-18T22:59:59+00:00",
    matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 4,
    match_points: { win: 3, draw: 1, loss: 0 }, rules_text: "## Fairplay\nKein Cheaten.", registration_deadline: "2026-11-06",
    blocked_periods: [{ start_date: "2026-12-21", end_date: "2027-01-03", label: "Weihnachtspause" }],
  },
  map_pool: { id: "p1", modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "m1", name: "Hafenkante", image_url: null }] }] },
  divisions: [{ id: "d1", level: 1, label: "Liga 1", staffeln: [
    { tournament_id: "t1", slug: "probe-a", staffel: "A" }, { tournament_id: "t2", slug: "probe-b", staffel: "B" }] }],
};
const done = {
  id: "m1", matchday: 1, done: true, status: "completed", home: { registration_id: "r1", name: "Probe · Probe B", team_id: "team-1", score: 2 },
  away: { registration_id: "r2", name: "Falken · Falken A", team_id: "team-2", score: 1 }, winner_registration_id: "r1",
  games: [{ position: 1, map_name: "Hafenkante", winner_registration_id: "r1" }, { position: 2, map_name: "Nebelwerk", winner_registration_id: "r2" }],
};
const open = { id: "m2", matchday: 2, done: false, status: "scheduled", scheduled_at: "2026-11-22T19:00:00+00:00", schedule_source: "default",
  home: { registration_id: "r2", name: "Falken · Falken A", team_id: "team-2" }, away: { registration_id: "r1", name: "Probe · Probe B", team_id: "team-1" }, games: [] };
const STAFFEL = (letter) => ({
  staffel: { staffel: letter, division_label: "Liga 1" },
  standings: [{ registration_id: "r1", rank: 1, display_name: "Probe · Probe B", played: 1, won: 1, points: 3, form: ["W"], score_for: 2, score_against: 1, score_diff: 1 }],
  teams: [{ id: "r1", display_name: "Probe · Probe B", team_id: "team-1" }, { id: "r2", display_name: "Falken · Falken A", team_id: "team-2" }],
  current: 2,
  weeks: [
    { week: 1, kind: "matchday", matchday: 1, label: "Spieltag 1", first_day: "2026-11-10", last_day: "2026-11-16", matches: [done] },
    { week: 2, kind: "matchday", matchday: 2, label: "Spieltag 2", first_day: "2026-11-17", last_day: "2026-11-23", matches: [open] },
    { week: 7, kind: "pause", label: "Weihnachtspause", first_day: "2026-12-22", last_day: "2026-12-28", matches: [] },
  ],
});

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockImplementation((url) => {
    if (url === "/leagues/probe-liga/season-1") return Promise.resolve({ data: SEASON_VIEW });
    if (url.endsWith("/staffeln/t1")) return Promise.resolve({ data: STAFFEL("A") });
    if (url.endsWith("/staffeln/t2")) return Promise.resolve({ data: { ...STAFFEL("B"), standings: [], weeks: [] } });
    return Promise.reject(new Error(url));
  });
});

function renderPage(path = "/liga/probe-liga/season-1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/liga/:league/:season" element={<LeagueSeasonPage />} /></Routes>
    </MemoryRouter>,
  );
}

test("Kopf mit Zeitraum, Spielwoche, Punkten und Pausen", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Probe-Liga Season 1");
  expect(screen.getByTestId("league-fact-period")).toHaveTextContent("10.11.2026 – 18.1.2027");
  expect(screen.getByTestId("league-fact-week")).toHaveTextContent("Spielwoche Di–Mo");
  expect(screen.getByTestId("league-fact-week")).toHaveTextContent("Sonntag, 20:00 Uhr");
  expect(screen.getByTestId("league-fact-points")).toHaveTextContent("3 / 1 / 0");
  expect(screen.getByTestId("league-fact-breaks")).toHaveTextContent("Weihnachtspause 21.12.–3.1.");
  expect(screen.getByTestId("league-rules")).toHaveTextContent("Kein Cheaten");
  expect(screen.getByTestId("league-map-pool")).toHaveTextContent("Hafenkante");
});

test("Staffel: Tabelle, laufende Woche offen, Pause sichtbar, Ergebnis mit Maps und Teamseiten", async () => {
  renderPage();
  const staffel = await screen.findByTestId("league-staffel-A");
  expect(within(staffel).getByTestId("standing-row-r1")).toHaveTextContent("Probe · Probe B");
  expect(within(staffel).getByTestId("league-week-7")).toHaveTextContent("Weihnachtspause");
  // Die laufende Woche (2) ist offen, die erste zu.
  expect(within(staffel).getByTestId("league-match-m2")).toHaveTextContent("Standardtermin");
  expect(within(staffel).queryByTestId("league-match-m1")).toBeNull();
  fireEvent.click(within(within(staffel).getByTestId("league-week-1")).getByRole("button"));
  const result = within(staffel).getByTestId("league-match-m1");
  expect(result).toHaveTextContent("2 : 1");
  expect(result).toHaveTextContent("Hafenkante");
  expect(result).toHaveTextContent("Nebelwerk");
  expect(within(result).getAllByRole("link", { name: /Probe · Probe B/ })[0]).toHaveAttribute("href", "/teams/team-1");
  expect(within(result).getByRole("link", { name: /Zum Spiel/ })).toHaveAttribute("href", "/matches/m1");
  expect(within(staffel).getByTestId("league-team-r2")).toHaveAttribute("href", "/teams/team-2");
});

test("Staffel-Reiter und Sprung aus der Teamseite (#staffel-…)", async () => {
  renderPage("/liga/probe-liga/season-1#staffel-probe-b");
  expect(await screen.findByTestId("league-staffel-B")).toBeInTheDocument();
  fireEvent.click(screen.getByTestId("league-staffel-tab-A"));
  expect(await screen.findByTestId("league-staffel-A")).toBeInTheDocument();
});

test("Gestaltung (#2107): Kopf ohne Banner mit Liga-Zeichen, Vereinsfarbe - keine Gewinne, kein Block", async () => {
  renderPage();
  const head = await screen.findByTestId("league-head");
  expect(head).toHaveAttribute("data-banner", "false");
  expect(screen.getByTestId("league-head-emblem")).toHaveAttribute("data-empty", "true");
  expect(head.getAttribute("style") || "").not.toContain("--league-accent-rgb");
  expect(screen.queryByTestId("league-prizes")).toBeNull();
});

test("Gestaltung (#2107): Banner mit Fokuspunkt, Emblem, Akzentfarbe und „Um was gespielt wird“", async () => {
  const look = {
    emblem_url: "/api/static/uploads/probe-emblem.png", accent_color: "#FFB020",
    banner: { url: "/api/static/uploads/probe-banner.webp", x: 20, y: 70, mobile_x: 80, mobile_y: 30 },
  };
  const view = {
    ...SEASON_VIEW, look,
    prizes: [{ place: 1, text: "Pokal und Trikot", image_url: "/api/static/uploads/probe-pokal.png" }, { place: 2, text: "Gutschein" }],
    divisions: [{ ...SEASON_VIEW.divisions[0], prizes: [{ place: 1, text: "Aufstieg" }] }],
  };
  apiMock.get.mockImplementation((url) => (url === "/leagues/probe-liga/season-1" ? Promise.resolve({ data: view }) : Promise.resolve({ data: STAFFEL("A") })));
  renderPage();
  const head = await screen.findByTestId("league-head");
  expect(head).toHaveAttribute("data-banner", "true");
  expect(head.getAttribute("style")).toContain("--league-accent-rgb: 255 176 32");
  const banner = screen.getByTestId("league-head-banner");
  expect(banner.getAttribute("style")).toContain("--league-focus-desktop: 20% 70%");
  expect(banner.getAttribute("style")).toContain("--league-focus-mobile: 80% 30%");
  const image = banner.querySelector("img");
  expect(image).toHaveAttribute("data-loaded", "false");
  fireEvent.load(image);
  expect(image).toHaveAttribute("data-loaded", "true");
  expect(screen.getByTestId("league-head-emblem").querySelector("img")).toHaveAttribute("src", look.emblem_url);
  const prizes = screen.getByTestId("league-prizes");
  expect(within(prizes).getByTestId("league-prize-1")).toHaveTextContent("1. Platz");
  expect(within(prizes).getByTestId("league-prize-1")).toHaveAttribute("data-tone", "gold");
  expect(within(prizes).getByTestId("league-prize-2")).toHaveTextContent("Gutschein");
  expect(screen.getByTestId("league-prizes-1")).toHaveTextContent("Aufstieg");
  // Bild lädt nicht: kein leerer Kasten, der Kopf fällt auf „ohne Banner“ zurück.
  fireEvent.error(image);
  expect(head).toHaveAttribute("data-banner", "false");
});

test("ohne Meldeschluss keine leere Zeile unter dem Titel; mit Akzent folgen die Reiter der Liga-Farbe", async () => {
  const view = { ...SEASON_VIEW, look: { emblem_url: null, banner: null, accent_color: "#FFB020" },
    season: { ...SEASON_VIEW.season, registration_deadline: null } };
  apiMock.get.mockImplementation((url) => (url === "/leagues/probe-liga/season-1" ? Promise.resolve({ data: view }) : Promise.resolve({ data: STAFFEL("A") })));
  renderPage();
  await screen.findByTestId("league-head");
  expect(screen.queryByTestId("league-subline")).toBeNull();
  expect(screen.getByTestId("league-staffel-tab-A")).toHaveClass("tls-league-tab");
  expect(screen.getByTestId("league-head").closest(".tls-league-look").getAttribute("style")).toContain("--tls-brand-rgb: 255 176 32");
});

test("Unsichtbare oder unbekannte Season: ein klarer Hinweis", async () => {
  apiMock.get.mockRejectedValue({ response: { status: 404 } });
  renderPage();
  expect(await screen.findByTestId("league-missing")).toHaveTextContent("Liga nicht gefunden");
});

test("Staffel-Reiter: Tabpanel, Pfeiltasten wechseln und setzen den Fokus", async () => {
  renderPage();
  const tabA = await screen.findByTestId("league-staffel-tab-A");
  const tabB = screen.getByTestId("league-staffel-tab-B");
  expect(tabA).toHaveAttribute("aria-selected", "true");
  expect(tabA).toHaveAttribute("tabindex", "0");
  expect(tabB).toHaveAttribute("tabindex", "-1");
  const panel = screen.getByRole("tabpanel");
  expect(panel).toHaveAttribute("aria-labelledby", tabA.id);
  expect(tabA).toHaveAttribute("aria-controls", panel.id);
  tabA.focus();
  fireEvent.keyDown(tabA, { key: "ArrowRight" });
  expect(tabB).toHaveAttribute("aria-selected", "true");
  expect(tabB).toHaveFocus();
  expect(await screen.findByTestId("league-staffel-B")).toBeInTheDocument();
  fireEvent.keyDown(tabB, { key: "ArrowRight" });
  expect(tabA).toHaveFocus();
  fireEvent.keyDown(tabA, { key: "End" });
  expect(tabB).toHaveAttribute("aria-selected", "true");
  expect(document.getElementById("staffel-probe-a")).not.toBeNull();
});
