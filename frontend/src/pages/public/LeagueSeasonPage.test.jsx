import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Ligaseite (docs/LIGA.md, P5, #1625): Kopf mit Pausen, Liga N mit Staffel-Reitern, Tabelle, Spielwochen mit Pause,
// Ergebnis mit Maps, Teams mit Teamseite, Regeln aufklappbar. Nur erfundene Namen.
const apiMock = { get: vi.fn() };
vi.mock("@/lib/api", () => ({ api: apiMock, API: "/api", resolveMediaUrl: (url) => url || "", formatApiError: (d) => String(d || "Fehler") }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useLiveRefresh", () => ({ useLiveRefresh: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/components/tls/league/application/LeagueApplicationPanel", () => ({ LeagueApplicationPanel: () => <div data-testid="league-application" /> }));

const { default: LeagueSeasonPage } = await import("./LeagueSeasonPage");

const SEASON_VIEW = {
  league: { id: "l1", slug: "probe-liga", name: "Probe-Liga", game: { name: "Probe Shooter", modes: [
    { mode: "stellung", label: "Stellung", icon_url: "/api/static/uploads/stellung.png" }, { mode: "snd", label: "Suchen & Zerstören" }] } },
  season: {
    name: "Season 1", slug: "season-1", start_date: "2026-11-09T23:00:00+00:00", end_date: "2027-01-18T22:59:59+00:00",
    matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00", best_of: 3, team_size: 4,
    match_points: { win: 3, draw: 1, loss: 0 }, rules_text: "## Fairplay\nKein Cheaten.", registration_deadline: "2026-11-06",
    blocked_periods: [{ start_date: "2026-12-21", end_date: "2027-01-03", label: "Weihnachtspause" }],
    weeks_total: 10, round_robin_legs: 1, map_repeat: "other_mode", result_confirm_hours: 48, game_mode_order: ["stellung", "snd", "stellung"],
    table_tiebreakers: ["head_to_head", "score_diff"],
    result_rules: { stellung: { kind: "score", target: 250, time_limit_seconds: 600 }, snd: { kind: "rounds", target: 6, round_limit: 11 } },
    schedule_rules: { home_rule: true, home_rule_hours: 72, reschedule_notice_hours: 24, reschedule_max: 2, reschedule_same_week: true },
  },
  map_pool: { id: "p1", modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: "m1", name: "Hafenkante", image_url: null }] }] },
  divisions: [{ id: "d1", level: 1, label: "Liga 1", staffeln: [
    { tournament_id: "t1", slug: "probe-a", staffel: "A", status: "live" }, { tournament_id: "t2", slug: "probe-b", staffel: "B", status: "live" }] }],
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

test("Kopf mit Zeitraum, Spielwochen und Pausen - Best of, Standardtermin und Punkte nur an ihrer einen Stelle (#2268)", async () => {
  renderPage();
  expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Probe-Liga Season 1");
  expect(screen.getByTestId("league-fact-period")).toHaveTextContent("10.11.2026 – 18.1.2027");
  expect(screen.getByTestId("league-fact-week")).toHaveTextContent("10 Spielwochen");
  expect(screen.getByTestId("league-fact-week")).toHaveTextContent("Spielwoche Di–Mo");
  // Jede Angabe an einer Stelle: nicht im Kopf, sondern in „Was gespielt wird“ bzw. „Ablauf“.
  expect(screen.queryByTestId("league-fact-points")).toBeNull();
  expect(screen.getByTestId("league-facts")).not.toHaveTextContent("Best of");
  expect(screen.getByTestId("league-facts")).not.toHaveTextContent("20:00");
  expect(screen.getByTestId("season-points")).toHaveTextContent("3 / 1 / 0");
  expect(screen.getByTestId("season-flow-default")).toHaveTextContent("Sonntag, 20:00 Uhr");
  expect(screen.getByTestId("league-fact-breaks")).toHaveTextContent("Weihnachtspause 21.12.–3.1.");
  expect(screen.getByTestId("league-rules")).toHaveTextContent("Kein Cheaten");
  expect(screen.getByTestId("league-map-pool")).toHaveTextContent("Hafenkante");
});

