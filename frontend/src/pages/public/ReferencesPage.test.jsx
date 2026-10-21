import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

// Referenzen-Übersicht (#409, neu gestaltet #1878): Ehrentafel, Läuft gerade, Vitrine mit Hauptkarte, Serien & Ligen
// mit Liga-Weg, Chronik je Jahr mit Spiel-Chips und „Nur Podest“, Mitmachen-Band. Nur erfundene Namen.

const apiMock = { get: vi.fn() };
let siteSettings = {};
vi.mock("@/lib/api", () => ({ api: apiMock, resolveMediaUrl: (value) => value || "" }));
vi.mock("@/components/tls/PublicLayout", () => ({ PublicLayout: ({ children }) => <div>{children}</div> }));
vi.mock("@/hooks/useApiInvalidation", () => ({ useApiInvalidation: () => {} }));
vi.mock("@/hooks/useDocumentTitle", () => ({ useDocumentTitle: () => {} }));
vi.mock("@/hooks/useCountUp", () => ({ useCountUp: (value) => [value, { current: null }] }));
vi.mock("@/hooks/usePublicSiteSettings", () => ({ usePublicSiteSettings: () => siteSettings }));

const { default: ReferencesPage, ReferenceDetailPage, timelineGroups } = await import("./ReferencesPage");

const ITEMS = [
  {
    id: "r1", title: "Winter Cup", display_title: "Winter Cup", organizer: "ESL", league: "Liga X", season: "Season 3", format: "HC",
    platforms: ["PS"], reference_meta: { platforms: [{ key: "PS", label: "PlayStation" }] }, status: "completed",
    game_id: "g1", game: { id: "g1", name: "Call of Duty" }, best_placement: 1, medal: "gold",
    entries: [
      { id: "e1", kind: "solo", placement: 1, medal: "gold", lineup_members: [{ profile_id: "p1", display_name: "Anni", profile_url: "/members/anni" }], lineup: [] },
      { id: "e2", kind: "solo", placement: 4, medal: null, participant_count: 32, lineup_members: [{ profile_id: "p2", display_name: "Benny" }], lineup: [] },
    ],
  },
  {
    id: "r2", title: "Herbst Cup", display_title: "Herbst Cup", season: "Season 2", platforms: ["PC"], reference_meta: { platforms: [] }, status: "planned",
    game_id: "g2", game: { id: "g2", name: "Rocket League" }, best_placement: null, medal: null,
    entries: [{ id: "e3", kind: "team", team_name: "LION A", placement: null, lineup_members: [{ profile_id: "p1", display_name: "Anni" }, { profile_id: "p2", display_name: "Benny" }], lineup: ["Gast"] }],
  },
];
const SUMMARY = { total: 2, entries: 3, podiums: 1, gold: 1, silver: 0, bronze: 0, games: 2, seasons: ["Season 2", "Season 3"] };

const CUP = { lineage: { title: "Probe Monatscup mit einem sehr langen Namen ohne Leerzeichen-Pause", slug: "probe-cup", kind: "series", label: null, game_name: "Probespiel" }, game: null, series: { season: "2026", tier: null, title: null, season_slug: "2026" }, progress: { total: 4, scored: 1 }, next: { code: "Q2", title: null, club_day: "2026-11-09", time: "20:00", state: "today" }, today: true, club: { rank: 2, of: 12 } };
const LEAGUE = { lineage: { title: "Probe Liga", slug: "probe-liga", kind: "team_league", label: "4vs4", game_name: null }, game: null, series: { season: "2026", tier: "Division 1", title: null, season_slug: "2026" }, progress: { total: 8, scored: 0 }, next: { code: "ST1", title: null, club_day: "2026-11-23", time: null, state: "planned" }, today: false, club: null };
const RACING_PATH = {
  lineage: { title: "Probe Racing", slug: "probe-racing", kind: "racing", label: "F1", organizer: "Probe Verband", game_name: "Probespiel" },
  game: null,
  seasons: [
    { season: "2024", tier: "Liga 2", title: null, season_slug: "2024-liga-2", status: "completed", club: { rank: 4, of: 6 }, reference_ids: [] },
    { season: "2025", tier: "Liga 2", title: null, season_slug: "2025-liga-2", status: "completed", club: { rank: 1, of: 6 }, reference_ids: ["r1"] },
    { season: "2026", tier: "Liga 1", title: null, season_slug: "2026-liga-1", status: "active", club: { rank: 2, of: 8 }, reference_ids: [] },
  ],
};

