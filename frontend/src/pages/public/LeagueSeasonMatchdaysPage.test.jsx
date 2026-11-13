import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

// Spieltage der Season (#2268): je Staffel Woche für Woche - Leiste mit Pause, gewählte Woche groß mit Ergebnis, Map-Chips und
// Modus-Symbolen, kampflos, „Map wiederholt“ und „in Klärung“; Staffel und Woche in der Adresse. Nur erfundene Namen.
const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API: "/api", resolveMediaUrl: (url) => url || "", formatApiError: (d) => String(d || "Fehler") }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));

const { default: LeagueSeasonMatchdaysPage } = await import("./LeagueSeasonMatchdaysPage");

const SEASON_VIEW = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter", modes: [{ mode: "stellung", label: "Stellung" }, { mode: "snd", label: "Suchen & Zerstören" }] } },
  season: { name: "Season 1", slug: "season-1", best_of: 3, team_size: 4, game_mode_order: ["stellung", "snd", "stellung"] },
  map_pool: null,
  divisions: [
    { id: "d1", level: 1, label: "Liga 1", staffeln: [{ tournament_id: "t1", slug: "probe-a", staffel: "A", status: "live" }] },
    { id: "d2", level: 2, label: "Liga 2 · Wilde Liga mit sehr langem Beinamen", staffeln: [{ tournament_id: "t2", slug: "probe-b", staffel: "B", status: "live" }] },
  ],
};
const side = (id, name, team, score) => ({ registration_id: id, name, team_id: team, ...(score === undefined ? {} : { score }) });
const played = {
  id: "m1", matchday: 1, done: true, status: "completed", home: side("r1", "Probe · Probe B", "team-1", 2), away: side("r2", "Falken · Falken A", "team-2", 1),
  winner_registration_id: "r1",
  games: [
    { position: 1, mode: "stellung", mode_label: "Stellung", mode_icon_url: "/api/static/uploads/stellung.png", map_name: "Hafenkante", map_image_url: "/api/static/uploads/hafen.png", winner_registration_id: "r1" },
    { position: 2, mode: "snd", mode_label: "Suchen & Zerstören", map_name: "Nebelwerk", winner_registration_id: "r2", status: "replayed", replay_reason: "Verbindung" },
    { position: 3, mode: "stellung", mode_label: "Stellung", map_name: "Turmruine", winner_registration_id: "r1" },
  ],
};
const forfeit = { id: "m3", matchday: 1, done: true, status: "forfeit", forfeit: true, home: side("r3", "Wölfe", "team-3"), away: side("r4", "Füchse", null), winner_registration_id: "r3", games: [] };
const open = { id: "m2", matchday: 2, done: false, status: "scheduled", in_clarification: true, scheduled_at: "2026-11-22T19:00:00+00:00", schedule_source: "accepted",
  home: side("r2", "Falken · Falken A", "team-2"), away: side("r1", "Probe · Probe B", "team-1"), games: [] };
const STAFFEL = {
  staffel: { staffel: "A", division_label: "Liga 1" }, standings: [],
  teams: [{ id: "r1", display_name: "Probe · Probe B", team_id: "team-1", logo_url: "/api/static/uploads/probe.png" }, { id: "r2", display_name: "Falken · Falken A", team_id: "team-2", logo_url: null }],
  current: 2,
  weeks: [
    { week: 1, kind: "matchday", matchday: 1, label: "Spieltag 1", first_day: "2026-11-10", last_day: "2026-11-16", matches: [played, forfeit] },
    { week: 2, kind: "matchday", matchday: 2, label: "Spieltag 2", first_day: "2026-11-17", last_day: "2026-11-23", matches: [open] },
    { week: 3, kind: "pause", label: "Weihnachtspause", first_day: "2026-11-24", last_day: "2026-11-30", matches: [] },
  ],
};

beforeEach(() => {
  apiMock.get.mockReset();
  apiMock.get.mockImplementation((url) => {
    if (url === "/leagues/probe-liga/season-1") return Promise.resolve({ data: SEASON_VIEW });
    if (url.endsWith("/staffeln/t1")) return Promise.resolve({ data: STAFFEL });
    if (url.endsWith("/staffeln/t2")) return Promise.resolve({ data: { ...STAFFEL, weeks: [], teams: [] } });
    return Promise.reject(new Error(url));
  });
});

function Where() {
  const location = useLocation();
  return <span data-testid="where">{location.search}</span>;
}

function renderPage(path = "/liga/probe-liga/season-1/spieltage") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/liga/:league/:season/spieltage" element={<><LeagueSeasonMatchdaysPage /><Where /></>} /></Routes>
    </MemoryRouter>,
  );
}