test("Regelwerk (#1646): Link mit Version und Stand plus PDF statt des Aufklappblocks, offene Zustimmung sagt es", async () => {
  const rules = { source: "rules", version: 2, label: "Version 2", valid_from: "2026-11-03", url: "/liga/probe-liga/season-1/regeln",
    pdf_url: "/api/league-rules/seasons/probe-liga/season-1/versions/v2/pdf", consent_open: true };
  apiMock.get.mockImplementation((url) => (url === "/leagues/probe-liga/season-1"
    ? Promise.resolve({ data: { ...SEASON_VIEW, rules } }) : Promise.resolve({ data: STAFFEL("A") })));
  renderPage();
  const link = await screen.findByTestId("league-rules-link");
  expect(within(link).getByRole("link", { name: "Regelwerk" })).toHaveAttribute("href", "/liga/probe-liga/season-1/regeln");
  expect(screen.getByTestId("league-rules-version")).toHaveTextContent("Version 2 · gültig ab 03.11.2026");
  expect(screen.getByTestId("league-rules-pdf")).toHaveAttribute("href", "/api/league-rules/seasons/probe-liga/season-1/versions/v2/pdf");
  expect(screen.getByTestId("league-rules-consent")).toHaveTextContent("noch nicht zugestimmt");
  expect(screen.queryByTestId("league-rules")).toBeNull();
});