let references;
let running;
let lineages;
beforeEach(() => {
  siteSettings = {};
  references = { items: ITEMS, summary: SUMMARY, showcase: { mode: "auto", reference_id: null } };
  running = { today: "2026-11-09", items: [] };
  lineages = { items: [] };
  apiMock.get.mockImplementation((url) => {
    if (url === "/reference-series/public/running") return Promise.resolve({ data: running });
    if (url === "/reference-series/public/lineages") return Promise.resolve({ data: lineages });
    return Promise.resolve({ data: references });
  });
});

const page = (entry = "/references") => render(<MemoryRouter initialEntries={[entry]}><ReferencesPage /></MemoryRouter>);

// ---------------------------------------------------------------- Läuft gerade

test("Läuft gerade: ohne laufende Serie kein Bereich und keine Sprungmarke, die Seite bleibt vollständig", async () => {
  page();
  expect(await screen.findByTestId("reference-card-r1")).toBeInTheDocument();
  expect(screen.queryByTestId("references-running")).toBeNull();
  expect(screen.getByTestId("references-trophies")).toBeInTheDocument();
  expect(within(screen.getByTestId("references-jump")).queryByText("Im Einsatz")).toBeNull();
  expect(within(screen.getByTestId("references-jump")).getByText("Chronik")).toHaveAttribute("href", "#chronik");
});