test("die laufende Woche steht offen: Termin, Modus je Map, „in Klärung“; die Navigation zeigt Spieltage", async () => {
  renderPage();
  const panel = await screen.findByTestId("league-weekpanel-2");
  expect(panel).toHaveTextContent("Spieltag 2");
  const match = within(panel).getByTestId("league-match-m2");
  expect(match).toHaveTextContent("vereinbart");
  expect(within(match).getByTestId("league-match-m2-clarification")).toHaveTextContent("in Klärung");
  expect(within(panel).getByTestId("league-planned-2")).toHaveTextContent("Suchen & Zerstören");
  expect(within(screen.getByTestId("league-week-2")).getByRole("button")).toHaveAttribute("aria-current", "true");
  expect(screen.getByTestId("season-nav-spieltage")).toHaveAttribute("aria-current", "page");
  expect(screen.getByTestId("season-compact-head")).toHaveTextContent("Spieltage");
});

test("Woche wählen: Ergebnis mit Map-Chips, Modus-Symbol, wiederholter Map, kampflos und Logo; Woche in der Adresse", async () => {
  renderPage();
  await screen.findByTestId("league-weekpanel-2");
  fireEvent.click(within(screen.getByTestId("league-week-1")).getByRole("button"));
  const panel = await screen.findByTestId("league-weekpanel-1");
  expect(screen.getByTestId("where")).toHaveTextContent("staffel=probe-a&woche=1");
  const result = within(panel).getByTestId("league-match-m1");
  expect(result).toHaveTextContent("2 : 1");
  expect(within(result).getByTestId("league-map-m1-1")).toHaveTextContent("Hafenkante");
  expect(within(result).getByTestId("league-map-m1-1-mode")).toHaveAttribute("data-icon", "image");
  expect(within(result).getByTestId("league-map-m1-2")).toHaveTextContent("wiederholt");
  // Ganz lesbar am Handy (#2268): „für“ nennt das Co-Team ohne Hauptteam und wird nicht abgeschnitten; das doppelt genannte Hauptteam
  // ist markiert (am Handy ausgeblendet), der volle Name steht im Titel.
  expect(within(result).getByTestId("league-map-m1-1-winner")).toHaveTextContent("für Probe B");
  expect(within(result).getByTestId("league-map-m1-1-winner").className).not.toContain("truncate");
  expect(result.querySelector(".tls-league-match__club")).toHaveAttribute("data-redundant", "true");
  expect(result.querySelector(".tls-league-match__name")).toHaveTextContent("Probe · Probe B");
  expect(within(result).getByTestId("league-match-m1-replayed")).toHaveTextContent("Map wiederholt");
  expect(result.querySelector(".tls-team-mark img")).toHaveAttribute("src", expect.stringContaining("probe.png"));
  expect(within(panel).getByTestId("league-match-m3")).toHaveTextContent("kampflos");
  // Kampflos ohne Stand: ein Strich statt „vs“.
  expect(within(within(panel).getByTestId("league-match-m3")).getByRole("link", { name: /Zum Spiel/ })).toHaveTextContent(/^–$/);
  // Ohne Logo die Initialen.
  expect(within(result).getAllByText("FA").length).toBeGreaterThan(0);
});

test("Pause: eigene Karte; vor und zurück über die Knöpfe", async () => {
  renderPage("/liga/probe-liga/season-1/spieltage?staffel=probe-a&woche=3");
  const pause = await screen.findByTestId("league-weekpanel-3");
  expect(pause).toHaveTextContent("Weihnachtspause");
  expect(screen.getByTestId("league-week-next")).toBeDisabled();
  fireEvent.click(screen.getByTestId("league-week-prev"));
  expect(await screen.findByTestId("league-weekpanel-2")).toBeInTheDocument();
});

test("mehrere Staffeln: Auswahl je Liga und Staffel; ohne Spielplan ein Satz statt leerer Fläche", async () => {
  renderPage();
  const picker = await screen.findByTestId("season-staffel-picker");
  expect(within(picker).getByTestId("season-staffel-pick-probe-a")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(within(picker).getByTestId("season-staffel-pick-probe-b"));
  expect(await screen.findByTestId("league-plan-empty-B")).toHaveTextContent("Der Spielplan steht, sobald die Staffel startet.");
  expect(screen.getByTestId("where")).toHaveTextContent("staffel=probe-b");
});

test("vor der Einteilung: der Platzhalter statt einer leeren Seite", async () => {
  apiMock.get.mockImplementation((url) => (url === "/leagues/probe-liga/season-1"
    ? Promise.resolve({ data: { ...SEASON_VIEW, divisions: [] } }) : Promise.reject(new Error(url))));
  renderPage();
  expect(await screen.findByTestId("league-no-divisions")).toHaveTextContent("Die Ligen werden eingeteilt");
});

test("ungültige Adresse (?staffel=… unbekannt, ?woche=99 oder Text): erste Staffel und die laufende Woche", async () => {
  renderPage("/liga/probe-liga/season-1/spieltage?staffel=gibt-es-nicht&woche=99");
  expect(await screen.findByTestId("league-weekpanel-2")).toBeInTheDocument();
  expect(screen.getByTestId("season-staffel-pick-probe-a")).toHaveAttribute("aria-pressed", "true");
  document.body.innerHTML = "";
  renderPage("/liga/probe-liga/season-1/spieltage?staffel=probe-a&woche=abc");
  expect(await screen.findByTestId("league-weekpanel-2")).toBeInTheDocument();
});