test("Staffel (#2268): Tabelle und nur der aktuelle Spieltag, offene Spiele mit Modus je Map, Wege zu Spieltagen und Teams", async () => {
  renderPage();
  const staffel = await screen.findByTestId("league-staffel-A");
  expect(within(staffel).getByTestId("standing-row-r1")).toHaveTextContent("Probe · Probe B");
  // Die laufende Woche (2) steht offen da, die übrigen Wochen stehen auf der Unterseite Spieltage.
  expect(within(staffel).getByTestId("league-match-m2")).toHaveTextContent("Standardtermin");
  expect(within(staffel).queryByTestId("league-week-1")).toBeNull();
  expect(within(staffel).queryByTestId("league-week-7")).toBeNull();
  expect(within(staffel).getByTestId("league-planned-2")).toHaveTextContent("Suchen & Zerstören");
  expect(within(staffel).getByTestId("league-plan-link-A")).toHaveAttribute("href", "/liga/probe-liga/season-1/spieltage?staffel=probe-a");
  expect(within(staffel).getByTestId("league-teams-link-A")).toHaveTextContent("2 Teams");
  expect(within(staffel).getByTestId("league-teams-link-A")).toHaveAttribute("href", "/liga/probe-liga/season-1/teams#staffel-probe-a");
  expect(within(within(staffel).getByTestId("league-match-m2")).getAllByRole("link", { name: /Falken/ })[0]).toHaveAttribute("href", "/teams/team-2");
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

test("Was gespielt wird (#2268): Format, Modi mit Symbol und Regel in Klartext, Map-Reihenfolge als Leiste", async () => {
  renderPage();
  const play = await screen.findByTestId("season-play");
  expect(within(play).getByTestId("season-format")).toHaveTextContent("Probe Shooter");
  expect(within(play).getByTestId("season-format-size")).toHaveTextContent("4 gegen 4");
  expect(within(play).getByTestId("season-format-best_of")).toHaveTextContent("Best of 3");
  expect(within(play).getByTestId("season-format-legs")).toHaveTextContent("eine Runde");
  expect(within(play).getByTestId("season-mode-stellung-rule")).toHaveTextContent("bis 250 Punkte · 10 Min.");
  expect(within(play).getByTestId("season-mode-snd-rule")).toHaveTextContent("6 Runden, höchstens 11");
  expect(within(play).getByTestId("season-mode-stellung").querySelector("[data-icon='image']")).not.toBeNull();
  expect(within(play).getByTestId("season-mode-snd").querySelector("[data-icon='placeholder']")).not.toBeNull();
  expect(within(play).getByTestId("season-mode-snd")).toHaveTextContent("1 Map im Pool");
  const order = within(play).getByTestId("season-map-order");
  expect(within(order).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Map 1Stellung", "Map 2Suchen & Zerstören", "Map 3Stellung"]);
});

test("Ablauf (#2268): Standardtermin, 72-h-Regel, Verschieben, Ergebnis, Punkte und Gleichstand in Klartext", async () => {
  renderPage();
  const flow = await screen.findByTestId("season-flow");
  expect(within(flow).getByTestId("season-flow-default")).toHaveTextContent("Sonntag, 20:00 Uhr");
  expect(within(flow).getByTestId("season-flow-home")).toHaveTextContent("binnen 72 Stunden");
  expect(within(flow).getByTestId("season-flow-reschedule")).toHaveTextContent("Bis 24 Stunden vor dem Termin, höchstens 2× je Spiel, innerhalb der Spielwoche");
  expect(within(flow).getByTestId("season-flow-confirm")).toHaveTextContent("48 Stunden");
  expect(within(flow).getByTestId("season-points")).toHaveTextContent("Punkte → Direkter Vergleich → Map-Differenz");
});

test("Navigation (#2268): Übersicht, Spieltage, Teams - Regelwerk nur mit Regelwerk", async () => {
  renderPage();
  const nav = await screen.findByTestId("season-nav");
  expect(within(nav).getByTestId("season-nav-start")).toHaveAttribute("aria-current", "page");
  expect(within(nav).getByTestId("season-nav-spieltage")).toHaveAttribute("href", "/liga/probe-liga/season-1/spieltage");
  expect(within(nav).getByTestId("season-nav-teams")).toHaveAttribute("href", "/liga/probe-liga/season-1/teams");
  expect(within(nav).queryByTestId("season-nav-regeln")).toBeNull();
});

test("Navigation am Handy (#2268): steht rechts noch etwas über, blendet der Rand aus - am Ende nicht mehr", async () => {
  renderPage();
  const nav = await screen.findByTestId("season-nav");
  const list = nav.querySelector("ul");
  Object.defineProperty(list, "scrollWidth", { configurable: true, value: 420 });
  Object.defineProperty(list, "clientWidth", { configurable: true, value: 358 });
  list.scrollLeft = 0;
  fireEvent(window, new Event("resize"));
  expect(nav).toHaveAttribute("data-more", "true");
  list.scrollLeft = 62;
  fireEvent.scroll(list);
  expect(nav).not.toHaveAttribute("data-more");
});

test("Sperrliste (#2268): zu mit Zahl, aufgeklappt mit Bildern und Hinweis aufs Regelwerk", async () => {
  const rules = { version: 1, label: "Version 1", valid_from: "2026-11-03", url: "/liga/probe-liga/season-1/regeln", pdf_url: "/api/x.pdf" };
  const bans = { entries: [
    { kind: "item", item_id: "w1", name: "Blitz 9", category_label: "Waffen", image_url: "/api/static/uploads/blitz.webp", mode_labels: [] },
    { kind: "item", item_id: "p1", name: "Leise Sohlen", category_label: "Perks", image_url: null, mode_labels: ["Suchen"] },
  ] };
  apiMock.get.mockImplementation((url) => (url === "/leagues/probe-liga/season-1"
    ? Promise.resolve({ data: { ...SEASON_VIEW, rules, loadout_bans: bans } }) : Promise.resolve({ data: STAFFEL("A") })));
  renderPage();
  const block = await screen.findByTestId("season-bans");
  expect(within(block).getByTestId("season-bans-toggle")).toHaveTextContent("2 Sperren");
  expect(within(block).queryByTestId("league-loadout-bans")).toBeNull();
  const details = block.querySelector("details");
  details.open = true;
  fireEvent(details, new Event("toggle"));
  const list = await within(block).findByTestId("league-loadout-bans");
  expect(list).toHaveTextContent("Blitz 9");
  expect(list.querySelector("img")).not.toBeNull();
  expect(within(block).getByRole("link", { name: "Regelwerk" })).toHaveAttribute("href", "/liga/probe-liga/season-1/regeln");
  expect(screen.getByTestId("season-nav-regeln")).toHaveAttribute("href", "/liga/probe-liga/season-1/regeln");
});

test("Vor der Einteilung (#2268): freundlicher Platzhalter mit dem, was als Nächstes passiert", async () => {
  const application = { state: "open", closes_at: "2026-11-06T22:59:00+00:00", slots: 8, slots_free: 3 };
  apiMock.get.mockImplementation((url) => (url === "/leagues/probe-liga/season-1"
    ? Promise.resolve({ data: { ...SEASON_VIEW, divisions: [], application } }) : Promise.reject(new Error(url))));
  renderPage();
  const placeholder = await screen.findByTestId("league-no-divisions");
  expect(placeholder).toHaveTextContent("Die Ligen werden eingeteilt");
  expect(within(placeholder).getByTestId("season-step-apply")).toHaveAttribute("data-state", "now");
  expect(within(placeholder).getByTestId("season-step-apply")).toHaveTextContent("Offen bis 6.11.2026");
  expect(within(placeholder).getByTestId("season-step-split")).toHaveAttribute("data-state", "next");
  expect(within(placeholder).getByTestId("season-step-start")).toHaveTextContent("Erster Spieltag ab 10.11.2026");
});

test("Gold nur für den Meister (#2268): beendete Staffel der obersten Liga, Platz 1 allein", async () => {
  const finished = { ...SEASON_VIEW, divisions: [
    { ...SEASON_VIEW.divisions[0], staffeln: [{ tournament_id: "t1", slug: "probe-a", staffel: "A", status: "completed" }] },
    { id: "d2", level: 2, label: "Liga 2", staffeln: [{ tournament_id: "t3", slug: "probe-c", staffel: "C", status: "completed" }] }] };
  apiMock.get.mockImplementation((url) => {
    if (url === "/leagues/probe-liga/season-1") return Promise.resolve({ data: finished });
    return Promise.resolve({ data: STAFFEL(url.endsWith("/t3") ? "C" : "A") });
  });
  renderPage();
  const champion = await screen.findByTestId("league-champion-A");
  expect(champion).toHaveTextContent("Meister Probe · Probe B");
  expect(within(screen.getByTestId("league-staffel-A")).getByTestId("standing-row-r1")).toHaveAttribute("data-champion", "true");
  // Liga 2 hat keinen Meister.
  const lower = await screen.findByTestId("league-staffel-C");
  expect(within(lower).queryByTestId("league-champion-C")).toBeNull();
  expect(within(lower).getByTestId("standing-row-r1")).not.toHaveAttribute("data-champion");
});

test("Läuft die Season, stehen die Tabellen vor dem Map-Pool; im Entwurf erst am Ende", async () => {
  const { unmount } = renderPage();
  const division = await screen.findByTestId("league-division-1");
  expect(division.compareDocumentPosition(screen.getByTestId("league-map-pool")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  unmount();
  const draft = { ...SEASON_VIEW, divisions: [{ ...SEASON_VIEW.divisions[0], staffeln: [{ tournament_id: "t1", slug: "probe-a", staffel: "A", status: "draft" }] }] };
  apiMock.get.mockImplementation((url) => (url === "/leagues/probe-liga/season-1" ? Promise.resolve({ data: draft }) : Promise.resolve({ data: STAFFEL("A") })));
  renderPage();
  const later = await screen.findByTestId("league-division-1");
  expect(later.compareDocumentPosition(screen.getByTestId("league-map-pool")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
});

test("Liga N ohne sichtbare Staffel (nur Entwürfe): auch dann der Platzhalter statt leerer Ligen", async () => {
  apiMock.get.mockImplementation((url) => (url === "/leagues/probe-liga/season-1"
    ? Promise.resolve({ data: { ...SEASON_VIEW, divisions: [{ id: "d1", level: 1, label: "Liga 1", staffeln: [] }] } }) : Promise.reject(new Error(url))));
  renderPage();
  expect(await screen.findByTestId("league-no-divisions")).toBeInTheDocument();
  expect(screen.queryByTestId("league-division-1")).toBeNull();
});