test("Läuft gerade: heute zuerst mit goldenem Chip, Fortschritt in Segmenten, Termin, Platz und Link", async () => {
  running = { today: "2026-11-09", items: [CUP, LEAGUE] };
  page();
  const section = await screen.findByTestId("references-running");
  expect(section).toHaveTextContent("Läuft gerade");
  expect(section).toHaveTextContent("2 laufende Saisons");
  const cards = within(section).getAllByRole("link");
  expect(cards.map((card) => card.getAttribute("data-testid"))).toEqual(["running-card-probe-cup-2026", "running-card-probe-liga-2026"]);

  const card = cards[0];
  expect(card).toHaveAttribute("href", "/references/series/probe-cup/2026");
  expect(card).toHaveAttribute("data-today", "true");
  expect(within(card).getByTestId("running-today-badge")).toHaveTextContent("Heute");
  expect(within(card).getByTestId("running-progress-text")).toHaveTextContent("1 von 4 Turnieren gewertet");
  const bar = within(card).getByRole("progressbar");
  expect(bar).toHaveAttribute("aria-valuenow", "1");
  expect(bar.children).toHaveLength(4);
  expect(bar.querySelectorAll(".tls-ref-fill")).toHaveLength(1);
  expect(within(card).getByTestId("running-next")).toHaveTextContent("Q2 · 20:00");
  expect(within(card).getByTestId("running-place")).toHaveTextContent("Gesamtwertung2.von 12");

  const league = cards[1];
  expect(within(league).getByTestId("running-progress-text")).toHaveTextContent("0 von 8 Spieltagen gespielt");
  expect(within(league).getByTestId("running-next")).toHaveTextContent("Mo 23.11. · ST1");
  expect(within(league).getByTestId("running-place")).toHaveTextContent("Noch offen");
  expect(within(league).queryByTestId("running-today-badge")).toBeNull();
  // Reihenfolge: Bereich steht vor der Vitrine; die Sprungmarke „Im Einsatz“ pulsiert, weil heute etwas ansteht.
  expect(section.compareDocumentPosition(screen.getByTestId("references-trophies")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const jump = within(screen.getByTestId("references-jump")).getByText("Im Einsatz");
  expect(jump).toHaveAttribute("href", "#einsatz");
  expect(jump.querySelector(".tls-run-pulse")).toBeInTheDocument();
});

test("Läuft gerade: der nächste Termin trägt die Flagge seines Landes (#1925)", async () => {
  running = { today: "2026-11-09", items: [{ ...CUP, next: { ...CUP.next, country_code: "QA" } }, LEAGUE] };
  page();
  const section = await screen.findByTestId("references-running");
  const [cup, league] = within(section).getAllByTestId("running-next");
  expect(within(cup).getByRole("img", { name: "Katar" })).toHaveAttribute("src", "/assets/flags/qa.svg");
  expect(cup).toHaveTextContent("Q2 · 20:00");
  expect(within(league).queryByRole("img")).toBeNull();
});

test("Läuft gerade: ein fehlgeschlagener Abruf blendet den Bereich aus", async () => {
  apiMock.get.mockImplementation((url) => {
    if (url.startsWith("/reference-series/")) return Promise.reject(new Error("x"));
    return Promise.resolve({ data: references });
  });
  page();
  expect(await screen.findByTestId("reference-card-r1")).toBeInTheDocument();
  expect(screen.queryByTestId("references-running")).toBeNull();
  expect(screen.queryByTestId("references-series")).toBeNull();
});

test("Läuft gerade (#1748): mit Logo das Bild, ohne Logo das Kürzel des Spiels", async () => {
  running = { today: "2026-11-09", items: [{ ...CUP, game: { name: "Call of Duty", short_name: "CoD", logo_url: "/media/cod.png" } }, { ...LEAGUE, game: { name: "Rocket League", short_name: "rl" } }] };
  page();
  const cup = await screen.findByTestId("running-card-probe-cup-2026");
  expect(within(cup).getByTestId("reference-game-logo").querySelector("img")).toHaveAttribute("src", "/media/cod.png");
  expect(within(screen.getByTestId("running-card-probe-liga-2026")).getByTestId("reference-game-logo")).toHaveTextContent("RL");
});

// ---------------------------------------------------------------- Ehrentafel und Vitrine

test("Ehrentafel: Siege, Zweite und Dritte aus der Bilanz je Eintrag, dazu Teilnahmen, Spiele, Saisons, Aufstiege", async () => {
  lineages = { items: [RACING_PATH] };
  references = { ...references, summary: { ...SUMMARY, gold: 2, silver: 1, bronze: 3 }, items: [{ ...ITEMS[0], start_date: "2024-02-01" }, ITEMS[1]] };
  page();
  const board = await screen.findByTestId("references-honor");
  expect(await within(board).findByTestId("references-stat-promotions")).toHaveTextContent("1 Aufstieg");
  expect(within(board).getByTestId("references-stat-gold")).toHaveTextContent("2Siege");
  expect(within(board).getByTestId("references-stat-silver")).toHaveTextContent("1Zweite");
  expect(within(board).getByTestId("references-stat-bronze")).toHaveTextContent("3Dritte");
  expect(within(board).getByTestId("references-stat-total")).toHaveTextContent("2 Teilnahmen");
  expect(within(board).getByTestId("references-stat-games")).toHaveTextContent("2 Spiele");
  expect(within(board).getByTestId("references-stat-running")).toHaveTextContent("1 laufende Saison");
  expect(within(board).getByTestId("references-since")).toHaveTextContent("seit 2024");
});

test("Vitrine: die Hauptkarte zeigt den größten Erfolg mit Spiel, Format, Kennzahlen und unseren Startern", async () => {
  page();
  const card = await screen.findByTestId("references-showcase");
  expect(card).toHaveAttribute("data-reference-id", "r1");
  expect(card).toHaveAttribute("href", "/references/r1");
  expect(card).toHaveAttribute("data-medal", "gold");
  expect(card).toHaveTextContent("1. Platz");
  expect(card).toHaveTextContent("Größter Erfolg bisher");
  expect(within(card).getByTestId("references-showcase-title")).toHaveTextContent("Winter Cup");
  expect(card).toHaveTextContent("Call of Duty");
  expect(card).toHaveTextContent("HC");
  expect(card).toHaveTextContent("32im Feld");
  expect(within(card).getByTestId("references-showcase-starters")).toHaveTextContent("Anni, Benny");
  // Nur Podestplätze stehen in der Vitrine; ohne weitere Podestplätze keine Kacheln.
  expect(screen.getByTestId("references-trophies")).toHaveTextContent("1 Podestplatz");
  expect(screen.queryByTestId("reference-trophy-r2")).toBeNull();
  expect(screen.queryByTestId("reference-trophy-r1")).toBeNull();
});

test("Vitrine: die Verwaltung wählt die Hauptkarte, die übrigen Podestplätze stehen als Kacheln - neueste zuerst", async () => {
  const silver = { ...ITEMS[1], id: "r3", display_title: "Frühlings Cup", best_placement: 2, medal: "silver", start_date: "2026-04-01", entries: [{ id: "e4", kind: "solo", placement: 2, lineup_members: [{ profile_id: "p2", display_name: "Benny" }], lineup: [] }] };
  const bronze = { ...ITEMS[1], id: "r4", display_title: "Sommer Cup", best_placement: 3, medal: "bronze", start_date: "2026-07-01", entries: [{ id: "e5", kind: "solo", placement: 3, lineup_members: [], lineup: ["Pfote"] }] };
  references = { ...references, items: [{ ...ITEMS[0], start_date: "2025-01-10" }, silver, bronze], showcase: { mode: "pinned", reference_id: "r3" } };
  lineages = { items: [RACING_PATH] };
  page();
  const card = await screen.findByTestId("references-showcase");
  expect(card).toHaveAttribute("data-reference-id", "r3");
  expect(card).toHaveAttribute("data-medal", "silver");
  expect(card).toHaveTextContent("Ausgewählt vom Verein");
  const tiles = within(screen.getByTestId("references-trophies")).getAllByTestId(/^reference-trophy-/);
  expect(tiles.map((tile) => tile.getAttribute("data-testid"))).toEqual(["reference-trophy-r4", "reference-trophy-r1"]);
  // r1 gehört zur Saison 2025 der Spur - die Kachel führt zur Saison-Seite (#1750).
  expect(tiles[1]).toHaveAttribute("href", "/references/series/probe-racing/2025-liga-2");
  expect(tiles[1]).toHaveTextContent("1. PlatzWinter CupCall of Duty · 2025");
  expect(within(tiles[0]).getByTestId("placement-badge")).toHaveAttribute("data-medal", "bronze");
});

test("Vitrine: gehört die Hauptkarte zu einer Saison, führt sie zur Saison und nennt die Art der Spur", async () => {
  lineages = { items: [RACING_PATH] };
  page();
  const card = await screen.findByTestId("references-showcase");
  await within(card).findByText("Zur Saison →");
  expect(card).toHaveAttribute("href", "/references/series/probe-racing/2025-liga-2");
  expect(card).toHaveTextContent("Rennliga F1");
  expect(card).toHaveTextContent("Saison 2025");
});

// ---------------------------------------------------------------- Serien & Ligen

test("Serien & Ligen: je Spur der Liga-Weg mit Platz, Aufstieg und laufender Saison, Link zur laufenden Saison", async () => {
  lineages = { items: [RACING_PATH] };
  page();
  const card = await screen.findByTestId("references-lineage-probe-racing");
  expect(card).toHaveAttribute("href", "/references/series/probe-racing/2026-liga-1");
  expect(card).toHaveTextContent("Rennliga · Probe Verband");
  const steps = within(card).getAllByTestId("references-step");
  expect(steps.map((step) => step.textContent)).toEqual(["2024Liga 24.", "2025Liga 21.Aufstieg", "2026Liga 12.läuft"]);
  expect(steps[2]).toHaveAttribute("data-current", "true");
  expect(steps[0]).not.toHaveAttribute("data-current");
  expect(card).toHaveTextContent("3 Saisons · 1 Aufstieg");
  expect(within(screen.getByTestId("references-jump")).getByText("Serien & Ligen")).toHaveAttribute("href", "#serien");
});

// ---------------------------------------------------------------- Chronik

test("Chronik: Zeilen je Jahr mit Platz-Ring, Titel, Veranstalter, Marken und Startern - jeder Name nur einmal", async () => {
  const doubled = { ...ITEMS[0], start_date: "2026-02-01", entries: [...ITEMS[0].entries, { id: "e9", kind: "solo", placement: 7, lineup_members: [{ profile_id: "p1", display_name: "Anni" }], lineup: [] }] };
  references = { ...references, items: [doubled, { ...ITEMS[1], start_date: "2025-11-15" }], summary: { ...SUMMARY, gold: 2, silver: 1, bronze: 3, podiums: 6 } };
  page();
  const year = await screen.findByTestId("references-timeline-2026");
  expect(year).toHaveTextContent("2026");
  expect(within(year).getByTestId("references-year-medals")).toHaveTextContent("1× Gold");
  const row = within(year).getByTestId("reference-card-r1");
  expect(row).toHaveAttribute("href", "/references/r1");
  expect(within(row).getByTestId("placement-badge")).toHaveAttribute("data-medal", "gold");
  expect(within(row).getByTestId("reference-row-title")).toHaveTextContent("ESL · Liga X · Season 3");
  expect(row).toHaveTextContent("ESL");
  expect(row).toHaveTextContent("Call of Duty");
  expect(row).toHaveTextContent("HC");
  expect(within(row).getByTestId("reference-row-starters")).toHaveTextContent(/^Anni, Benny$/);
  expect(row).toHaveTextContent("01.02.2026");
  const team = within(screen.getByTestId("references-timeline-2025")).getByTestId("reference-card-r2");
  expect(within(team).getByTestId("placement-badge")).toHaveAttribute("data-medal", "none");
  expect(within(team).getByTestId("reference-row-starters")).toHaveTextContent(/^LION A$/);
  expect(team).toHaveTextContent("Team");
  expect(screen.queryByTestId("references-timeline-none")).toBeNull();
  // Die Ehrentafel zeigt die Bilanz unverändert - je Eintrag gezählt vom Server.
  expect(screen.getByTestId("references-stat-gold")).toHaveTextContent("2");
  expect(screen.getByTestId("references-stat-bronze")).toHaveTextContent("3");
});

// Gesamtpaket mit dem Mitgliederprofil (#1944): dieselbe Zeile, derselbe kurze Titel - der lange steht im Tooltip.
test("Chronik: kurzer Titel „Veranstalter · Liga · Saison“ wie im Mitgliederprofil, der Veranstalter nicht doppelt", async () => {
  const league = { ...ITEMS[0], start_date: "2026-02-01", display_title: "SEASON #3 POWERED BY PROBE® LIGA X" };
  references = { ...references, items: [league, { ...ITEMS[1], organizer: "Probe Cups", start_date: "2025-11-15" }] };
  page();
  const row = await screen.findByTestId("reference-card-r1");
  const title = within(row).getByTestId("reference-row-title");
  expect(title).toHaveTextContent(/^ESL · Liga X · Season 3$/);
  expect(title).toHaveAttribute("title", "SEASON #3 POWERED BY PROBE® LIGA X");
  expect(within(row).queryByTestId("reference-row-organizer")).toBeNull();
  // Ohne Liga bleibt der Titel - und der Veranstalter steht darunter.
  const cup = screen.getByTestId("reference-card-r2");
  expect(within(cup).getByTestId("reference-row-title")).toHaveTextContent(/^Herbst Cup$/);
  expect(within(cup).getByTestId("reference-row-title")).not.toHaveAttribute("title");
  expect(within(cup).getByTestId("reference-row-organizer")).toHaveTextContent("Probe Cups");
});

test("Chronik: ohne Datum landen die Teilnahmen unter „Ohne Datum“", async () => {
  page();
  const group = await screen.findByTestId("references-timeline-none");
  expect(group).toHaveTextContent("Ohne Datum");
  expect(group).toHaveTextContent("2 Teilnahmen");
});

test("Chronik: Spiel-Chips und „Nur Podest“ filtern, die Anzahl steht als „x von y Teilnahmen“", async () => {
  const third = { ...ITEMS[1], id: "r3", display_title: "Altes Turnier", start_date: null };
  references = { ...references, items: [{ ...ITEMS[0], start_date: "2026-02-01" }, { ...ITEMS[1], start_date: "2025-11-15" }, third] };
  page();
  await screen.findByTestId("reference-card-r1");
  expect(screen.getByTestId("references-count")).toHaveTextContent("3 Teilnahmen");
  // Keine Jahres- oder Plattform-Chips mehr - die Jahre sind die Gruppen.
  expect(screen.queryByText("Alle Jahre")).toBeNull();
  expect(screen.getByTestId("references-game-all")).toHaveAttribute("aria-pressed", "true");

  fireEvent.click(screen.getByTestId("references-game-g2"));
  expect(screen.getByTestId("references-game-g2")).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByTestId("reference-card-r1")).toBeNull();
  expect(screen.getByTestId("reference-card-r2")).toBeInTheDocument();
  expect(screen.getByTestId("reference-card-r3")).toBeInTheDocument();
  expect(screen.getByTestId("references-count")).toHaveTextContent("2 von 3 Teilnahmen");
  // Die Vitrine bleibt vom Filter unberührt - sie ist die Erfolgsbilanz des Vereins.
  expect(screen.getByTestId("references-showcase")).toHaveAttribute("data-reference-id", "r1");

  fireEvent.click(screen.getByTestId("references-podium"));
  expect(screen.getByTestId("references-podium")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("references-empty-filter")).toHaveTextContent("Keine Teilnahmen für diese Auswahl.");
  expect(screen.getByTestId("references-count")).toHaveTextContent("0 von 3 Teilnahmen");

  fireEvent.click(screen.getByTestId("references-game-all"));
  expect(screen.getByTestId("reference-card-r1")).toBeInTheDocument();
  expect(screen.queryByTestId("reference-card-r2")).toBeNull();
  expect(screen.getByTestId("references-count")).toHaveTextContent("1 von 3 Teilnahmen");
});

test("aus dem Mitgliederprofil (#859): nur die Teilnahmen dieser Person, Chip mit Namen hebt den Filter auf", async () => {
  const onlyBennyInR2 = { ...ITEMS[1], entries: [{ ...ITEMS[1].entries[0], lineup_members: [{ profile_id: "p2", display_name: "Benny" }] }] };
  references = { ...references, items: [ITEMS[0], onlyBennyInR2] };
  page("/references?member=p1&name=Anni");
  expect(await screen.findByTestId("reference-card-r1")).toBeInTheDocument();
  expect(screen.queryByTestId("reference-card-r2")).toBeNull();
  expect(screen.getByTestId("references-member")).toHaveTextContent("Nur Anni");
  expect(screen.getByTestId("references-count")).toHaveTextContent("1 von 2 Teilnahmen");
  // Die Zeile zeigt den eigenen Eintrag dieser Person - wie im Profil -, nicht die ganze Teilnahme.
  const own = screen.getByTestId("reference-card-r1");
  expect(within(own).getByTestId("reference-row-starters")).toHaveTextContent(/^Anni$/);
  fireEvent.click(screen.getByTestId("references-member"));
  expect(await screen.findByTestId("reference-card-r2")).toBeInTheDocument();
  expect(screen.queryByTestId("references-member")).toBeNull();
});

test("mit Personen-Filter zählt für die Platzierung der eigene Eintrag (#859)", async () => {
  page("/references?member=p2&name=Benny");
  const own = await screen.findByTestId("reference-card-r1");
  expect(within(own).getByTestId("placement-badge")).toHaveTextContent("4.");
  expect(within(own).getByTestId("placement-badge")).toHaveAttribute("data-medal", "none");
});

test("lange Namen brechen um statt abgeschnitten zu werden (#1812)", async () => {
  running = { today: "2026-11-09", items: [CUP] };
  page();
  await screen.findByTestId("references-running");
  const wrapped = [
    screen.getByTestId("running-title"),
    screen.getByTestId("references-showcase-title"),
    ...screen.getAllByTestId("reference-row-title"),
    ...screen.getAllByTestId("reference-row-starters"),
  ];
  for (const node of wrapped) {
    expect(node.className).toMatch(/break-words|overflow-wrap/);
    expect(node.className).not.toMatch(/line-clamp/);
    expect(node.className).not.toMatch(/(^|\s)truncate(\s|$)/);
  }
});

test("Mitmachen-Band: Mitglied werden und Discord aus den öffentlichen Einstellungen", async () => {
  siteSettings = { discord_invite_url: "https://discord.example/einladung" };
  page();
  const band = await screen.findByTestId("references-join");
  expect(band).toHaveTextContent("Selbst für den Verein antreten?");
  expect(within(band).getByTestId("references-join-member")).toHaveAttribute("href", "/membership/join");
  expect(within(band).getByTestId("references-join-discord")).toHaveAttribute("href", "https://discord.example/einladung");
});

test("Mitmachen-Band: ohne Discord-Einladung nur „Mitglied werden“", async () => {
  page();
  const band = await screen.findByTestId("references-join");
  expect(within(band).queryByTestId("references-join-discord")).toBeNull();
});

// ---------------------------------------------------------------- Detailseite

// Saison abschließen (#1750): eine Referenz aus einer Saison führt zur Saison-Seite - Chronik, Kacheln und Detail.
const SEASON_LINK = { lineage_slug: "probe-liga", season_slug: "season-3", label: "Probe Liga · Season 3 · Division 2", season_end: true };

test("Chronik und Vitrine: die Karte einer Referenz aus einer Saison führt zur Saison-Seite", async () => {
  const silver = { ...ITEMS[1], id: "r3", display_title: "Probe Liga", best_placement: 2, medal: "silver", start_date: "2026-04-01", season_link: SEASON_LINK,
    entries: [{ id: "e4", kind: "team", team_name: "LION A", placement: 2, team_count: 8, lineup_members: [], lineup: [] }] };
  references = { ...references, items: [{ ...ITEMS[0], start_date: "2026-05-01" }, silver] };
  page();
  const row = await screen.findByTestId("reference-card-r3");
  expect(row).toHaveAttribute("href", "/references/series/probe-liga/season-3");
  expect(screen.getByTestId("reference-card-r1")).toHaveAttribute("href", "/references/r1");
  expect(screen.getByTestId("reference-trophy-r3")).toHaveAttribute("href", "/references/series/probe-liga/season-3");
});

test("Detailseite: „aus Saison …“ mit Link zur Saison-Seite", async () => {
  apiMock.get.mockResolvedValue({ data: { ...ITEMS[0], season_link: SEASON_LINK } });
  render(<MemoryRouter initialEntries={["/references/r1"]}><Routes><Route path="/references/:id" element={<ReferenceDetailPage />} /></Routes></MemoryRouter>);
  const link = await screen.findByTestId("reference-detail-season");
  expect(link).toHaveTextContent("aus Saison Probe Liga · Season 3 · Division 2");
  expect(link).toHaveAttribute("href", "/references/series/probe-liga/season-3");
});

test("Detailseite ohne Saison: kein Saison-Link", async () => {
  apiMock.get.mockResolvedValue({ data: { ...ITEMS[0], season_link: null } });
  render(<MemoryRouter initialEntries={["/references/r1"]}><Routes><Route path="/references/:id" element={<ReferenceDetailPage />} /></Routes></MemoryRouter>);
  await screen.findByTestId("reference-detail-entries");
  expect(screen.queryByTestId("reference-detail-season")).toBeNull();
});

test("Partner II (#469): die Detailseite nennt den Partner mit Link auf die Partnerseite", async () => {
  apiMock.get.mockResolvedValue({ data: { ...ITEMS[0], partners: [{ id: "p1", slug: "pineapps-esports", name: "PineApps eSports" }] } });
  render(<MemoryRouter initialEntries={["/references/r1"]}><Routes><Route path="/references/:id" element={<ReferenceDetailPage />} /></Routes></MemoryRouter>);
  expect(await screen.findByTestId("reference-detail-partner-pineapps-esports")).toHaveAttribute("href", "/partners/pineapps-esports");
});

// Schnell-Eintrag (#1936): ein Tagesturnier zeigt nur, was ausgefüllt ist - ohne leere Zeile, Datum nur einmal.
test("Detailseite eines Tagesturniers: nur ausgefüllte Felder, ein Tag steht einmal", async () => {
  apiMock.get.mockResolvedValue({ data: {
    id: "r9", title: "Probe Abend Cup", display_title: "Probe Abend Cup", platforms: [], status: "completed", mode: "online",
    game_id: "g1", game: { id: "g1", name: "Probespiel" }, best_placement: 4, medal: null, start_date: "2026-10-12", end_date: "2026-10-12",
    entries: [{ id: "e9", kind: "solo", placement: 4, participant_count: 24, lineup_members: [{ profile_id: "p3", display_name: "Silberpfeil" }], lineup: [] }],
  } });
  render(<MemoryRouter initialEntries={["/references/r9"]}><Routes><Route path="/references/:id" element={<ReferenceDetailPage />} /></Routes></MemoryRouter>);
  const meta = await screen.findByTestId("reference-detail-meta");
  expect(meta).toHaveTextContent("12.10.2026");
  expect(meta).not.toHaveTextContent("–");
  expect(meta).not.toHaveTextContent("Veranstalter");
  expect(screen.queryByTestId("reference-detail-organizer")).toBeNull();
  expect(screen.queryByTestId("reference-detail-links")).toBeNull();
  expect(screen.queryByTestId("reference-chips-r9")).toBeNull();
});

test("Detailseite: mehrere Tage als Spanne, Veranstalter-Zeile und Links nur mit Inhalt", async () => {
  apiMock.get.mockResolvedValue({ data: { ...ITEMS[0], start_date: "2026-10-10", end_date: "2026-10-12", external_url: "https://example.org/cup" } });
  render(<MemoryRouter initialEntries={["/references/r1"]}><Routes><Route path="/references/:id" element={<ReferenceDetailPage />} /></Routes></MemoryRouter>);
  expect(await screen.findByTestId("reference-detail-meta")).toHaveTextContent("10.10.2026 – 12.10.2026");
  expect(screen.getByTestId("reference-detail-organizer")).toHaveTextContent("ESL · Liga X · Season 3");
  expect(within(screen.getByTestId("reference-detail-links")).getByRole("link")).toHaveAttribute("href", "https://example.org/cup");
});

// ---------------------------------------------------------------- Jahr für Jahr (#1748)

const at = (id, start_date, extra = {}) => ({ id, start_date, ...extra });
const keysOf = (groups) => groups.map((group) => [group.key, group.items.map((item) => item.id)]);

test("Zeitleiste nach Jahr (#1748): neuestes Jahr zuerst, ohne Datum am Ende, innerhalb neu vor alt", () => {
  const groups = timelineGroups([
    at("a", "2024-05-01"), at("b", null), at("c", "2026-03-01"), at("d", "2026-09-01"), at("e", ""),
  ]);
  expect(keysOf(groups)).toEqual([["2026", ["d", "c"]], ["2024", ["a"]], ["", ["b", "e"]]]);
  expect(groups.map((group) => group.label)).toEqual(["2026", "2024", "Ohne Datum"]);
});

test("Zeitleiste nach Jahr (#1748): der Jahreswechsel zählt in Wiener Zeit", () => {
  const groups = timelineGroups([
    // 31.12.2025 23:30 UTC ist in Wien schon der 1. Jänner 2026.
    at("utc", "2025-12-31T23:30:00Z"),
    // Ohne Zone meint die Wiener Uhr: noch 2025.
    at("wall", "2025-12-31T23:30:00"),
    // Ein reines Datum bleibt dieser Tag.
    at("day", "2026-01-01"),
  ]);
  expect(keysOf(groups)).toEqual([["2026", ["day", "utc"]], ["2025", ["wall"]]]);
});

test("Zeitleiste nach Jahr (#1748): gleiche Season-Nummer verschiedener Spiele und Jahre landet nicht in einer Gruppe", () => {
  const groups = timelineGroups([
    at("cod", "2025-04-01", { season: "Season 3", game_id: "g1" }),
    at("rl", "2026-04-01", { season: "Season 3", game_id: "g2" }),
    at("rl-old", "2025-10-01", { season: "Season 3", game_id: "g2" }),
  ]);
  expect(keysOf(groups)).toEqual([["2026", ["rl"]], ["2025", ["rl-old", "cod"]]]);
});

test("Zeitleiste nach Jahr (#1748): ein ungültiges Startdatum fällt aufs Enddatum zurück - für Jahr und Reihenfolge", () => {
  const groups = timelineGroups([
    at("early", "2025-02-01"),
    at("broken", "kein Datum", { end_date: "2025-08-01" }),
    at("late", "2025-11-01"),
  ]);
  expect(keysOf(groups)).toEqual([["2025", ["late", "broken", "early"]]]);
});

test("Zeitleiste nach Jahr (#1748): ohne Startdatum zählt das Enddatum, kaputte Daten verschwinden nicht", () => {
  const groups = timelineGroups([at("end", null, { end_date: "2023-06-30" }), at("bad", "kein Datum")]);
  expect(keysOf(groups)).toEqual([["2023", ["end"]], ["", ["bad"]]]);
});
